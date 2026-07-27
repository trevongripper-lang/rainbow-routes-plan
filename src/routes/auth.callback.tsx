import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureAuthReady,
  primeBetaConsent,
  getAccessState,
} from "@/lib/auth-state";

/**
 * PKCE callback route.
 *
 * Supabase sends the user here with `?code=…` after email confirmation, magic
 * link, password reset, or (later) OAuth. `detectSessionInUrl: true` on the
 * client normally consumes that automatically, but we do it explicitly here so
 * we can react to failures (expired code, wrong browser) with a real error UI
 * instead of silently landing on the home page with no session.
 *
 * After a successful exchange, we route by tier:
 *   - password recovery (`type=recovery`)          → /reset-password
 *   - permanent, current consent                   → /app
 *   - permanent, missing consent                   → /beta-consent
 *   - anonymous (shouldn't happen post-exchange)   → /
 *   - signed out (exchange failed / user missing)  → /auth with error
 */
export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

type Phase = "exchanging" | "routing" | "error";

function AuthCallback() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("exchanging");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const flowType = url.searchParams.get("type"); // supabase sends 'recovery' etc.
      const errorParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");

      if (errorParam) {
        if (!cancelled) {
          setErrorMessage(decodeURIComponent(errorParam));
          setPhase("error");
        }
        return;
      }

      // Exchange the PKCE code if present. When `detectSessionInUrl` already
      // consumed it, `exchangeCodeForSession` throws "invalid request" — we
      // treat a live session as success and fall through.
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data: existing } = await supabase.auth.getSession();
          if (!existing.session) {
            if (!cancelled) {
              setErrorMessage(
                "This confirmation link has expired or was already used. Request a new one from the sign-in screen.",
              );
              setPhase("error");
            }
            return;
          }
        }
      }

      // Strip PKCE params from the URL so a refresh doesn't try to re-exchange
      // and so the code never lingers in browser history.
      window.history.replaceState(null, "", "/auth/callback");

      // Make sure the shared auth store reflects the new session before we
      // read the tier for routing.
      await ensureAuthReady();
      const state = getAccessState();

      // Prime beta consent so the destination gate has it warm.
      if (state.isConfirmedPermanent) {
        const userId = (await supabase.auth.getSession()).data.session?.user?.id;
        if (userId) void primeBetaConsent(userId);
      }

      if (cancelled) return;
      setPhase("routing");

      if (flowType === "recovery") {
        void navigate({ to: "/reset-password", replace: true });
        return;
      }

      switch (state.tier) {
        case "confirmed_permanent_with_current_consent":
          void navigate({ to: "/app", replace: true });
          return;
        case "confirmed_permanent_without_consent":
          void navigate({
            to: "/beta-consent",
            search: { next: "/app", reason: "missing" },
            replace: true,
          });
          return;
        case "exploring_anonymously":
          // Anonymous shouldn't come through the callback; fall through to home.
          void navigate({ to: "/", replace: true });
          return;
        case "signed_out":
        default:
          if (!cancelled) {
            setErrorMessage(
              "We couldn't complete the sign-in. Please try again from the sign-in screen.",
            );
            setPhase("error");
          }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (phase === "error") {
    return (
      <div className="grid min-h-screen place-items-center px-6 py-12">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-display text-2xl">Confirmation link problem</h1>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <a
            href="/auth"
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

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
        {phase === "exchanging" ? "Finishing sign-in…" : "Taking you in…"}
      </span>
    </div>
  );
}
