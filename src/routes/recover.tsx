import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { clearRedirectTrace } from "@/lib/redirect-guard";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/recover")({
  head: () => ({
    meta: [
      { title: "Recover — Tribe Trips" },
      {
        name: "description",
        content: "Break out of a sign-in loop and get back into your Tribe Trips account.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RecoverPage,
});

function RecoverPage() {
  const navigate = useNavigate();

  async function tryAgain() {
    clearRedirectTrace();
    track("recover_try_again");
    navigate({ to: "/trips", replace: true });
  }

  async function signOut() {
    clearRedirectTrace();
    track("recover_sign_out");
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="safe-top safe-bottom mx-auto grid min-h-screen max-w-md place-items-center px-6">
      <div className="w-full text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Beta recovery</p>
        <h1 className="mt-2 font-display text-3xl">We hit a routing loop</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your browser was bouncing between sign-in and the app. We stopped it so you can pick a
          fresh path. None of your trip data is affected.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={tryAgain}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={signOut}
            className="rounded-full border border-border/60 px-5 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Sign out and start over
          </button>
          <a
            href="mailto:hello@tgklabs.io?subject=Tribe%20Trips%20beta%20issue"
            className="text-xs text-muted-foreground underline"
          >
            Contact support
          </a>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          <Link to="/" className="underline">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
