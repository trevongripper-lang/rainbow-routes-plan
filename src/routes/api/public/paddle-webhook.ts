import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paddle webhook handler.
 *
 * URL (paste into Paddle → Developer Tools → Notifications):
 *   https://project--{project-id}.lovable.app/api/public/paddle-webhook
 *
 * Required secret: PADDLE_WEBHOOK_SECRET (from the same Paddle notifications page).
 *
 * Events handled:
 *   - transaction.completed     → one-time unlock OR subscription renewal
 *   - subscription.created      → Plus activated
 *   - subscription.updated      → status change (active / past_due / paused)
 *   - subscription.canceled     → Plus ended
 *   - transaction.payment_failed → mark past_due
 *
 * Idempotency: every event_id is recorded in public.paddle_events;
 * duplicates short-circuit with a 200 OK.
 *
 * For one-time unlocks, the checkout MUST include custom_data:
 *   { destinationId: <uuid>, userId: <uuid> }
 * For subscriptions, custom_data on the transaction MUST include:
 *   { userId: <uuid>, kind: "plus" }
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

        // Paddle signature format: "ts=<unix>;h1=<hmac_sha256_hex>"
        const parts = Object.fromEntries(
          sigHeader.split(";").map((kv) => {
            const i = kv.indexOf("=");
            return [kv.slice(0, i), kv.slice(i + 1)];
          }),
        ) as { ts?: string; h1?: string };

        if (!parts.ts || !parts.h1) {
          return new Response("Missing signature parts", { status: 401 });
        }

        // Reject events older than 5 minutes (replay protection)
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

        // Load admin client lazily — route file is in client module graph.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Idempotency: insert event_id; if duplicate, ack and return.
        const { error: insertErr } = await supabaseAdmin
          .from("paddle_events")
          .insert({
            event_id: event.event_id,
            event_type: event.event_type,
            payload: event as never,
          });

        if (insertErr) {
          // 23505 = unique_violation → already processed, ack quietly
          if ((insertErr as { code?: string }).code === "23505") {
            return new Response("ok (duplicate)", { status: 200 });
          }
          console.error("[paddle-webhook] event log insert failed", insertErr);
          return new Response("Event log failed", { status: 500 });
        }

        // Process the event
        try {
          const result = await dispatch(event, supabaseAdmin);
          await supabaseAdmin
            .from("paddle_events")
            .update({ result })
            .eq("event_id", event.event_id);
          return new Response("ok", { status: 200 });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[paddle-webhook] ${event.event_type} handler failed`, msg);
          await supabaseAdmin
            .from("paddle_events")
            .update({ error: msg })
            .eq("event_id", event.event_id);
          // Return 200 so Paddle doesn't infinitely retry on app-level bugs;
          // the row in paddle_events with `error` set is the trail to replay manually.
          return new Response("ok (logged)", { status: 200 });
        }
      },

      // Paddle doesn't preflight, but harmless to support.
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: { "Access-Control-Allow-Methods": "POST, OPTIONS" },
        }),
    },
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Event types (minimal — only what we read)

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

type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

// ────────────────────────────────────────────────────────────────────────────
// Dispatch

async function dispatch(
  event: PaddleEvent,
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
): Promise<string> {
  switch (event.event_type) {
    case "transaction.completed":
      return handleTransactionCompleted(event, admin);
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

// ────────────────────────────────────────────────────────────────────────────
// transaction.completed — either one-time unlock or sub renewal

async function handleTransactionCompleted(
  event: PaddleEvent,
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
): Promise<string> {
  const d = event.data;
  const custom = readCustomData(d);
  const subscriptionId = typeof d.subscription_id === "string" ? d.subscription_id : null;
  const customerId = typeof d.customer_id === "string" ? d.customer_id : null;

  // Subscription renewal → re-affirm Plus active and bump renewal date
  if (subscriptionId) {
    if (!custom.userId) {
      return "renewal:no-user-mapping"; // will be resolved by subscription.updated
    }
    await admin
      .from("profiles")
      .update({
        plus_status: "active",
        paddle_customer_id: customerId ?? undefined,
        paddle_subscription_id: subscriptionId,
      })
      .eq("id", custom.userId);
    return "renewal:plus-active";
  }

  // One-time unlock
  if (custom.kind === "unlock" && custom.destinationId) {
    // Total cents from details.totals.total (string in minor units)
    const details = (d.details ?? {}) as Record<string, unknown>;
    const totals = (details.totals ?? {}) as Record<string, unknown>;
    const cents = Number(totals.total ?? 0) || 0;

    const { error } = await admin.rpc("unlock_destination", {
      _dest: custom.destinationId,
      _use_credit: false,
      _paid_cents: cents,
    });
    if (error) throw new Error(`unlock_destination: ${error.message}`);
    return `unlock:${custom.destinationId}:${cents}`;
  }

  return "transaction:unhandled";
}

// ────────────────────────────────────────────────────────────────────────────
// Subscription lifecycle

async function handleSubscriptionActive(
  event: PaddleEvent,
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
): Promise<string> {
  const d = event.data;
  const custom = readCustomData(d);
  const subscriptionId = typeof d.id === "string" ? d.id : null;
  const customerId = typeof d.customer_id === "string" ? d.customer_id : null;
  const nextBilling =
    typeof d.next_billed_at === "string" ? d.next_billed_at : null;

  if (!custom.userId) {
    return "sub-active:no-user-mapping";
  }
  await admin
    .from("profiles")
    .update({
      plus_status: "active",
      plus_renews_at: nextBilling,
      paddle_customer_id: customerId ?? undefined,
      paddle_subscription_id: subscriptionId ?? undefined,
    })
    .eq("id", custom.userId);
  return "sub-active";
}

async function handleSubscriptionUpdated(
  event: PaddleEvent,
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
): Promise<string> {
  const d = event.data;
  const subscriptionId = typeof d.id === "string" ? d.id : null;
  if (!subscriptionId) return "sub-updated:no-id";

  const status = typeof d.status === "string" ? d.status : "active";
  const nextBilling =
    typeof d.next_billed_at === "string" ? d.next_billed_at : null;

  // Map Paddle status → our enum
  const mapped: "active" | "past_due" | "canceled" =
    status === "active" || status === "trialing"
      ? "active"
      : status === "past_due" || status === "paused"
        ? "past_due"
        : "canceled";

  const { error } = await admin
    .from("profiles")
    .update({
      plus_status: mapped,
      plus_renews_at: nextBilling,
    })
    .eq("paddle_subscription_id", subscriptionId);
  if (error) throw new Error(`profiles update: ${error.message}`);
  return `sub-updated:${mapped}`;
}

async function handleSubscriptionCanceled(
  event: PaddleEvent,
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
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

// ────────────────────────────────────────────────────────────────────────────
// Failed payment

async function handlePaymentFailed(
  event: PaddleEvent,
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
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
