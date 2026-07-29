import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, CheckCircle2, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — Tribe Trips" },
      {
        name: "description",
        content: "Choose a new password for your Tribe Trips account after requesting a reset link.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

type Status = "checking" | "ready" | "invalid" | "done";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase auto-parses recovery hashes (detectSessionInUrl). Listen for
    // the PASSWORD_RECOVERY event; also probe getSession() in case it fired
    // before we mounted.
    let sub: { unsubscribe: () => void } | null = null;

    const probe = async () => {
      const { data } = await supabase.auth.getSession();
      // If hash isn't present and there's no session, this page was opened directly.
      const hasRecoveryHash =
        typeof window !== "undefined" &&
        /[?#&]type=recovery/.test(window.location.hash + window.location.search);
      if (data.session) {
        setStatus("ready");
      } else if (!hasRecoveryHash) {
        setStatus("invalid");
      }
    };

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setStatus("ready");
      }
    });
    sub = data.subscription;
    probe();
    // Give Supabase a moment to process the hash, then fail closed.
    const t = setTimeout(() => {
      setStatus((s) => (s === "checking" ? "invalid" : s));
    }, 2500);
    return () => {
      sub?.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
      toast.success("Password updated.");
      // Sign out so the recovery session can't be reused, then send to /auth.
      await supabase.auth.signOut();
      setTimeout(() => navigate({ to: "/auth" }), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="safe-top safe-bottom min-h-screen grid place-items-center px-6 py-12"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 backdrop-blur">
        <Link to="/auth" className="text-xs text-muted-foreground hover:text-foreground">
          ← back to sign in
        </Link>
        <div className="mt-3 flex items-center gap-2">
          <KeyRound className="size-5 text-primary" />
          <h1 className="font-display text-3xl">Set a new password</h1>
        </div>

        {status === "checking" && (
          <p className="mt-4 text-sm text-muted-foreground">Checking your recovery link…</p>
        )}

        {status === "invalid" && (
          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">
                  This reset link is invalid or expired.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Reset links work once and expire quickly. Request a new one from the sign-in page.
                </p>
              </div>
            </div>
            <Button asChild className="w-full">
              <Link to="/auth">Request a new reset link</Link>
            </Button>
          </div>
        )}

        {status === "done" && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
            <div>
              <p className="font-medium text-foreground">Password updated.</p>
              <p className="mt-1 text-muted-foreground">Redirecting you to sign in…</p>
            </div>
          </div>
        )}

        {status === "ready" && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Pick something at least 8 characters. You'll be sent back to sign in with your new
              password.
            </p>
            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              <div>
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Updating…" : "Update password"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Tip: a passphrase like <span className="font-mono">poolside-spritz-2026</span> beats{" "}
                <span className="font-mono">P@ssw0rd!</span>.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
