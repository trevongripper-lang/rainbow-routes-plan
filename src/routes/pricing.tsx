import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles, Gift, Users, Crown, Infinity as InfinityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Tribe Trips" },
      {
        name: "description",
        content:
          "Free for crews up to 5. Pay once per trip when your group grows — no subscriptions.",
      },
      { property: "og:title", content: "Tribe Trips — Pricing" },
      {
        property: "og:description",
        content: "Pay once per trip. No subscriptions. Earn free trips when you keep planning.",
      },
    ],
  }),
  component: PricingPage,
});

const tiers = [
  { range: "6–10", price: "$4.99", note: "Most crews" },
  { range: "11–20", price: "$9.99", note: "Group getaways" },
  { range: "21+", price: "$19.99", note: "Whole-squad trips" },
];

const features = [
  "Chatter, costs, settle-up, ratings",
  "Travel plans & stays",
  "Notifications & invites",
  "AI flight lookup",
];

function PricingPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Tribe Trips
          </Link>
          <h1 className="mt-4 font-display text-5xl md:text-6xl">Pay once, when it counts</h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Free for crews up to 5. For bigger trips, the organizer pays a single one-time fee — no
            subscriptions, ever.
          </p>
        </div>

        {/* Free tier card */}
        <div className="mt-12 rounded-3xl border border-border/60 bg-card p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl">Free</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                For trips up to 5 people. Unlimited free trips.
              </p>
            </div>
            <div>
              <span className="font-display text-4xl">$0</span>
              <span className="text-muted-foreground"> / forever</span>
            </div>
          </div>
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Button asChild variant="secondary" className="mt-6">
            <Link to="/auth">Start free</Link>
          </Button>
        </div>

        {/* Tiered unlock */}
        <div className="mt-8 rounded-3xl border-2 border-primary/40 bg-gradient-to-b from-primary/10 to-card p-8">
          <div className="flex items-center gap-2 text-sm text-primary">
            <Users className="size-4" /> One-time unlock for bigger trips
          </div>
          <h2 className="mt-2 font-display text-3xl">Unlock a trip — pay once, done</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            When a trip grows past 5 people, the organizer unlocks it for the whole crew. Permanent.
            No renewals.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {tiers.map((t) => (
              <div key={t.range} className="rounded-2xl border border-border/60 bg-card p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.note}</p>
                <p className="mt-1 font-display text-xl">{t.range} people</p>
                <p className="mt-3 font-display text-4xl">{t.price}</p>
                <p className="mt-1 text-xs text-muted-foreground">one-time, per trip</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Adding members later that pushes the trip into a larger tier triggers a small top-up for
            the difference. Guests never pay.
          </p>
        </div>

        {/* Organizer Plus */}
        <div className="mt-8 overflow-hidden rounded-3xl border-2 border-amber-400/50 bg-gradient-to-br from-amber-500/15 via-card to-primary/10 p-8 shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-xl">
              <div className="flex items-center gap-2 text-sm text-amber-500">
                <Crown className="size-4" /> For power organizers
              </div>
              <h2 className="mt-2 font-display text-3xl">Organizer Plus</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Plan as many trips as you want, any size, without thinking about unlocks. Pays for
                itself at roughly <strong>7 paid trips a year</strong>.
              </p>
              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                {[
                  { icon: InfinityIcon, label: "Unlimited trip unlocks, any tier" },
                  { icon: Sparkles, label: "Priority AI flight lookup" },
                  { icon: Gift, label: "Early access to new features" },
                  { icon: Check, label: "Cancel anytime, no lock-in" },
                ].map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-start gap-2 text-sm">
                    <Icon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              <div className="text-right">
                <span className="font-display text-5xl">$35</span>
                <span className="text-muted-foreground"> / year</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">~$2.92 / month, billed annually</p>
              <Button asChild className="mt-4 bg-amber-500 text-amber-50 hover:bg-amber-500/90">
                <Link to="/auth" search={{ upgrade: "plus" } as never}>
                  <Crown className="size-4" /> Get Organizer Plus
                </Link>
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Checkout activates once payments are live.
              </p>
            </div>
          </div>
        </div>

        {/* Credits */}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-border/60 bg-card p-6">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="size-5" />
              <h3 className="font-display text-xl">Loyalty credits</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Every <strong>8 trips you pay to unlock</strong>, you get{" "}
              <strong>2 free unlock credits</strong> — usable on any tier.
            </p>
          </div>
          <div className="rounded-3xl border border-border/60 bg-card p-6">
            <div className="flex items-center gap-2 text-primary">
              <Gift className="size-5" />
              <h3 className="font-display text-xl">Referral credits</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Join via an invite from someone who's paid for at least one trip? You get{" "}
              <strong>3 free unlock credits</strong> for trips you organize.
            </p>
          </div>
        </div>

        <div className="mt-16 text-center text-sm text-muted-foreground">
          Questions?{" "}
          <a className="text-primary hover:underline" href="mailto:hi@tribetrips.app">
            Get in touch
          </a>
          .
        </div>
      </div>
    </main>
  );
}
