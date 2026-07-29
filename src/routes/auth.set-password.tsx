import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PasswordSetupForm } from "@/components/auth/PasswordSetupForm";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { refreshAuthState, primeBetaConsent } from "@/lib/auth-state";
import { sanitizeReturnPath } from "@/lib/return-path";

type SetPasswordSearch = { redirect?: string };

/**
 * First-time password setup.
 *
 * Used when a user arrives with a live session but has never chosen a
 * password: fresh magic-link claim, anonymous-to-permanent upgrade, or
 * an admin-invited account. Distinct from `/reset-password` (which signs
 * the user out afterwards so the recovery link cannot be reused).
 */
export const Route = createFileRoute("/auth/set-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Choose a password — Tribe Trips" },
      {
        name: "description",
        content: "Pick a password to finish setting up your Tribe Trips account.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): SetPasswordSearch => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  component: SetPasswordPage,
});

type Status = "checking" | "ready" | "no-session" | "done";

function SetPasswordPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setStatus(data.session ? "ready" : "no-session");
    })();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "PASSWORD_RECOVERY") {
        setStatus(session ? "ready" : "no-session");
      }
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const returnTo = sanitizeReturnPath(search.redirect);

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
          <h1 className="font-display text-3xl">Choose a password</h1>
        </div>

        {status === "checking" && (
          <p className="mt-4 text-sm text-muted-foreground">Getting things ready…</p>
        )}

        {status === "no-session" && (
          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">Session not found.</p>
                <p className="mt-1 text-muted-foreground">
                  This page needs an active sign-in link. Open the most recent link we emailed
                  you, or sign in with your email and password.
                </p>
              </div>
            </div>
            <Button asChild className="w-full">
              <Link to="/auth">Back to sign in</Link>
            </Button>
          </div>
        )}

        {status === "ready" && (
          <PasswordSetupForm
            intro="Your account is signed in. Pick a password so you can come back later without another email link."
            submitLabel="Save password and continue"
            onSuccess={async () => {
              // Refresh the store so downstream gates see the updated user
              // (email_confirmed_at, is_anonymous → false) without a race.
              const next = await refreshAuthState();
              if (next.user) void primeBetaConsent(next.user.id);
              setStatus("done");
              // Send the user to consent capture. The consent page will
              // forward to `returnTo` (or /app) after acceptance.
              void navigate({
                to: "/auth/consent",
                search: { next: returnTo, reason: "missing" },
                replace: true,
              });
            }}
          />
        )}

        {status === "done" && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
            <div>
              <p className="font-medium text-foreground">Password saved.</p>
              <p className="mt-1 text-muted-foreground">Continuing…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
