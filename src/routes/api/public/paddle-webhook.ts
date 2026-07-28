import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paddle webhook handler.
 *
 * URL (paste into Paddle → Developer Tools → Notifications):
 *   https://project--{project-id}.lovable.app/api/public/paddle-webhook
 *
 * Required secret: PADDLE_WEBHOOK_SECRET.
 *
 * Events handled:
 *   - transaction.completed     → one-time unlock OR subscription renewal
 *   - subscription.created      → Plus activated
 *   - subscription.updated      → status change (active / past_due / paused)
 *   - subscription.canceled     → Plus ended
 *   - transaction.payment_failed → mark past_due
 *
 * Idempotency (unlock path — Stage 3):
 *   The atomic RPC process_paddle_unlock_event owns event claim + destination
 *   lock + paid unlock + success mark in one transaction, guarded by a
 *   per-event pg_try_advisory_xact_lock. A successful event is acknowledged
 *   once as "duplicate" on any subsequent delivery. A failed event rolls back
 *   fully and is recorded post-rollback via a separate upsert, then retried
 *   on Paddle's next delivery. The payments_enabled() flag is enforced inside
 *   the DB path and short-circuits before any state changes.
 *
 * Idempotency (subscription paths):
 *   Simple event-log status machine. Insert-first with unique event_id.
 */

