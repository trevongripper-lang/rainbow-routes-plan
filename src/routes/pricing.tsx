import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Tribe Trips" },
      { name: "description", content: "Free for crews up to 5. Upgrade to Pro for unlimited group size, advanced settlements, and more." },
      { property: "og:title", content: "Tribe Trips — Pricing" },
      { property: "og:description", content: "Free for crews up to 5. Pro for the rest." },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Tribe Trips</Link>
          <h1 className="mt-4 font-display text-5xl md:text-6xl">Simple pricing</h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Free for your first crew. Upgrade when the group grows.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {/* FREE */}
          <div className="rounded-3xl border border-border/60 bg-card p-8">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl">Free</h2>
              <div><span className="font-display text-4xl">$0</span><span className="text-muted-foreground"> / forever</span></div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Everything you need to plan a trip with up to 5 people.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Up to 5 people per trip",
                "Unlimited trips",
                "Chatter, costs, settle-up, ratings",
                "Travel plans & stays",
                "Notifications",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="secondary" className="mt-8 w-full">
              <Link to="/auth">Start free</Link>
            </Button>
          </div>

          {/* PRO */}
          <div className="relative rounded-3xl border-2 border-primary/60 bg-gradient-to-b from-primary/10 to-card p-8 shadow-xl">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
              <Sparkles className="mr-1 inline size-3" /> Best for bigger crews
            </div>
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl">Pro</h2>
              <div><span className="font-display text-4xl">$9</span><span className="text-muted-foreground"> / month</span></div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">For the trips that get out of hand (in a good way).</p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Unlimited group size",
                "Everything in Free",
                "Email invites with custom branding",
                "Priority notifications",
                "Early access to new features",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button asChild className="mt-8 w-full">
              <Link to="/auth" search={{ upgrade: "pro" } as never}>Upgrade to Pro</Link>
            </Button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Secure checkout via Stripe. Cancel anytime.
            </p>
          </div>
        </div>

        <div className="mt-16 text-center text-sm text-muted-foreground">
          Questions? <a className="text-primary hover:underline" href="mailto:hi@tribetrips.app">Get in touch</a>.
        </div>
      </div>
    </main>
  );
}
