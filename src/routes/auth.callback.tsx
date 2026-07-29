import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureAuthReady,
  primeBetaConsent,
  getAccessState,
} from "@/lib/auth-state";
import { logAuthStage } from "@/lib/auth-diagnostics";
import { clearOAuthPending } from "@/lib/oauth-return";
import { consumePendingRedirect, sanitizeRedirectPath } from "@/lib/redirect-guard";
import { ALLOWED_CALLBACK_TYPES } from "@/lib/auth-email-contract";



/**
 * PKCE / email confirmation callback route.
 *
 * Two shapes arrive here:
 *   - `?code=…` from OAuth (Google/Apple). Runs on mount; must complete in
 *     the same browser that started the flow (PKCE code_verifier in
 *     localStorage).
 *   - `?token_hash=…&type=…` from email confirmation, magic link, recovery,
 *     invite, or email-change. Rendered as a two-step interstitial: no
 *     network call happens until the user presses "Confirm email". This
 *     defeats email scanners and link prefetchers that would otherwise burn
 *     the one-time token before the user opens it.
 */
export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Confirm sign-in — Tribe Trips" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
      // Callback URLs carry a one-time token; belt-and-braces against any
      // intermediary caching the URL. Also stripped from history after use.
      { httpEquiv: "cache-control", content: "no-store" },
    ],
  }),

  component: AuthCallback,
});


type Phase = "exchanging" | "awaiting_confirm" | "verifying" | "routing" | "error";

type OtpType = "signup" | "magiclink" | "recovery" | "invite" | "email_change" | "email";

const VALID_OTP_TYPES = ALLOWED_CALLBACK_TYPES;


const EMAIL_LINK_EXPIRED =
  "This confirmation link has expired or was already used. Request a new email from the sign-in screen.";
const OAUTH_LINK_EXPIRED =
  "This sign-in link has expired or was already used. Please start again from the sign-in screen.";
const OAUTH_PROVIDER_FAILED =
  "Google didn't complete the sign-in. Please try again from the sign-in screen.";
const OAUTH_MISSING =
  "We didn't receive a sign-in confirmation. Please start again from the sign-in screen.";
const FINISH_FAILED_OAUTH =
  "We couldn't complete the sign-in. Please try again from the sign-in screen.";
const FINISH_FAILED_EMAIL =
  "We couldn't finish confirming your email. Please try again from the sign-in screen.";

