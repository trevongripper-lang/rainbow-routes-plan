import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Loader2,
  ExternalLink,
  Plane,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { getIntegrationsStatus, testSerpstack } from "@/lib/integrations.functions";
import { lookupFlight } from "@/lib/flight-lookup.functions";
import { runRlsSmokeTests, type SmokeCheck } from "@/lib/rls-smoke.functions";

export const Route = createFileRoute("/_authenticated/console/diagnostics")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getSession();
    if (!userData.session) throw notFound();
    const { data } = await supabase.rpc("has_role", {
      _user_id: userData.session.user.id,
      _role: "admin",
    });
    if (!data) throw notFound();
  },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Diagnostics — Console" },
    ],
  }),
  component: DiagnosticsPage,
});

type TestResult = Awaited<ReturnType<typeof testSerpstack>>;
type FlightResult = Awaited<ReturnType<typeof lookupFlight>>;

const SAMPLE_QUERY = "DL123 from JFK to LAX";

function DiagnosticsPage() {
  const getStatus = useServerFn(getIntegrationsStatus);
  const runTest = useServerFn(testSerpstack);
  const runLookup = useServerFn(lookupFlight);

  const status = useQuery({
    queryKey: ["integrations-status"],
    queryFn: () => getStatus(),
  });

  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const [flightQuery, setFlightQuery] = useState(SAMPLE_QUERY);
  const [flightTesting, setFlightTesting] = useState(false);
  const [flightResult, setFlightResult] = useState<FlightResult | null>(null);
  const [flightError, setFlightError] = useState<string | null>(null);
  const [flightElapsed, setFlightElapsed] = useState<number | null>(null);

  async function onTest() {
    setTesting(true);
    setResult(null);
    try {
      const r = await runTest();
      setResult(r);
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Test failed",
      } as TestResult);
    } finally {
      setTesting(false);
    }
  }

  async function onFlightTest() {
    setFlightTesting(true);
    setFlightResult(null);
    setFlightError(null);
    setFlightElapsed(null);
    const start = Date.now();
    try {
      const r = await runLookup({ data: { query: flightQuery.trim() || SAMPLE_QUERY } });
      setFlightResult(r);
    } catch (e) {
      setFlightError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setFlightElapsed(Date.now() - start);
      setFlightTesting(false);
    }
  }

  const configured = status.data?.serpstack.configured ?? false;
  const aviationConfigured = status.data?.aviationstack.configured ?? false;

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Back to Settings
          </Link>
          <h1 className="mt-1 font-display text-3xl">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin-only integration, RLS and webhook diagnostics.
          </p>
        </div>
        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
          Admin
        </Badge>
      </header>

      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Search className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg">Serpstack</h2>
                {configured ? (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="size-3 text-emerald-500" /> Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <XCircle className="size-3" /> Not configured
                  </Badge>
                )}
              </div>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                Real-time Google search results used as a fallback to verify flight info when the
                schedule API doesn't return a match.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <div>
            <Label className="text-xs">API key</Label>
            <div className="flex gap-2">
              <Input
                value={configured ? "•••••••••••••••••••• (stored securely)" : "Not set"}
                readOnly
                className="font-mono text-sm"
              />
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
              Keys are stored server-side as encrypted secrets and never sent to the browser.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={onTest} disabled={testing || !configured}>
              {testing ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" /> Testing...
                </>
              ) : (
                "Test connectivity"
              )}
            </Button>
            <a
              href="https://serpstack.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Serpstack dashboard <ExternalLink className="size-3" />
            </a>
          </div>

          {result && (
            <div
              className={`mt-2 rounded-xl border p-3 text-sm ${
                result.ok
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-destructive/30 bg-destructive/5"
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {result.ok ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <XCircle className="size-4 text-destructive" />
                )}
                {result.message}
              </div>
              {result.ok && result.sample && (
                <div className="mt-2 rounded-lg bg-background/60 p-2 text-xs">
                  <div className="font-medium">{result.sample.title}</div>
                  <div className="truncate text-muted-foreground">{result.sample.url}</div>
                  {result.sample.snippet && (
                    <div className="mt-1 text-muted-foreground">{result.sample.snippet}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plane className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg">Flight lookup test</h2>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="size-3" /> End-to-end
              </Badge>
            </div>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Runs a sample query through the full pipeline: AI parse →
              {aviationConfigured ? " AviationStack verify →" : ""}
              {configured ? " Serpstack fallback." : " AI only."}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <div>
            <Label className="text-xs">Sample query</Label>
            <Input
              value={flightQuery}
              onChange={(e) => setFlightQuery(e.target.value)}
              placeholder={SAMPLE_QUERY}
              maxLength={200}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onFlightTest} disabled={flightTesting}>
              {flightTesting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" /> Running...
                </>
              ) : (
                "Run flight lookup test"
              )}
            </Button>
            {flightElapsed !== null && !flightTesting && (
              <span className="text-xs text-muted-foreground">Completed in {flightElapsed} ms</span>
            )}
          </div>

          {flightError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <XCircle className="size-4 text-destructive" />
                {flightError}
              </div>
            </div>
          )}

          {flightResult && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <span className="font-medium">Lookup succeeded</span>
                <ProviderBadge source={flightResult.source} />
                <Badge variant="outline" className="capitalize">
                  confidence: {flightResult.confidence}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                <Field label="Airline" value={flightResult.airline} />
                <Field label="Flight #" value={flightResult.flight_number} />
                <Field label="Date" value={flightResult.flight_date} />
                <Field label="From" value={flightResult.depart_airport} />
                <Field label="To" value={flightResult.arrive_airport} />
                <Field label="Depart" value={flightResult.depart_time} />
                <Field label="Arrive" value={flightResult.arrive_time} />
              </dl>
              {flightResult.notes && (
                <p className="mt-3 border-t border-emerald-500/20 pt-2 text-xs text-muted-foreground">
                  {flightResult.notes}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <RlsSmokeSection />

      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <h2 className="font-display text-lg">More admin tools</h2>
        <ul className="mt-3 grid gap-2 text-sm">
          <li>
            <Link to="/console/webhook-test" className="text-primary hover:underline">
              Webhook test console →
            </Link>
          </li>
          <li>
            <Link to="/console/analytics" className="text-primary hover:underline">
              Analytics →
            </Link>
          </li>
          <li>
            <Link to="/console/events" className="text-primary hover:underline">
              Events console →
            </Link>
          </li>
          <li>
            <Link to="/console/promo-codes" className="text-primary hover:underline">
              Promo codes →
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

function RlsSmokeSection() {
  const run = useServerFn(runRlsSmokeTests);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof runRlsSmokeTests>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onRun() {
    setLoading(true);
    setErr(null);
    try {
      setData(await run());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Smoke test failed");
    } finally {
      setLoading(false);
    }
  }

  const failed = data?.checks.filter((c) => !c.ok) ?? [];
  const passed = data?.checks.filter((c) => c.ok) ?? [];

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-lg">RLS smoke tests</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Runs a read against every table and helper function as the signed-in user. Run this
              after any database migration to catch revoked GRANTs / EXECUTE before users do.
            </p>
          </div>
        </div>
        <Button onClick={onRun} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" /> Running...
            </>
          ) : (
            "Run smoke tests"
          )}
        </Button>
      </div>

      {err && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {data && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
            >
              {passed.length} passing
            </Badge>
            <Badge
              variant="outline"
              className={
                failed.length
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground"
              }
            >
              {failed.length} failing
            </Badge>
            <span className="text-muted-foreground">as user {data.user_id.slice(0, 8)}…</span>
          </div>

          {failed.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">
                Failures
              </div>
              <ul className="space-y-2">
                {failed.map((c) => (
                  <SmokeRow key={`${c.kind}:${c.name}`} c={c} />
                ))}
              </ul>
            </div>
          )}

          <details className="rounded-xl border border-border/60 bg-background/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              All checks ({data.checks.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {data.checks.map((c) => (
                <SmokeRow key={`${c.kind}:${c.name}`} c={c} />
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

function SmokeRow({ c }: { c: SmokeCheck }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {c.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase">
        {c.kind}
      </span>
      <span className="font-mono">{c.name}</span>
      <span className="ml-auto text-muted-foreground">
        {c.ms}ms{c.status ? ` · ${c.status}` : ""}
      </span>
      {!c.ok && c.message && (
        <span className="ml-2 max-w-md truncate text-destructive" title={c.message}>
          {c.code ? `[${c.code}] ` : ""}
          {c.message}
        </span>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono">
        {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function ProviderBadge({ source }: { source?: "ai" | "aviationstack" | "serpstack" }) {
  const map = {
    aviationstack: {
      label: "AviationStack",
      className: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    },
    serpstack: {
      label: "Serpstack",
      className: "bg-purple-500/15 text-purple-600 border-purple-500/30",
    },
    ai: { label: "AI only", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  } as const;
  const cfg = map[source ?? "ai"];
  return (
    <Badge variant="outline" className={cfg.className}>
      Source: {cfg.label}
    </Badge>
  );
}
