import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Compass, Heart, MessageCircle, Sparkles } from "lucide-react";

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
        <Link to="/auth" className="rounded-full border border-border/60 bg-card/40 px-4 py-2 text-sm backdrop-blur hover:bg-card/70">
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-12 pb-24 md:pt-24">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/30 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="size-3.5 text-accent" /> For you and your crew
        </p>
        <h1 className="font-display text-5xl leading-[1.05] md:text-7xl">
          Plan the gay <br /> getaway, <em className="text-primary not-italic">together</em>.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Pitch destinations, upvote favorites, chatter about logistics, and surface
          regional pride, circuit, and beach events — all in one cozy place.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/auth" className="rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground shadow-[var(--shadow-soft)] hover:opacity-90">
            Start planning
          </Link>
          <a href="#how" className="rounded-full border border-border/60 bg-card/30 px-6 py-3 backdrop-blur hover:bg-card/60">
            How it works
          </a>
        </div>

        <section id="how" className="mt-24 grid gap-5 md:grid-cols-3">
          {[
            { icon: Compass, title: "Pitch destinations", body: "Drop ideas — Mykonos in August, Puerto Vallarta in May. Add a photo and a vibe." },
            { icon: Heart, title: "Upvote together", body: "Your crew votes. The most-loved trips bubble up. No more group-chat chaos." },
            { icon: MessageCircle, title: "Chatter & plan", body: "Threaded comments on every destination. Trade tips, flights, sketchy clubs." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur">
              <f.icon className="size-6 text-primary" />
              <h3 className="mt-4 font-display text-xl">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