function AuthCallback() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("exchanging");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pendingRef = useRef<{
    tokenHash: string;
    otpType: OtpType;
    flowType: string | null;
    nextParam: string | null;
  } | null>(null);
  const confirmingRef = useRef(false);

  // finishSession is stable per component instance (closes over navigate).
  async function finishSession(
    flowType: string | null,
    nextParam: string | null,
    isEmail: boolean,
  ): Promise<void> {
    await ensureAuthReady();
    const state = getAccessState();
    logAuthStage("session_hydrated", { ok: true, code: state.tier });

    if (state.isConfirmedPermanent) {
      const userId = (await supabase.auth.getSession()).data.session?.user?.id;
      if (userId) void primeBetaConsent(userId);
      logAuthStage("consent_primed", { ok: true });
    }

    clearOAuthPending();
    setPhase("routing");

    if (flowType === "recovery") {
      logAuthStage("final_navigate", { ok: true, code: "/reset-password" });
      void navigate({ to: "/reset-password", replace: true });
      return;
    }

    const pending = nextParam ?? consumePendingRedirect();
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
        setErrorMessage(isEmail ? FINISH_FAILED_EMAIL : FINISH_FAILED_OAUTH);
        setPhase("error");
    }
  }

  async function handleConfirmClick() {
    if (confirmingRef.current) return;
    const params = pendingRef.current;
    if (!params) return;
    confirmingRef.current = true;
    pendingRef.current = null;

    // Token was already stripped from history on mount for token_hash flows;
    // for OAuth (?code=), strip here as belt-and-braces.
    window.history.replaceState(null, "", "/auth/callback");

    setPhase("verifying");
    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.otpType,
    });

    if (error) {
      const { data: existing } = await supabase.auth.getSession();
      if (!existing.session) {
        clearOAuthPending();
        logAuthStage("code_exchange_failed", { ok: false, code: "otp_verify_failed" });
        setErrorMessage(EMAIL_LINK_EXPIRED);
        setPhase("error");
        return;
      }
      logAuthStage("code_exchange_ok", { ok: true, msg: "session_present_after_otp_error" });
    } else {
      logAuthStage("code_exchange_ok", { ok: true, msg: "otp_verified" });
    }

    await finishSession(params.flowType, params.nextParam, true);
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      logAuthStage("callback_reached");
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const rawType = url.searchParams.get("type");
      const nextParam = url.searchParams.get("next");
      const errorParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");

      if (errorParam) {
        clearOAuthPending();
        logAuthStage("callback_error_param", { ok: false, code: "oauth_provider_failed" });
        if (!cancelled) {
          setErrorMessage(OAUTH_PROVIDER_FAILED);
          setPhase("error");
        }
        return;
      }

      // Email confirmation branch: DO NOT verify on mount. Stash params in a
      // ref, IMMEDIATELY strip them from history (before rendering the
      // interstitial so any third-party assets loaded by children never see
      // the token in the URL), and render the interstitial so scanners /
      // prefetchers don't burn the token.
      if (tokenHash && !code) {
        // Strict allowlist — never trust the URL-supplied `type`.
        const otpType = (rawType && ALLOWED_CALLBACK_TYPES.has(rawType) ? rawType : "email") as OtpType;
        pendingRef.current = {
          tokenHash,
          otpType,
          flowType: rawType,
          nextParam,
        };
        window.history.replaceState(null, "", "/auth/callback");
        if (!cancelled) setPhase("awaiting_confirm");
        return;
      }


      if (code) {
        // OAuth PKCE exchange. Must complete in the originating browser.
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data: existing } = await supabase.auth.getSession();
          if (!existing.session) {
            clearOAuthPending();
            logAuthStage("code_exchange_failed", { ok: false, code: "oauth_set_session_failed" });
            if (!cancelled) {
              setErrorMessage(OAUTH_LINK_EXPIRED);
              setPhase("error");
            }
            return;
          }
          logAuthStage("code_exchange_ok", { ok: true, msg: "auto_detected_session" });
        } else {
          logAuthStage("code_exchange_ok", { ok: true });
        }
      } else {
        // Bare visit — no token, no code, no error. If the SDK auto-detected
        // a session earlier, route normally; otherwise error.
        const { data: existing } = await supabase.auth.getSession();
        if (!existing.session) {
          clearOAuthPending();
          logAuthStage("code_exchange_failed", { ok: false, code: "oauth_token_delivery_missing" });
          if (!cancelled) {
            setErrorMessage(OAUTH_MISSING);
            setPhase("error");
          }
          return;
        }
      }

      // Strip any query params so a refresh doesn't retry.
      window.history.replaceState(null, "", "/auth/callback");
      if (cancelled) return;
      await finishSession(rawType, nextParam, false);
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (phase === "awaiting_confirm") {
    return (
      <div className="grid min-h-screen place-items-center px-6 py-12">
        <div className="max-w-md space-y-5 text-center">
          <h1 className="font-display text-2xl">Confirm your email</h1>
          <p className="text-sm text-muted-foreground">
            Tap Confirm to finish signing in to Tribe. Only continue if you started this sign-in.
          </p>
          <button
            type="button"
            onClick={handleConfirmClick}
            className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Confirm email
          </button>
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
        {phase === "exchanging" || phase === "verifying" ? "Finishing sign-in…" : "Taking you in…"}
      </span>
    </div>
  );
}
