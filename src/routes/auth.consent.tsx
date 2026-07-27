import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { recordBetaConsent, BETA_CONSENT_VERSION } from "@/lib/beta-consent";
import { setBetaConsent } from "@/lib/auth-state";
import { track } from "@/lib/analytics";
import { sanitizeReturnPath } from "@/lib/return-path";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * Beta consent capture — PUBLIC route (outside `_authenticated`).
 *
 * Placing this outside the protected gate means the gate can redirect
 * here without needing a pathname-based bypass, and freshly-confirmed
 * users arriving from `/auth/callback` or `/auth/set-password` reach it
 * before their session has cleared every downstream policy check.
 *
 * The page still requires a live Supabase session; if there is none it
 * bounces the user back to `/auth` so they can sign in.
 */
type ConsentSearch = { next?: string; reason?: string };

export const Route = createFileRoute("/auth/consent")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Beta consent — Tribe Trips" },
      {
        name: "description",
        content:
          "Review Tribe Trips beta terms and consent to participate before entering the app.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): ConsentSearch => ({
    next: typeof search.next === "string" ? search.next : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  component: ConsentPage,
});

type CheckKey = "age" | "beta" | "payments" | "sensitive" | "review" | "stop" | "retention";

const checks: { key: CheckKey; label: string }[] = [
  { key: "age", label: "I am 18 years or older." },
  {
    key: "beta",
    label:
      "I understand Tribe Trips is in private beta and may contain bugs, rough edges, or incomplete features.",
  },
  { key: "payments", label: "I understand payments are test-only during beta." },
  {
    key: "sensitive",
    label:
      "I will not enter sensitive information such as payment cards, passport details, private addresses, health information, real confirmation numbers, or anything I do not want reviewed.",
  },
  {
    key: "review",
    label:
      "If I choose to share screen recordings, voice narration, written feedback, device/browser info, or usage notes, I consent to Tribe Trips reviewing them for product improvement.",
  },
  { key: "stop", label: "I understand I can stop testing or recording at any time." },
  {
    key: "retention",
    label:
      "I understand beta recordings and feedback may be stored for up to 6 months and then deleted, unless retention is needed for security, legal, or product integrity reasons.",
  },
];

function ConsentPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const nextPath = sanitizeReturnPath(search.next);
  const lookupFailed = search.reason === "error";

  const [sessionReady, setSessionReady] = useState<"checking" | "ok" | "missing">("checking");
  const [state, setState] = useState<Record<CheckKey, boolean>>({
    age: false,
    beta: false,
    payments: false,
    sensitive: false,
    review: false,
    stop: false,
    retention: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allChecked = checks.every((c) => state[c.key]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSessionReady(data.session ? "ok" : "missing");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function accept() {
    if (!allChecked || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user.id;
      if (!uid) {
        void navigate({ to: "/auth", replace: true });
        return;
      }
      await recordBetaConsent(uid);
      // Publish resolved status synchronously so the protected gate
      // passes on the next navigation without another RPC round-trip.
      setBetaConsent("current");
      track("consent_accepted", { version: BETA_CONSENT_VERSION });
      // Use a full navigation to guarantee the protected gate re-reads
      // fresh state — TanStack invalidation timing can otherwise race the
      // beforeLoad snapshot immediately after acceptance.
      window.location.assign(nextPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 140) : "unknown";
      track("consent_save_failed", { version: BETA_CONSENT_VERSION, message: msg });
      setErr(e instanceof Error ? e.message : "Could not save consent. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  if (sessionReady === "checking") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="grid min-h-screen place-items-center gap-3 text-sm text-muted-foreground"
      >
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          Getting things ready…
        </span>
      </div>
    );
  }

  if (sessionReady === "missing") {
    return (
      <div className="mx-auto max-w-md px-6 py-12">
        <div className="rounded-2xl border border-border/60 bg-card/70 p-8 backdrop-blur">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Please sign in first.</p>
              <p className="mt-1 text-muted-foreground">
                Beta consent needs an active session. Sign in and you'll be sent back here.
              </p>
            </div>
          </div>
          <Button asChild className="mt-4 w-full">
            <Link to="/auth">Go to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Private beta</p>
      <h1 className="mt-1 font-display text-3xl">Before You Start the Tribe Trips Beta</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Tribe Trips is currently in private beta. You may see bugs, rough edges, or incomplete
        features. Please use realistic but low-sensitivity trip details while testing. Full details
        live in our{" "}
        <a className="underline" href="/privacy" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a className="underline" href="/terms" target="_blank" rel="noreferrer">
          Terms
        </a>
        .
      </p>

      {lookupFailed && (
        <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          We couldn't verify your beta consent automatically. Review the beta terms below and
          continue again, or sign out and try later.
        </div>
      )}

      <div className="mt-6 space-y-3">
        {checks.map((c) => (
          <label
            key={c.key}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-sm transition hover:border-primary/40"
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={state[c.key]}
              onChange={(e) => setState((s) => ({ ...s, [c.key]: e.target.checked }))}
            />
            <span className="text-foreground/90">{c.label}</span>
          </label>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Email{" "}
        <a className="underline" href="mailto:hello@jointribetrips.com">
          hello@jointribetrips.com
        </a>{" "}
        to request deletion of your beta recordings or feedback.
      </p>

      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={decline}
          className="rounded-full border border-border/60 px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Not now, sign me out
        </button>
        <button
          type="button"
          onClick={accept}
          disabled={!allChecked || busy}
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "I Agree and Continue"}
        </button>
      </div>
    </div>
  );
}
