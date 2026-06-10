import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Search, CheckCircle2, XCircle, ShieldCheck, Loader2, ExternalLink, Plane, Sparkles } from "lucide-react";
import { getIntegrationsStatus, testSerpstack } from "@/lib/integrations.functions";
import { lookupFlight } from "@/lib/flight-lookup.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Tribe Trips" },
      { name: "description", content: "Manage integrations and API connectivity for Tribe Trips." },
    ],
  }),
  component: SettingsPage,
});

type TestResult = Awaited<ReturnType<typeof testSerpstack>>;
type FlightResult = Awaited<ReturnType<typeof lookupFlight>>;

const SAMPLE_QUERY = "DL123 from JFK to LAX";

function SettingsPage() {
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
      <header>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage integrations powering AI lookups and verification.
        </p>
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
                Real-time Google search results used as a fallback to verify flight info
                when the schedule API doesn't return a match.
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
              To rotate or change the key, update it from your project's secrets manager.
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
    </div>
  );
}
