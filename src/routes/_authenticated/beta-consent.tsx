import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BETA_CONSENT_KEY, BETA_CONSENT_VERSION } from "@/lib/beta-consent";

export const Route = createFileRoute("/_authenticated/beta-consent")({
  component: BetaConsentPage,
});

type CheckKey = "age" | "beta" | "review" | "sensitive" | "stop" | "retention";

const checks: { key: CheckKey; label: string }[] = [
  { key: "age", label: "I am 18 years or older." },
  {
    key: "beta",
    label:
      "I understand Tribe Trips is in private beta and may contain bugs or incomplete features.",
  },
  {
    key: "review",
    label:
      "I consent to Tribe Trips reviewing my screen recording, voice narration, written feedback, and usage notes for product improvement.",
  },
  {
    key: "sensitive",
    label:
      "I understand I should not enter payment card details, passport information, private addresses, real confirmation numbers, health information, or other sensitive information while testing.",
  },
  { key: "stop", label: "I understand I can stop testing or recording at any time." },
  {
    key: "retention",
    label:
      "I understand my beta feedback and recordings may be stored for up to 6 months and then deleted.",
  },
];

function BetaConsentPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<Record<CheckKey, boolean>>({
    age: false,
    beta: false,
    review: false,
    sensitive: false,
    stop: false,
    retention: false,
  });
  const [busy, setBusy] = useState(false);

  const allChecked = checks.every((c) => state[c.key]);

  async function accept() {
    if (!allChecked || busy) return;
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user.id ?? "anon";
      window.localStorage.setItem(
        BETA_CONSENT_KEY,
        JSON.stringify({
          v: BETA_CONSENT_VERSION,
          uid,
          at: new Date().toISOString(),
          checks: state,
        }),
      );
      navigate({ to: "/trips", replace: true });
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="mx-auto max-w-2xl px-1 py-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Private beta</p>
      <h1 className="mt-1 font-display text-3xl">Welcome, beta tester</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Before you jump in, please confirm a few things. This takes about 30 seconds and you only
        see it once. The full details are in our{" "}
        <a className="underline" href="/privacy" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a className="underline" href="/terms" target="_blank" rel="noreferrer">
          Terms
        </a>
        .
      </p>

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
        Recordings and feedback are reviewed by the founder and a small group of analysts. We keep
        them up to 6 months, then delete — email{" "}
        <a className="underline" href="mailto:hello@tgklabs.io">
          hello@tgklabs.io
        </a>{" "}
        to request deletion sooner.
      </p>

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
          {busy ? "Saving…" : "I agree, start testing"}
        </button>
      </div>
    </div>
  );
}
