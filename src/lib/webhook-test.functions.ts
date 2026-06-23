import { createServerFn } from "@tanstack/react-start";
import { createHmac } from "node:crypto";

const TEST_EVENT_TYPE = "transaction.completed";

function buildTestPayload() {
  const eventId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    event_id: eventId,
    event_type: TEST_EVENT_TYPE,
    occurred_at: new Date().toISOString(),
    data: {
      id: `txn-test-${Date.now()}`,
      status: "completed",
      customer_id: `cust-test`,
      subscription_id: null,
      custom_data: {
        destinationId: "00000000-0000-0000-0000-000000000000",
        userId: "00000000-0000-0000-0000-000000000000",
        kind: "unlock",
      },
      details: {
        totals: {
          total: "999",
        },
      },
    },
  };
}

export const generateTestPayload = createServerFn({ method: "POST" }).handler(async () => {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    return { configured: false as const, error: "PADDLE_WEBHOOK_SECRET is not set" };
  }

  const payload = buildTestPayload();
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");

  const paddleSignature = `ts=${ts};h1=${signature}`;

  return {
    configured: true as const,
    payload,
    rawBody,
    paddleSignature,
  };
});

export const listRecentWebhookEvents = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("paddle_events")
    .select("event_id, event_type, processed_at, result, error")
    .order("processed_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as {
    event_id: string;
    event_type: string;
    processed_at: string;
    result: string | null;
    error: string | null;
  }[];
});

export const getWebhookStatus = createServerFn({ method: "GET" }).handler(async () => {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  return {
    secretConfigured: !!secret,
    secretPrefix: secret ? `${secret.slice(0, 4)}…${secret.slice(-4)}` : null,
  };
});
