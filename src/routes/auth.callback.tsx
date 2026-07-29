import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureAuthReady,
  primeBetaConsent,
  getAccessState,
} from "@/lib/auth-state";
import { logAuthStage } from "@/lib/auth-diagnostics";
import { clearOAuthPending } from "@/lib/oauth-return";
import { consumePendingRedirect, sanitizeRedirectPath } from "@/lib/redirect-guard";


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
 *   - permanent, missing consent                   → /auth/consent
 *   - anonymous (shouldn't happen post-exchange)   → /
 *   - signed out (exchange failed / user missing)  → /auth with error
 */
export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing in — Tribe Trips" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
      // Callback URLs carry a one-time PKCE code; belt-and-braces against any
      // intermediary caching the URL. Also stripped from history after use.
      { httpEquiv: "cache-control", content: "no-store" },
    ],
  }),
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
      logAuthStage("callback_reached");
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const flowType = url.searchParams.get("type"); // 'signup' | 'recovery' | 'magiclink' | 'invite' | 'email_change'
      const nextParam = url.searchParams.get("next");
      const errorParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");

      if (errorParam) {
        // Google denied / user cancelled / provider hiccup. Clear the OAuth
        // pending marker so a later legitimate visit to /auth doesn't enter
        // reconciliation for a dead flow.
        clearOAuthPending();
        logAuthStage("callback_error_param", { ok: false, code: "oauth_provider_failed" });
        if (!cancelled) {
          // Do NOT surface the raw provider error (may contain email/subject).
          setErrorMessage(
            "Google didn't complete the sign-in. Please try again from the sign-in screen.",
          );
          setPhase("error");
        }
        return;
      }

      // token_hash branch — stateless email confirmation. Works cross-browser
      // and cross-device because it doesn't need a PKCE code_verifier. Used
      // for signup, magiclink, recovery, invite, email_change.
      if (tokenHash) {
        // Supabase's verifyOtp accepts these string types for email flows.
        const validTypes = new Set([
          "signup",
          "magiclink",
          "recovery",
          "invite",
          "email_change",
          "email",
        ]);
        const otpType = (flowType && validTypes.has(flowType) ? flowType : "email") as
          | "signup"
          | "magiclink"
          | "recovery"
          | "invite"
          | "email_change"
          | "email";
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType,
        });
        if (error) {
          const { data: existing } = await supabase.auth.getSession();
          if (!existing.session) {
            clearOAuthPending();
            logAuthStage("code_exchange_failed", { ok: false, code: "otp_verify_failed" });
            if (!cancelled) {
              setErrorMessage(
                "This sign-in link has expired or was already used. Please start again from the sign-in screen.",
              );
              setPhase("error");
            }
            return;
          }
          logAuthStage("code_exchange_ok", { ok: true, msg: "session_present_after_otp_error" });
        } else {
          logAuthStage("code_exchange_ok", { ok: true, msg: "otp_verified" });
        }
      } else if (code) {
        // OAuth (Google/Apple) PKCE exchange. Must complete in the same
        // browser that initiated sign-in (code_verifier in localStorage).
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data: existing } = await supabase.auth.getSession();
          if (!existing.session) {
            clearOAuthPending();
            // Sanitized: don't leak provider/SDK error text.
            logAuthStage("code_exchange_failed", { ok: false, code: "oauth_set_session_failed" });
            if (!cancelled) {
              setErrorMessage(
                "This sign-in link has expired or was already used. Please start again from the sign-in screen.",
              );
              setPhase("error");
            }
            return;
          }
          logAuthStage("code_exchange_ok", { ok: true, msg: "auto_detected_session" });
        } else {
          logAuthStage("code_exchange_ok", { ok: true });
        }
      } else {
        // Neither code nor token_hash and no error: either the SDK
        // auto-detected on a prior tick (session present) or someone hit
        // /auth/callback directly.
        const { data: existing } = await supabase.auth.getSession();
        if (!existing.session) {
          clearOAuthPending();
          logAuthStage("code_exchange_failed", { ok: false, code: "oauth_token_delivery_missing" });
          if (!cancelled) {
            setErrorMessage(
              "We didn't receive a sign-in confirmation. Please start again from the sign-in screen.",
            );
            setPhase("error");
          }
          return;
        }
      }


      // Strip code/state/error from the URL so a refresh doesn't try to
      // re-exchange and so the code never lingers in browser history.
      window.history.replaceState(null, "", "/auth/callback");

      // Confirm session is readable from the shared auth store BEFORE we
      // clear the OAuth pending marker — the marker is what protects a fresh
      // session from a stale SIGNED_OUT event in the __root listener.
      await ensureAuthReady();
      const state = getAccessState();
      logAuthStage("session_hydrated", { ok: true, code: state.tier });

      if (state.isConfirmedPermanent) {
        const userId = (await supabase.auth.getSession()).data.session?.user?.id;
        if (userId) void primeBetaConsent(userId);
        logAuthStage("consent_primed", { ok: true });
      }

      // Session is confirmed and stored — safe to release the pending marker.
      clearOAuthPending();

      if (cancelled) return;
      setPhase("routing");

      if (flowType === "recovery") {
        logAuthStage("final_navigate", { ok: true, code: "/reset-password" });
        void navigate({ to: "/reset-password", replace: true });
        return;
      }

      // Consume any pending same-origin destination the caller stashed
      // before starting OAuth (e.g. /join/$token). sanitizeRedirectPath
      // enforces same-origin + relative; anything unsafe falls back to /app.
      const pending = consumePendingRedirect();
      const safePending = pending ? sanitizeRedirectPath(pending, { fallback: "/app" }) : "/app";


      switch (state.tier) {
        case "confirmed_permanent_with_current_consent": {
          logAuthStage("consent_route_current", { ok: true });
          logAuthStage("final_navigate", { ok: true, code: safePending });
          void navigate({ to: safePending, replace: true });
          return;
        }
        case "confirmed_permanent_without_consent":
          logAuthStage("consent_route_missing", { ok: true });
          logAuthStage("final_navigate", { ok: true, code: "/auth/consent" });
          void navigate({
            to: "/auth/consent",
            search: { next: safePending, reason: "missing" },
            replace: true,
          });
          return;

        case "exploring_anonymously":
          logAuthStage("final_navigate", { ok: true, code: "/" });
          void navigate({ to: "/", replace: true });
          return;
        case "signed_out":
        default:
          clearOAuthPending();
          logAuthStage("session_hydration_timeout", { ok: false, code: state.tier });
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
