import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { rlCheckPublic } from "@/lib/rate-limit.functions";
import { track } from "@/lib/analytics";
import {
  sanitizeRedirectPath,
  stashPendingRedirect,
  consumePendingRedirect,
} from "@/lib/redirect-guard";

type AuthSearch = { redirect?: string };

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): AuthSearch => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const rlCheck = useServerFn(rlCheckPublic);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState<{ scope: string; until: number } | null>(null);
  const [confirmSent, setConfirmSent] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  // Resolve the final post-auth destination. Prefer the search-param
  // redirect (e.g. /join/$token), fall back to any pending redirect stashed
  // in sessionStorage (survives full-page OAuth), then /trips.
  const redirectTarget = useMemo(() => {
    if (typeof window === "undefined") return "/trips";
    return sanitizeRedirectPath(search.redirect ?? consumePendingRedirect() ?? "/trips");
  }, [search.redirect]);

  const secsLeft = cooldown ? Math.max(0, Math.ceil((cooldown.until - Date.now()) / 1000)) : 0;
  const blocked = secsLeft > 0;

  // If a session already exists (e.g. user returned from OAuth redirect, or
  // signed in in another tab), bounce off /auth immediately. Also react to
  // SIGNED_IN events triggered after setSession() — iOS Safari can race the
  // navigate() call in handleGoogle().
  useEffect(() => {
    let cancelled = false;
    const go = () => {
      // Use window.location so any same-origin path (including dynamic
      // routes like /join/$token) works without router type wrangling.
      window.location.replace(redirectTarget);
    };
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) go();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) go();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate, redirectTarget]);


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
            emailRedirectTo: window.location.origin,
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
        track("signin_succeeded", { method: "signup_autoconfirm" });
        window.location.replace(redirectTarget);
      } else {
        if (!(await guard("login", email))) return;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        track("signin_succeeded", { method: "password" });
        window.location.replace(redirectTarget);
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
        redirectTo: window.location.origin + "/reset-password",
      });
      // Don't disclose whether the email exists.
      toast.success("If that email is registered, a reset link is on its way.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      track("google_signin_started");
      // Stash the intended redirect so we can honor it after the full-page
      // OAuth round-trip returns to /auth (or the origin) with a fresh
      // session. `redirect_uri` MUST stay a public same-origin URL, never a
      // protected route.
      stashPendingRedirect(redirectTarget);
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        track("google_signin_failed", {
          message: result.error.message?.slice(0, 140) ?? "unknown",
        });
        toast.error(result.error.message ?? "Google sign-in failed");
        return;
      }
      if (result.redirected) return; // browser is navigating away
      // Session is set; the onAuthStateChange listener above will navigate.
      track("signin_succeeded", { method: "google" });
      window.location.replace(redirectTarget);
    } catch (err) {
      track("google_signin_failed", {
        message: err instanceof Error ? err.message.slice(0, 140) : "unknown",
      });
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
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
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setResendState("sent");
      toast.success("Confirmation email resent.");
    } catch (err) {
      setResendState("idle");
      toast.error(err instanceof Error ? err.message : "Could not resend. Try again shortly.");
    }
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
              onClick={handleGoogle}
              disabled={loading}
              variant="outline"
              className="mt-6 w-full"
            >
              <svg viewBox="0 0 24 24" className="size-4">
                <path
                  fill="currentColor"
                  d="M21.35 11.1H12v3.2h5.35c-.5 2.4-2.6 4-5.35 4a5.85 5.85 0 1 1 0-11.7c1.5 0 2.9.55 4 1.55l2.35-2.35A9.15 9.15 0 0 0 12 3.05a9 9 0 1 0 9.35 9.35c0-.45-.05-.85-.1-1.3Z"
                />
              </svg>
              Continue with Google
            </Button>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={handleEmail} className="space-y-3">
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
