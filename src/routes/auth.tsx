import { createFileRoute, Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { rlCheckPublic } from "@/lib/rate-limit.functions";
import { track } from "@/lib/analytics";
import { beginAuthCorrelation, logAuthStage } from "@/lib/auth-diagnostics";
import {
  sanitizeRedirectPath,
  stashPendingRedirect,
  getPendingRedirect,
  consumePendingRedirect,
} from "@/lib/redirect-guard";
import {
  SESSION_HYDRATION_ERROR_MESSAGE,
  clearAuthSession,
  getAuthState,
  refreshAuthState,
  resetAuthState,
  setAuthSession,
  useAuth,
} from "@/lib/auth-state";
import { withTimeout } from "@/lib/utils";
import { canonicalEmailOrigin, canonicalOAuthOrigin, needsOAuthOriginCanonicalization } from "@/lib/canonical-origin";
import {
  clearOAuthPending,
  isBrowserStorageUsable,
  markOAuthPending,
  readOAuthPending,
  toPublicOAuthErrorCode,
  detectBrowserMode,
  classifyOrigin,
} from "@/lib/oauth-return";

type AuthSearch = { redirect?: string };

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Tribe Trips" },
      {
        name: "description",
        content:
          "Sign in or create your Tribe Trips account to pitch destinations, invite your crew, and start planning your next group trip.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): AuthSearch => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  // Child routes (/auth/callback, /auth/consent, /auth/set-password) mount
  // under this parent; render their outlet instead of the sign-in shell.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/auth" && pathname !== "/auth/") {
    return <Outlet />;
  }
  const search = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const rlCheck = useServerFn(rlCheckPublic);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState<{ scope: string; until: number } | null>(null);
  const [confirmSent, setConfirmSent] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [retryingSession, setRetryingSession] = useState(false);
  const [resettingSession, setResettingSession] = useState(false);
  const [redirectRecovery, setRedirectRecovery] = useState<{ target: string; message: string } | null>(null);
  const [redirectPhase, setRedirectPhase] = useState<"idle" | "confirming" | "navigating">("idle");
  const [oauthReconcile, setOauthReconcile] = useState<
    | { phase: "reconciling"; message: string }
    | { phase: "error"; title: string; message: string; code: string; intendedOrigin?: string }
    | null
  >(null);
  const [reconcileRetrying, setReconcileRetrying] = useState(false);
  const redirectingRef = useRef(false);
  const redirectTimeoutRef = useRef<number | null>(null);

  // Resolve the final post-auth destination. Prefer the search-param
  // redirect (e.g. /join/$token), fall back to any pending redirect stashed
  // in sessionStorage (survives full-page OAuth), then /app.
  const redirectTarget = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return sanitizeRedirectPath(search.redirect ?? getPendingRedirect() ?? "/app", {
      fallback: "/app",
    });
  }, [search.redirect]);

  const secsLeft = cooldown ? Math.max(0, Math.ceil((cooldown.until - Date.now()) / 1000)) : 0;
  const blocked = secsLeft > 0;

  const clearRedirectTimeout = useCallback(() => {
    if (!redirectTimeoutRef.current) return;
    window.clearTimeout(redirectTimeoutRef.current);
    redirectTimeoutRef.current = null;
  }, []);

  const startRedirectRecoveryTimer = useCallback(() => {
    clearRedirectTimeout();
    redirectTimeoutRef.current = window.setTimeout(() => {
      console.warn("[auth] post-login navigation did not complete within 5s", { redirectTarget });
      redirectingRef.current = false;
      setRedirectPhase("idle");
      setRedirectRecovery({
        target: redirectTarget,
        message: "Your session is ready, but navigation did not complete automatically.",
      });
    }, 5_000);
  }, [clearRedirectTimeout, redirectTarget]);

  // Post-auth navigation. Safari (both regular and PWA) can freeze a
  // client-side transition mid-flight and serve the pre-login page from
  // bfcache on the next view. Force a real navigation with
  // `window.location.replace` so the app fully re-hydrates against the
  // fresh session. `redirectTarget` is already a sanitized same-origin path.
  const goToApp = useCallback(async (opts: { skipSessionCheck?: boolean } = {}) => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    setRedirectRecovery(null);
    setRedirectPhase("confirming");
    startRedirectRecoveryTimer();

    console.info("[auth] confirming session before redirect", { redirectTarget });
    const confirmed = opts.skipSessionCheck
      ? getAuthState()
      : await withTimeout(refreshAuthState(), 3_500, "Post-login session confirmation").catch(
          (err) => {
            console.warn("[auth] session confirmation failed before redirect", {
              redirectTarget,
              error: err instanceof Error ? err.message : String(err),
            });
            return getAuthState();
          },
        );
    if (!confirmed.session) {
      redirectingRef.current = false;
      setRedirectPhase("idle");
      clearRedirectTimeout();
      toast.error("We couldn't confirm your session yet. Please try again.");
      return;
    }
    consumePendingRedirect();

    setRedirectPhase("navigating");

    // Full-page navigation on ALL platforms. The client-side SPA transition
    // after sign-in races the root onAuthStateChange listener and stalls
    // (blank/stuck screen), especially after Google OAuth return and inside
    // installed PWAs. A hard nav reloads the app cleanly against the fresh
    // session. `redirectTarget` is already a sanitized same-origin path.
    // Full-page navigation on ALL platforms. The client-side SPA transition
    // after sign-in races the root onAuthStateChange listener and stalls
    // (blank/stuck screen), especially after Google OAuth return and inside
    // installed PWAs. A hard nav reloads the app cleanly against the fresh
    // session. `redirectTarget` is already a sanitized same-origin path.
    logAuthStage("final_navigate", { ok: true, code: redirectTarget });
    console.info("[auth] goToApp: window.location.assign", { redirectTarget });
    window.location.assign(redirectTarget);
  }, [clearRedirectTimeout, redirectTarget, router, startRedirectRecoveryTimer]);

  useEffect(() => () => clearRedirectTimeout(), [clearRedirectTimeout]);


  // Callback-parameter forwarding. Some Google returns (misconfigured
  // upstream redirects, browser back-nav after Google, PWAs that intercept
  // the callback path) land on `/auth?code=…` or `/auth?error=…` instead of
  // `/auth/callback?…`. `/auth/callback` is the SINGLE owner of the PKCE
  // exchange — forward the full query there before any polling / login-shell
  // render so the code is exchanged exactly once. Fixes the
  // `oauth_return_poll_timeout` seen when polling replaced the exchange.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.pathname !== "/auth" && url.pathname !== "/auth/") return;
    const hasCallbackParam =
      url.searchParams.has("code") ||
      url.searchParams.has("error") ||
      url.searchParams.has("error_description");
    if (!hasCallbackParam) return;
    logAuthStage("callback_reached", { ok: true, code: "forwarded_from_auth" });
    // Preserve every param; `/auth/callback` reads `code`, `error`,
    // `error_description`, and `type` (for password recovery).
    window.location.replace(`/auth/callback${url.search}`);
  }, []);

  // If a session already exists (e.g. user returned from OAuth redirect, or
  // signed in in another tab), bounce off /auth. Re-confirm with Supabase
  // before navigating so a just-cleared sign-out (whose in-memory snapshot
  // may still show a session for a tick) does NOT bounce back to /app.
  useEffect(() => {
    if (!auth.ready || !auth.session) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;
      void goToApp();
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.ready, auth.session, goToApp]);

  // OAuth-return reconciliation. If a pending marker exists from a prior
  // `signInWithOAuth` call, we're mid-return: DO NOT render the login shell.
  // Poll for a real session (bounded), verify persistence via read-back,
  // then hard-navigate. On failure, surface a recoverable error UI.
  useEffect(() => {
    const pending = readOAuthPending();
    if (!pending) return;
    let cancelled = false;

    // Storage availability check — the top failure mode on iOS in-app
    // browsers / private mode: setSession has nothing to persist to.
    if (!isBrowserStorageUsable()) {
      logAuthStage("session_hydration_timeout", { ok: false, code: "storage_unavailable" });
      clearOAuthPending();
      setOauthReconcile({
        phase: "error",
        title: "Browser storage is blocked",
        code: "oauth_storage_unavailable",
        message:
          "This browser is blocking site storage, so we can't finish signing you in. Try a normal browser window (not private mode) or another browser.",
      });
      return;
    }

    // Origin mismatch — started on www but landed on apex (or vice versa)
    // will fail because the session was written to a different origin's storage.
    const currentOrigin = window.location.origin;
    if (pending.origin && pending.origin !== currentOrigin) {
      logAuthStage("session_hydration_timeout", {
        ok: false,
        code: "origin_mismatch",
        msg: `${pending.originCategory}→${currentOrigin.replace(/^https?:\/\//, "")}`,
      });
      clearOAuthPending();
      setOauthReconcile({
        phase: "error",
        title: "Sign-in returned to a different address",
        code: "oauth_origin_mismatch",
        message:
          "Google sent you back to a different address than the one you started on. Retry to continue on the original address.",
        intendedOrigin: pending.origin,
      });
      return;
    }

    logAuthStage("oauth_return_detected", { ok: true, code: pending.mode });
    setOauthReconcile({ phase: "reconciling", message: "Finishing Google sign-in…" });

    let attempts = 0;
    const MAX_ATTEMPTS = 16; // ~8s at 500ms
    const poll = async () => {
      if (cancelled) return;
      attempts += 1;
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        // Read-back to prove the session actually persisted to storage before
        // we do a full-page navigation.
        const verify = await supabase.auth.getSession();
        if (cancelled) return;
        if (!verify.data.session) {
          // Persistence did not stick — treat as failure.
          logAuthStage("session_hydration_timeout", { ok: false, code: "persist_readback_missing" });
          clearOAuthPending();
          setOauthReconcile({
            phase: "error",
            title: "Session didn't persist",
            code: "oauth_session_not_persisted",
            message:
              "We received your Google sign-in but this browser didn't store the session. Try again, or use a normal browser window.",
            intendedOrigin: pending.origin ?? currentOrigin,
          });
          return;
        }
        logAuthStage("session_hydrated", { ok: true, code: "oauth_return" });
        clearOAuthPending();
        setAuthSession(verify.data.session);
        setOauthReconcile(null);
        void goToApp({ skipSessionCheck: true });
        return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        logAuthStage("session_hydration_timeout", { ok: false, code: "oauth_return_poll" });
        clearOAuthPending();
        setOauthReconcile({
          phase: "error",
          title: "Google sign-in didn't complete",
          code: "oauth_return_poll_timeout",
          message:
            "We couldn't confirm your session after returning from Google. Try again, or reset the session and start over.",
          intendedOrigin: pending.origin ?? currentOrigin,
        });
        return;
      }
      window.setTimeout(() => void poll(), 500);
    };
    void poll();

    return () => {
      cancelled = true;
    };
  }, [goToApp]);



  async function guard(scope: "login" | "reset" | "signup", emailVal: string): Promise<boolean> {
    const r = await rlCheck({ data: { scope, email: emailVal } });
    if (!r.allowed) {
      setCooldown({ scope, until: Date.now() + r.retryAfter * 1000 });
      const label = scope === "login" ? "sign-in" : scope === "reset" ? "reset" : "signup";
      toast.error(`Too many ${label} attempts. Try again in ${r.retryAfter}s.`);
      return false;
    }
    return true;
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (blocked) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        if (!(await guard("signup", email))) return;
        track("signup_started");
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: canonicalEmailOrigin() + "/auth/callback",
            data: { full_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        // If email confirmation is required, identities is an empty array or
        // session is null. Show the confirmation panel instead of switching modes.
        if (!data.session) {
          track("signup_confirmation_required");
          setConfirmSent(email);
          return;
        }
        // Auto-confirm enabled — straight into the app.
        setAuthSession(data.session);
        track("signin_succeeded", { method: "signup_autoconfirm" });
        await goToApp({ skipSessionCheck: true });
      } else {
        if (!(await guard("login", email))) return;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const confirmed = await refreshAuthState();
        if (!confirmed.session) throw new Error("Sign-in succeeded, but the session is not ready yet.");
        track("signin_succeeded", { method: "password" });
        await goToApp({ skipSessionCheck: true });
      }
    } catch (err) {
      track("signin_failed", {
        method: mode === "signup" ? "signup" : "password",
        message: err instanceof Error ? err.message.slice(0, 140) : "unknown",
      });
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot() {
    if (blocked) return;
    const trimmed = email.trim();
    if (!trimmed.includes("@")) {
      toast.error("Enter your email above first.");
      return;
    }
    setLoading(true);
    try {
      if (!(await guard("reset", trimmed))) return;
      await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: canonicalEmailOrigin() + "/reset-password",
      });
      // Don't disclose whether the email exists.
      toast.success("If that email is registered, a reset link is on its way.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const startedAt = Date.now();
    const cid = beginAuthCorrelation();
    const originCategory = classifyOrigin(window.location.origin);
    const browserMode = detectBrowserMode();
    logAuthStage("oauth_start", {
      code: "google",
      msg: `origin=${originCategory} mode=${browserMode} flow=pkce_fullpage`,
    });
    try {
      // Pre-flight 1: browser storage must be writable — Supabase writes the
      // PKCE verifier to localStorage BEFORE the redirect, then reads it back
      // on the /auth/callback return to complete the exchange. Without it the
      // exchange fails silently with "invalid request".
      if (!isBrowserStorageUsable()) {
        logAuthStage("oauth_start", {
          ok: false,
          code: "oauth_storage_unavailable",
          durationMs: Date.now() - startedAt,
        });
        setOauthReconcile({
          phase: "error",
          title: "Browser storage is blocked",
          code: "oauth_storage_unavailable",
          message:
            "This browser is blocking site storage, so we can't sign you in. Try a normal browser window (not private mode) or another browser.",
        });
        setLoading(false);
        return;
      }

      // Pre-flight 2: PKCE verifier is written to THIS origin's localStorage.
      // If we start on www but Google returns to apex (or vice versa), the
      // verifier is invisible and the exchange fails. Force apex before start.
      if (needsOAuthOriginCanonicalization()) {
        const target =
          canonicalOAuthOrigin() +
          "/auth" +
          (search.redirect ? `?redirect=${encodeURIComponent(search.redirect)}` : "");
        logAuthStage("oauth_start", {
          ok: true,
          code: "canonicalize_origin",
          msg: `${originCategory}→apex`,
          durationMs: Date.now() - startedAt,
        });
        window.location.assign(target);
        return;
      }

      track("google_signin_started");
      stashPendingRedirect(redirectTarget);
      // Mark OAuth as pending so a return to /auth (instead of /auth/callback,
      // e.g. user hits back) can enter reconciliation instead of rendering the
      // signed-out login shell.
      markOAuthPending("google", cid);

      // Canonical full-page PKCE authorization-code flow. Supabase generates
      // the verifier, stores it in localStorage on THIS origin, and redirects
      // to Google. Google returns to /auth/callback?code=… which exchanges
      // once via supabase.auth.exchangeCodeForSession(code).
      //
      // We do NOT use the lovable.auth web-message broker for Google: its
      // inline token handoff has proven unreliable on Safari / installed PWAs
      // (see oauth_return_poll_timeout reports).
      const redirectTo = window.location.origin + "/auth/callback";
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: { prompt: "select_account" },
          // We drive the redirect ourselves so we can log the stage transition
          // and short-circuit cleanly if Supabase returned an error instead.
          skipBrowserRedirect: true,
        },
      });

      if (error || !data?.url) {
        const publicCode = toPublicOAuthErrorCode(
          error ? "oauth_provider_failed" : "oauth_token_delivery_missing",
        );
        logAuthStage("oauth_start", {
          ok: false,
          code: publicCode,
          durationMs: Date.now() - startedAt,
        });
        track("google_signin_failed", { message: publicCode });
        clearOAuthPending();
        setOauthReconcile({
          phase: "error",
          title: "Couldn't start Google sign-in",
          code: publicCode,
          message: "We couldn't start the Google sign-in flow. Please try again.",
          intendedOrigin: window.location.origin,
        });
        setLoading(false);
        return;
      }

      logAuthStage("oauth_redirect_initiated", {
        ok: true,
        code: "google",
        durationMs: Date.now() - startedAt,
      });
      // Full-page navigation — pending marker + PKCE verifier survive.
      window.location.assign(data.url);
      return;

    } catch {
      clearOAuthPending();
      logAuthStage("session_hydration_timeout", {
        ok: false,
        code: "oauth_provider_failed",
        durationMs: Date.now() - startedAt,
      });
      track("google_signin_failed", { message: "oauth_provider_failed" });
      toast.error("Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
      // Reference cid so future stages inherit it via sessionStorage.
      void cid;
    }
  }

  async function handleSessionRetry() {
    setRetryingSession(true);
    try {
      const next = await refreshAuthState();
      if (next.session) await goToApp({ skipSessionCheck: true });
    } finally {
      setRetryingSession(false);
    }
  }

  // Retry from the OAuth reconciliation error screen:
  //   1. Clear any lingering pending marker.
  //   2. Re-check session read-back — if Supabase has since hydrated the
  //      session (slow storage write, late token), navigate to /app.
  //   3. Otherwise restart Google sign-in on the canonical origin the user
  //      originally started on (prevents apex↔www mismatch loops).
  async function handleReconcileRetry() {
    if (reconcileRetrying) return;
    setReconcileRetrying(true);
    try {
      const intendedOrigin =
        oauthReconcile && oauthReconcile.phase === "error"
          ? oauthReconcile.intendedOrigin
          : undefined;
      // Fresh correlation for the retry attempt so its stage trace is
      // distinguishable from the failed one in support logs.
      const retryCid = beginAuthCorrelation();
      void retryCid;
      clearOAuthPending();
      logAuthStage("oauth_start", { code: "google", msg: "retry_from_reconcile" });

      // Read-back: if a session did land after the error was shown, use it.
      const first = await supabase.auth.getSession();
      if (first.data.session) {
        const verify = await supabase.auth.getSession();
        if (verify.data.session) {
          logAuthStage("session_hydrated", { ok: true, code: "retry_readback" });
          setAuthSession(verify.data.session);
          setOauthReconcile(null);
          await goToApp({ skipSessionCheck: true });
          return;
        }
      }

      // If the previous attempt started on a different origin, bounce there
      // so OAuth begins and returns on the same canonical origin.
      if (
        intendedOrigin &&
        typeof window !== "undefined" &&
        intendedOrigin !== window.location.origin
      ) {
        const target =
          intendedOrigin.replace(/\/$/, "") +
          "/auth" +
          (search.redirect ? `?redirect=${encodeURIComponent(search.redirect)}` : "");
        window.location.assign(target);
        return;
      }

      setOauthReconcile(null);
      await handleGoogle();
    } finally {
      setReconcileRetrying(false);
    }
  }


  // Session reset (from OAuth recovery or session recovery screen):
  //   - Clears Supabase auth session + Tribe auth store.
  //   - Clears OAuth pending marker so a new flow starts clean.
  //   - Cancels in-flight queries but does NOT clear query cache for
  //     unrelated public data (destinations list, homepage content, etc.).
  async function handleSessionReset() {
    setResettingSession(true);
    try {
      clearOAuthPending();
      await queryClient.cancelQueries();
      // Remove only auth/user-scoped queries. Public/unrelated caches stay.
      queryClient.removeQueries({
        predicate: (q) => {
          const key = Array.isArray(q.queryKey) ? q.queryKey : [q.queryKey];
          const head = typeof key[0] === "string" ? key[0] : "";
          return (
            head === "auth" ||
            head === "user" ||
            head === "me" ||
            head === "profile" ||
            head === "session" ||
            head === "beta-consent"
          );
        },
      });
      resetAuthState();
      await supabase.auth.signOut();
      clearAuthSession();
      await router.invalidate();
      await router.navigate({ to: "/auth", replace: true });
    } finally {
      setResettingSession(false);
    }
  }

  async function handleResendConfirmation() {
    if (!confirmSent || resendState === "sending") return;
    setResendState("sending");
    try {
      if (!(await guard("signup", confirmSent))) {
        setResendState("idle");
        return;
      }
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: confirmSent,
        options: { emailRedirectTo: canonicalEmailOrigin() + "/auth/callback" },
      });
      if (error) throw error;
      setResendState("sent");
      toast.success("Confirmation email resent.");
    } catch (err) {
      setResendState("idle");
      toast.error(err instanceof Error ? err.message : "Could not resend. Try again shortly.");
    }
  }

  // OAuth reconciliation takes precedence over EVERY other render branch:
  // while a Google return is being reconciled we must never render the login
  // shell, otherwise the user sees "Sign in" and thinks Google failed.
  if (oauthReconcile) {
    if (oauthReconcile.phase === "reconciling") {
      return (
        <div
          className="safe-top safe-bottom min-h-screen grid place-items-center px-6 py-12"
          style={{ background: "var(--gradient-hero)" }}
        >
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-3 text-sm text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            {oauthReconcile.message}
          </div>
        </div>
      );
    }
    return (
      <div
        className="safe-top safe-bottom min-h-screen grid place-items-center px-6 py-12"
        style={{ background: "var(--gradient-hero)" }}
        role="alertdialog"
        aria-labelledby="google-recovery-title"
        aria-describedby="google-recovery-message"
      >
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 text-center backdrop-blur">
          <div
            aria-hidden
            className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/15 text-destructive"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </div>
          <h1 id="google-recovery-title" className="mt-4 font-display text-3xl">
            {oauthReconcile.title}
          </h1>
          <p id="google-recovery-message" className="mt-3 text-sm text-muted-foreground">
            {oauthReconcile.message}
          </p>
          <div
            className="mt-4 inline-flex flex-col items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            aria-label="Diagnostic details"
          >
            <span>
              Error code:{" "}
              <code className="font-mono text-foreground">{oauthReconcile.code}</code>
            </span>
            <span className="text-[10px] opacity-70">
              Share this code with support if the problem continues.
            </span>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              type="button"
              onClick={() => void handleReconcileRetry()}
              disabled={reconcileRetrying || loading}
              autoFocus
            >
              {reconcileRetrying ? "Retrying…" : "Retry Google sign-in"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setOauthReconcile(null);
                await handleSessionReset();
              }}
              disabled={resettingSession}
            >
              {resettingSession ? "Resetting…" : "Reset session and start over"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (auth.ready && auth.error) {
    return (
      <div
        className="safe-top safe-bottom min-h-screen grid place-items-center px-6 py-12"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 text-center backdrop-blur">
          <h1 className="font-display text-3xl">Session recovery</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {auth.error || SESSION_HYDRATION_ERROR_MESSAGE}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button type="button" onClick={handleSessionRetry} disabled={retryingSession}>
              {retryingSession ? "Checking…" : "Try again"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleSessionReset}
              disabled={resettingSession}
            >
              {resettingSession ? "Resetting…" : "Sign out and reset session"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (redirectRecovery) {
    return (
      <div
        className="safe-top safe-bottom min-h-screen grid place-items-center px-6 py-12"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 text-center backdrop-blur">
          <h1 className="font-display text-3xl">Continue to Tribe Trips</h1>
          <p className="mt-3 text-sm text-muted-foreground">{redirectRecovery.message}</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              type="button"
              onClick={() => {
                redirectingRef.current = false;
                void goToApp({ skipSessionCheck: true });
              }}
            >
              Continue
            </Button>
            <Button type="button" variant="outline" onClick={handleSessionReset} disabled={resettingSession}>
              {resettingSession ? "Resetting…" : "Sign out and reset session"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (auth.ready && auth.session && !redirectingRef.current) {
    return (
      <div
        className="safe-top safe-bottom min-h-screen grid place-items-center px-6 py-12"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 text-center backdrop-blur">
          <h1 className="font-display text-3xl">Session confirmed</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            You're signed in. Continue to Tribe Trips if you are not redirected automatically.
          </p>
          <Button
            type="button"
            className="mt-6 w-full"
            onClick={() => void goToApp({ skipSessionCheck: true })}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // Initial session check has a hard timeout in auth-state, so this screen can
  // never hang indefinitely.
  if (!auth.ready || redirectingRef.current) {
    const message =
      redirectPhase === "navigating"
        ? "Opening Tribe Trips…"
        : redirectPhase === "confirming"
          ? "Confirming your session…"
          : "Checking your session…";
    return (
      <div
        className="safe-top safe-bottom min-h-screen grid place-items-center px-6 py-12"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 text-sm text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {message}
        </div>
      </div>
    );
  }

  return (
    <div
      className="safe-top safe-bottom min-h-screen grid place-items-center px-6 py-12"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 backdrop-blur">
        {confirmSent ? (
          <div>
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              ← back
            </Link>
            <div
              aria-hidden
              className="mt-4 grid size-12 place-items-center rounded-full bg-primary/15 text-primary"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6h16v12H4z" />
                <path d="m4 7 8 6 8-6" />
              </svg>
            </div>
            <h1 className="mt-4 font-display text-3xl">Check your email to complete sign up</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              We sent a confirmation link to{" "}
              <span className="font-medium text-foreground break-all">{confirmSent}</span>. Open
              that email and tap the confirmation link to finish creating your Tribe Trips account.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Didn't get it? Check your spam or promotions folder. The link can take a minute or two
              to arrive.
            </p>

            <div className="mt-6 space-y-3">
              <Button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resendState === "sending" || blocked}
                variant="outline"
                className="w-full"
              >
                {resendState === "sending"
                  ? "Sending…"
                  : resendState === "sent"
                    ? "Confirmation resent ✓"
                    : "Resend confirmation email"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setConfirmSent(null);
                  setResendState("idle");
                  setMode("signin");
                  setPassword("");
                }}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              >
                Use a different email
              </button>
            </div>

            <p className="mt-6 text-xs text-muted-foreground">
              You'll be able to sign in once your email is confirmed.
            </p>
          </div>
        ) : (
          <>
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              ← back
            </Link>
            <h1 className="mt-3 font-display text-3xl">
              {mode === "signin" ? "Welcome back" : "Join the crew"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Get your tribe out of the text thread and off to the next adventure.
            </p>

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogle}
              disabled={loading || blocked || oauthReconcile?.phase === "reconciling"}
              className="mt-6 w-full"
            >
              <svg
                className="mr-2 h-4 w-4"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </Button>

            <div className="relative mt-6">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleEmail} className="mt-6 space-y-3">
              {mode === "signup" && (
                <div>
                  <Label htmlFor="name">Display name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex"
                  />
                </div>
              )}
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={loading || blocked} className="w-full">
                {blocked ? `Wait ${secsLeft}s` : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
              {blocked && (
                <p className="text-center text-xs text-destructive">
                  Too many attempts. You can try again in {secsLeft}s.
                </p>
              )}
            </form>

            {mode === "signin" && (
              <button
                type="button"
                onClick={handleForgot}
                disabled={loading || blocked}
                className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Forgot password?
              </button>
            )}

            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="mt-5 w-full text-sm text-muted-foreground hover:text-foreground"
            >
              {mode === "signin" ? "No account yet? Sign up" : "Have an account? Sign in"}
            </button>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              By continuing you agree to our{" "}
              <Link to="/terms" className="underline hover:text-foreground">
                Terms
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
