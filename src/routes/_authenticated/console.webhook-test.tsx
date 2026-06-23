import { createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  generateTestPayload,
  listRecentWebhookEvents,
  getWebhookStatus,
} from "@/lib/webhook-test.functions";
import {
  ShieldCheck,
  ShieldAlert,
  Send,
  ClipboardCopy,
  Check,
  Activity,
  Webhook,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/console/webhook-test")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getSession();
    if (!userData.session) throw notFound();
    const { data } = await supabase.rpc("has_role", {
      _user_id: userData.session.user.id,
      _role: "admin",
    });
    if (!data) throw notFound();
  },
  component: WebhookTestPage,
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Webhook Health — Console" },
    ],
  }),
});

const PREVIEW_URL = "https://id-preview--938ee2e4-e28c-4f9a-80fb-c8ac6ff9fb0b.lovable.app";
const PUBLISHED_URL = "https://rainbow-routes-plan.lovable.app";
const WEBHOOK_PATH = "/api/public/paddle-webhook";

function WebhookTestPage() {
  const qc = useQueryClient();
  const genFn = useServerFn(generateTestPayload);
  const eventsFn = useServerFn(listRecentWebhookEvents);
  const statusFn = useServerFn(getWebhookStatus);

  const status = useQuery({
    queryKey: ["webhook-status"],
    queryFn: () => statusFn({ data: undefined }),
  });

  const events = useQuery({
    queryKey: ["webhook-events"],
    queryFn: () => eventsFn({ data: undefined }),
  });

  const [lastResult, setLastResult] = useState<{
    status: number;
    statusText: string;
    body: string;
  } | null>(null);

  const sendTest = useMutation({
    mutationFn: async () => {
      const generated = await genFn({ data: undefined });
      if (!generated.configured) {
        throw new Error(generated.error);
      }

      const res = await fetch(WEBHOOK_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "paddle-signature": generated.paddleSignature,
        },
        body: generated.rawBody,
      });

      const body = await res.text();
      return { status: res.status, statusText: res.statusText, body };
    },
    onSuccess: (result) => {
      setLastResult(result);
      qc.invalidateQueries({ queryKey: ["webhook-events"] });
      if (result.status === 200) {
        toast.success(`Webhook returned ${result.status} — signature verified`);
      } else {
        toast.error(`Webhook returned ${result.status} — check result below`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const secretOk = status.data?.secretConfigured ?? false;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <header>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Console
        </p>
        <h1 className="font-display text-3xl">Webhook health</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Test your Paddle webhook endpoint and verify signature verification
          is working.
        </p>
      </header>

      {/* Status cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatusCard
          icon={secretOk ? ShieldCheck : ShieldAlert}
          label="Webhook secret"
          value={secretOk ? "Configured" : "Missing"}
          variant={secretOk ? "success" : "error"}
        />
        <StatusCard
          icon={Webhook}
          label="Endpoint"
          value="/api/public/paddle-webhook"
          variant="neutral"
        />
        <StatusCard
          icon={Activity}
          label="Latest event"
          value={
            events.data && events.data.length > 0
              ? events.data[0].event_type
              : "None yet"
          }
          variant="neutral"
        />
      </div>

      {/* URLs */}
      <section className="rounded-2xl border border-border/60 bg-card/60 p-6">
        <h2 className="font-display text-xl">Webhook URLs</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste the relevant URL into Paddle → Developer Tools → Notifications.
        </p>
        <div className="mt-4 space-y-3">
          <UrlRow label="Preview" url={`${PREVIEW_URL}${WEBHOOK_PATH}`} />
          <UrlRow label="Published" url={`${PUBLISHED_URL}${WEBHOOK_PATH}`} />
        </div>
      </section>

      {/* Test */}
      <section className="rounded-2xl border border-border/60 bg-card/60 p-6">
        <h2 className="font-display text-xl">Send test event</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Generates a fake <code>transaction.completed</code> event, signs it
          with your webhook secret, and POSTs it to the endpoint. A 200 means
          signature verification passed and the event was accepted.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => sendTest.mutate()}
            disabled={sendTest.isPending || !secretOk}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Send className="size-4" />
            {sendTest.isPending ? "Sending…" : "Send test event"}
          </button>
          {!secretOk && (
            <span className="text-sm text-destructive">
              Configure PADDLE_WEBHOOK_SECRET first.
            </span>
          )}
        </div>

        {lastResult && (
          <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span
                className={`inline-block size-2 rounded-full ${
                  lastResult.status === 200
                    ? "bg-green-500"
                    : lastResult.status === 401
                      ? "bg-destructive"
                      : "bg-amber-500"
                }`}
              />
              {lastResult.status} {lastResult.statusText}
            </div>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/50 p-2 text-xs text-muted-foreground">
              {lastResult.body}
            </pre>
          </div>
        )}
      </section>

      {/* Recent events */}
      <section className="rounded-2xl border border-border/60 bg-card/60 p-6">
        <h2 className="font-display text-xl">Recent webhook events</h2>
        {events.isLoading && (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        )}
        {events.data && events.data.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            No events received yet. Send a test event above or wait for Paddle
            to deliver one.
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Event ID</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2 pr-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((r) => (
                  <tr
                    key={r.event_id}
                    className="border-t border-border/40"
                  >
                    <td className="py-2 pr-3 font-mono text-xs">
                      {r.event_id}
                    </td>
                    <td className="py-2 pr-3">{r.event_type}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {new Date(r.processed_at).toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {r.result ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                          {r.result}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-destructive">
                      {r.error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  variant,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  variant: "success" | "error" | "neutral";
}) {
  const color =
    variant === "success"
      ? "text-green-500"
      : variant === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 p-4">
      <Icon className={`size-5 ${color}`} />
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/60 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground w-16">
          {label}
        </span>
        <code className="truncate text-sm text-foreground">{url}</code>
      </div>
      <button
        onClick={copy}
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <>
            <Check className="size-3" /> Copied
          </>
        ) : (
          <>
            <ClipboardCopy className="size-3" /> Copy
          </>
        )}
      </button>
    </div>
  );
}
