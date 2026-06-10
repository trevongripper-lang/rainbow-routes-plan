import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  Compass,
  Heart,
  MessageCircle,
  Sparkles,
  Plane,
  BedDouble,
  Ticket,
  Wallet,
  CalendarDays,
  MapPin,
  Users,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import howItWorksHero from "@/assets/how-it-works-hero.png";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/trips" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-hero)" }}>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-display text-xl">
          <span className="inline-block size-2.5 rounded-full bg-primary" />
          Tribe Trips
        </div>
        <Link
          to="/auth"
          className="rounded-full border border-border/60 bg-card/40 px-4 py-2 text-sm backdrop-blur hover:bg-card/70"
        >
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-12 pb-24 md:pt-24">
        {/* Hero */}
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/30 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="size-3.5 text-accent" /> For you and your crew
        </p>
        <h1 className="font-display text-5xl leading-[1.05] md:text-7xl">
          Plan the gay <br /> getaway,{" "}
          <em className="text-primary not-italic">together</em>.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Pitch destinations, upvote favorites, chatter about logistics, and
          surface regional pride, circuit, and beach events — all in one cozy
          place.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/auth"
            className="rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground shadow-[var(--shadow-soft)] hover:opacity-90"
          >
            Start planning
          </Link>
          <a
            href="#how"
            className="rounded-full border border-border/60 bg-card/30 px-6 py-3 backdrop-blur hover:bg-card/60"
          >
            How it works
          </a>
        </div>

        {/* How It Works */}
        <section id="how" className="mt-28">
          {/* Section header */}
          <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center">
            <div className="flex-1">
              <p className="mb-3 text-sm font-medium tracking-wide text-primary uppercase">
                How it works
              </p>
              <h2 className="font-display text-3xl leading-tight md:text-5xl">
                From first idea to{" "}
                <em className="text-accent not-italic">boarding pass</em>.
              </h2>
              <p className="mt-4 max-w-md text-muted-foreground">
                No more scattered group chats, lost links, or "wait, which
                Airbnb?" Tribe Trips keeps every decision in one cozy place.
              </p>
            </div>
            <img
              src={howItWorksHero}
              alt="Friends planning a trip together"
              width={480}
              height={240}
              className="rounded-2xl border border-border/60 object-cover shadow-[var(--shadow-soft)] lg:w-[26rem]"
              loading="lazy"
            />
          </div>

          {/* Steps */}
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                num: "01",
                icon: Compass,
                title: "Pitch destinations",
                body: "Drop ideas — Mykonos in August, Puerto Vallarta in May. Add a photo and a vibe so your crew feels it.",
                color: "text-primary",
              },
              {
                num: "02",
                icon: Heart,
                title: "Upvote together",
                body: "Your crew votes with hearts. The most-loved trips bubble up. No more group-chat chaos.",
                color: "text-rose-400",
              },
              {
                num: "03",
                icon: MessageCircle,
                title: "Chatter & plan",
                body: "Threaded comments on every destination. Trade tips, flights, and sketchy club recommendations.",
                color: "text-sky-400",
              },
              {
                num: "04",
                icon: Plane,
                title: "Lock in logistics",
                body: "Track flights, stays, tickets, and costs — all tied to the trip. Everyone sees the same plan.",
                color: "text-amber-400",
              },
              {
                num: "05",
                icon: CalendarDays,
                title: "Discover events",
                body: "Surface regional pride, circuit parties, and beach events happening while you're there.",
                color: "text-emerald-400",
              },
              {
                num: "06",
                icon: Users,
                title: "Go together",
                body: "A finalized itinerary everyone can trust. Pack your bags — the group is ready.",
                color: "text-violet-400",
              },
            ].map((step) => (
              <div
                key={step.num}
                className="group relative rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur transition-colors hover:bg-card/60"
              >
                <span className="absolute right-5 top-5 font-display text-4xl text-muted-foreground/15">
                  {step.num}
                </span>
                <step.icon className={`size-6 ${step.color}`} />
                <h3 className="mt-4 font-display text-xl">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {step.body}
                </p>
              </div>
            ))}
          </div>

          {/* Feature summary strip */}
          <div className="mt-16 rounded-2xl border border-border/60 bg-card/40 p-8 backdrop-blur md:p-10">
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: BedDouble,
                  label: "Stays",
                  desc: "Share & compare hotels",
                },
                {
                  icon: Ticket,
                  label: "Tickets",
                  desc: "Events & entry passes",
                },
                {
                  icon: Wallet,
                  label: "Costs",
                  desc: "Split & track spending",
                },
                {
                  icon: MapPin,
                  label: "Map",
                  desc: "Visualize the journey",
                },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <item.icon className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Final CTA */}
          <div className="mt-16 flex flex-col items-center rounded-2xl border border-border/60 bg-card/40 p-10 text-center backdrop-blur md:p-14">
            <h3 className="font-display text-3xl md:text-4xl">
              Ready to plan your next adventure?
            </h3>
            <p className="mt-4 max-w-md text-muted-foreground">
              Create your first trip, invite your crew, and start pitching
              destinations in under a minute.
            </p>
            <Link
              to="/auth"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 font-medium text-primary-foreground shadow-[var(--shadow-soft)] hover:opacity-90"
            >
              Start planning <ArrowRight className="size-4" />
            </Link>
            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-400" />
              <span>Free forever. No credit card required.</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 md:flex-row">
          <div className="flex items-center gap-2 font-display text-sm">
            <span className="inline-block size-2 rounded-full bg-primary" />
            Tribe Trips
          </div>
          <p className="text-xs text-muted-foreground">
            Built for the community. Travel together.
          </p>
        </div>
      </footer>
    </div>
  );
}