export const Route = createFileRoute("/api/public/paddle-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PADDLE_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[paddle-webhook] PADDLE_WEBHOOK_SECRET not configured");
          return new Response("Webhook not configured", { status: 500 });
        }

        const sigHeader = request.headers.get("paddle-signature") ?? "";
        const rawBody = await request.text();

        const parts = Object.fromEntries(
          sigHeader.split(";").map((kv) => {
            const i = kv.indexOf("=");
            return [kv.slice(0, i), kv.slice(i + 1)];
          }),
        ) as { ts?: string; h1?: string };

        if (!parts.ts || !parts.h1) {
          return new Response("Missing signature parts", { status: 401 });
        }

        const tsNum = Number(parts.ts);
        if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
          return new Response("Stale signature", { status: 401 });
        }

        const expected = createHmac("sha256", secret)
          .update(`${parts.ts}:${rawBody}`)
          .digest("hex");
        const sigBuf = Buffer.from(parts.h1, "hex");
        const expBuf = Buffer.from(expected, "hex");
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          console.error("[paddle-webhook] signature mismatch");
          return new Response("Invalid signature", { status: 401 });
        }

        let event: PaddleEvent;
        try {
          event = JSON.parse(rawBody) as PaddleEvent;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        if (!event.event_id || !event.event_type || !event.data) {
          return new Response("Malformed event", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // ── Paid unlock path (Stage 3 atomic RPC) ──────────────────────────
        const custom = readCustomData(event.data);
        const subscriptionId =
          typeof (event.data as Record<string, unknown>).subscription_id === "string"
            ? ((event.data as Record<string, unknown>).subscription_id as string)
            : null;

        if (
          event.event_type === "transaction.completed" &&
          !subscriptionId &&
          custom.kind === "unlock" &&
          custom.destinationId
        ) {
          return handleUnlockEvent(event, custom, supabaseAdmin);
        }

        // ── All other events use the simple insert-first log ──────────────
        const dupOrClaim = await claimSubscriptionEvent(event, supabaseAdmin);
        if (dupOrClaim === "duplicate") return new Response("ok (duplicate)", { status: 200 });
        if (dupOrClaim === "error")
          return new Response("Event log failed", { status: 500 });

        try {
          const result = await dispatch(event, supabaseAdmin);
          await supabaseAdmin
            .from("paddle_events")
            .update({
              result,
              status: "success",
              processed_at: new Date().toISOString(),
            } as never)
            .eq("event_id", event.event_id);
          return new Response("ok", { status: 200 });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[paddle-webhook] ${event.event_type} handler failed`, msg);
          await supabaseAdmin
            .from("paddle_events")
            .update({ error: msg, status: "failed" } as never)
            .eq("event_id", event.event_id);
          return new Response(`handler failed: ${msg}`, { status: 500 });
        }
      },

      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: { "Access-Control-Allow-Methods": "POST, OPTIONS" },
        }),
    },
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Paid unlock: single-transaction RPC + post-rollback failure record

async function handleUnlockEvent(
  event: PaddleEvent,
  custom: CustomData,
  admin: AdminClient,
): Promise<Response> {
  const d = event.data;
  const details = (d.details ?? {}) as Record<string, unknown>;
  const totals = (details.totals ?? {}) as Record<string, unknown>;
  const cents = Number(totals.total ?? 0) || 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = admin.rpc as unknown as (fn: string, args: unknown) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;

  const { data: result, error } = await rpc("process_paddle_unlock_event", {
    _event_id: event.event_id,
    _event_type: event.event_type,
    _payload: event as unknown,
    _dest: custom.destinationId!,
    _paid_cents: cents,
  });

  if (!error) {
    const parsed = (result ?? {}) as { outcome?: string };
    if (parsed.outcome === "duplicate") return new Response("ok (duplicate)", { status: 200 });
    return new Response("ok", { status: 200 });
  }

  const msg = error.message ?? "unknown";
  const code = error.code ?? "";

  // Concurrent delivery — do not record; Paddle will retry.
  if (code === "55P03" || msg.includes("concurrent_processing")) {
    return new Response("busy", { status: 409 });
  }

  // Payments disabled or configuration-driven refusals — retryable, no side
  // effects, do not mark the event 'success'.
  if (msg.includes("payments_disabled")) {
    // Optional diagnostic — separate post-rollback op.
    await recordFailure(event, admin, msg);
    return new Response("payments disabled", { status: 503 });
  }

  // All other failures rolled back; record diagnostic state and let Paddle retry.
  console.error("[paddle-webhook] unlock RPC failed", msg);
  await recordFailure(event, admin, msg);
  return new Response(`handler failed: ${msg}`, { status: 500 });
}

async function recordFailure(
  event: PaddleEvent,
  admin: AdminClient,
  msg: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  // Upsert: the transaction that would have inserted has rolled back, so a
  // brand-new event needs an insert; a retried event needs an update.
  const { error: upErr } = await admin
    .from("paddle_events")
    .upsert(
      {
        event_id: event.event_id,
        event_type: event.event_type,
        payload: event as never,
        status: "failed",
        error: msg,
        last_attempt_at: nowIso,
      } as never,
      { onConflict: "event_id" },
    );
  if (upErr) {
    console.error("[paddle-webhook] failed to record failure state", upErr.message);
  }
}

async function claimSubscriptionEvent(
  event: PaddleEvent,
  admin: AdminClient,
): Promise<"claimed" | "duplicate" | "error"> {
  const nowIso = new Date().toISOString();
  const { error: insertErr } = await admin.from("paddle_events").insert({
    event_id: event.event_id,
    event_type: event.event_type,
    payload: event as never,
    status: "pending",
    attempts: 1,
    last_attempt_at: nowIso,
  } as never);
  if (!insertErr) return "claimed";
  if ((insertErr as { code?: string }).code === "23505") {
    // Existing row — check if it's already a success.
    const { data: existing } = await admin
      .from("paddle_events")
      .select("status")
      .eq("event_id", event.event_id)
      .maybeSingle();
    if ((existing as { status?: string } | null)?.status === "success") return "duplicate";
    // Retry: bump attempts + reset error.
    await admin
      .from("paddle_events")
      .update({
        attempts: ((existing as unknown as { attempts?: number } | null)?.attempts ?? 0) + 1,
        last_attempt_at: nowIso,
        status: "pending",
        error: null,
      } as never)
      .eq("event_id", event.event_id);
    return "claimed";
  }
  console.error("[paddle-webhook] event log insert failed", insertErr);
  return "error";
}

// ────────────────────────────────────────────────────────────────────────────
// Event types

type PaddleEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
};

type CustomData = {
  destinationId?: string;
  userId?: string;
  kind?: "unlock" | "plus" | string;
};

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

// ────────────────────────────────────────────────────────────────────────────
// Non-unlock dispatch (subscription lifecycle + renewal)

async function dispatch(event: PaddleEvent, admin: AdminClient): Promise<string> {
  switch (event.event_type) {
    case "transaction.completed":
      return handleSubscriptionRenewal(event, admin);
    case "transaction.payment_failed":
      return handlePaymentFailed(event, admin);
    case "subscription.created":
    case "subscription.activated":
      return handleSubscriptionActive(event, admin);
    case "subscription.updated":
      return handleSubscriptionUpdated(event, admin);
    case "subscription.canceled":
      return handleSubscriptionCanceled(event, admin);
    default:
      return `ignored:${event.event_type}`;
  }
}

function readCustomData(data: Record<string, unknown>): CustomData {
  const raw = (data.custom_data ?? {}) as Record<string, unknown>;
  return {
    destinationId: typeof raw.destinationId === "string" ? raw.destinationId : undefined,
    userId: typeof raw.userId === "string" ? raw.userId : undefined,
    kind: typeof raw.kind === "string" ? (raw.kind as CustomData["kind"]) : undefined,
  };
}

// Subscription renewal branch of transaction.completed (unlock branch handled above).
async function handleSubscriptionRenewal(
  event: PaddleEvent,
  admin: AdminClient,
): Promise<string> {
  const d = event.data;
  const custom = readCustomData(d);
  const subscriptionId = typeof d.subscription_id === "string" ? d.subscription_id : null;
  const customerId = typeof d.customer_id === "string" ? d.customer_id : null;

  if (subscriptionId) {
    if (!custom.userId) return "renewal:no-user-mapping";
    if (customerId) {
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .eq("paddle_customer_id", customerId)
        .maybeSingle();
      if (existing && existing.id !== custom.userId) {
        throw new Error(`paddle_customer_id ${customerId} already bound to a different user`);
      }
    }
    const { error: upErr } = await admin
      .from("profiles")
      .update({
        plus_status: "active",
        paddle_customer_id: customerId ?? undefined,
        paddle_subscription_id: subscriptionId,
      })
      .eq("id", custom.userId);
    if (upErr) throw new Error(`profiles update: ${upErr.message}`);
    return "renewal:plus-active";
  }
  return "transaction:unhandled";
}

async function handleSubscriptionActive(
  event: PaddleEvent,
  admin: AdminClient,
): Promise<string> {
  const d = event.data;
  const custom = readCustomData(d);
  const subscriptionId = typeof d.id === "string" ? d.id : null;
  const customerId = typeof d.customer_id === "string" ? d.customer_id : null;
  const nextBilling = typeof d.next_billed_at === "string" ? d.next_billed_at : null;

  if (!custom.userId) throw new Error("subscription event missing custom_data.userId");
  if (customerId) {
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("paddle_customer_id", customerId)
      .maybeSingle();
    if (existing && existing.id !== custom.userId) {
      throw new Error(`paddle_customer_id ${customerId} already bound to a different user`);
    }
  }
  const { data: updated, error: upErr } = await admin
    .from("profiles")
    .update({
      plus_status: "active",
      plus_renews_at: nextBilling,
      paddle_customer_id: customerId ?? undefined,
      paddle_subscription_id: subscriptionId ?? undefined,
    })
    .eq("id", custom.userId)
    .select("id");
  if (upErr) throw new Error(`profiles update: ${upErr.message}`);
  if (!updated || updated.length === 0) {
    throw new Error(`no profile found for userId ${custom.userId}`);
  }
  return "sub-active";
}

async function handleSubscriptionUpdated(
  event: PaddleEvent,
  admin: AdminClient,
): Promise<string> {
  const d = event.data;
  const subscriptionId = typeof d.id === "string" ? d.id : null;
  if (!subscriptionId) return "sub-updated:no-id";
  const status = typeof d.status === "string" ? d.status : "active";
  const nextBilling = typeof d.next_billed_at === "string" ? d.next_billed_at : null;
  const mapped: "active" | "past_due" | "canceled" =
    status === "active" || status === "trialing"
      ? "active"
      : status === "past_due" || status === "paused"
        ? "past_due"
        : "canceled";
  const { error } = await admin
    .from("profiles")
    .update({ plus_status: mapped, plus_renews_at: nextBilling })
    .eq("paddle_subscription_id", subscriptionId);
  if (error) throw new Error(`profiles update: ${error.message}`);
  return `sub-updated:${mapped}`;
}

async function handleSubscriptionCanceled(
  event: PaddleEvent,
  admin: AdminClient,
): Promise<string> {
  const d = event.data;
  const subscriptionId = typeof d.id === "string" ? d.id : null;
  if (!subscriptionId) return "sub-canceled:no-id";
  const { error } = await admin
    .from("profiles")
    .update({ plus_status: "canceled", plus_renews_at: null })
    .eq("paddle_subscription_id", subscriptionId);
  if (error) throw new Error(`profiles update: ${error.message}`);
  return "sub-canceled";
}

async function handlePaymentFailed(
  event: PaddleEvent,
  admin: AdminClient,
): Promise<string> {
  const d = event.data;
  const subscriptionId = typeof d.subscription_id === "string" ? d.subscription_id : null;
  if (!subscriptionId) return "payment-failed:no-sub";
  const { error } = await admin
    .from("profiles")
    .update({ plus_status: "past_due" })
    .eq("paddle_subscription_id", subscriptionId);
  if (error) throw new Error(`profiles update: ${error.message}`);
  return "payment-failed:past_due";
}

export type _AdminClient = AdminClient;
