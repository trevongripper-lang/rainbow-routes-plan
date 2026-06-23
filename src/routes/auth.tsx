import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { rlCheckPublic } from "@/lib/rate-limit.functions";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const rlCheck = useServerFn(rlCheckPublic);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState<{ scope: string; until: number } | null>(null);

  const secsLeft = cooldown ? Math.max(0, Math.ceil((cooldown.until - Date.now()) / 1000)) : 0;
  const blocked = secsLeft > 0;

  // If a session already exists (e.g. user returned from OAuth redirect, or
  // signed in in another tab), bounce off /auth immediately. Also react to
  // SIGNED_IN events triggered after setSession() — iOS Safari can race the
  // navigate() call in handleGoogle().
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate({ to: "/trips", replace: true });
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/trips", replace: true });
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

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
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        if (!(await guard("login", email))) return;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/trips" });
      }
    } catch (err) {
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
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/trips",
      });
      if (result.error) {
        toast.error(result.error.message ?? "Google sign-in failed");
        return;
      }
      if (result.redirected) return; // browser is navigating away
      // Session is set; the onAuthStateChange listener above will navigate.
      // Fallback navigation in case the event already fired before mount.
      navigate({ to: "/trips", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen grid place-items-center px-6 py-12"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 backdrop-blur">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← back
        </Link>
        <h1 className="mt-3 font-display text-3xl">
          {mode === "signin" ? "Welcome back" : "Join the crew"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Get your tribe out of the text thread and off to the next adventure.
        </p>

        <Button onClick={handleGoogle} disabled={loading} variant="outline" className="mt-6 w-full">
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
      </div>
    </div>
  );
}
