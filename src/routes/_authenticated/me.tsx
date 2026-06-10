import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { ArrowUp, MessageCircle, MapPin, Sparkles, Check, Mail, LogOut } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/me")({
  component: MePage,
});


async function fetchMine() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("not signed in");
  const userId = u.user.id;
  const [{ data: profile }, { data: dests }, { data: myVotes }, { data: myComments }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("destinations").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("votes").select("destination_id, destinations(id, title, region)").eq("user_id", userId),
    supabase.from("comments").select("id").eq("user_id", userId),
  ]);

  const ids = (dests ?? []).map((d) => d.id);
  const { data: voteCountsRaw } = ids.length
    ? await supabase.from("votes").select("destination_id").in("destination_id", ids)
    : { data: [] as { destination_id: string }[] };
  const counts: Record<string, number> = {};
  (voteCountsRaw ?? []).forEach((v) => { counts[v.destination_id] = (counts[v.destination_id] ?? 0) + 1; });

  return {
    profile,
    user: u.user,
    dests: (dests ?? []).map((d) => ({ ...d, votes: counts[d.id] ?? 0 })),
    voted: myVotes ?? [],
    commentCount: myComments?.length ?? 0,
  };
}

function MePage() {
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMine });
  if (isLoading || !data) return <div className="h-96 animate-pulse rounded-2xl bg-card/60" />;

  const { profile, user, dests, voted, commentCount } = data;
  const name = profile?.display_name ?? user.email?.split("@")[0] ?? "you";
  const totalVotes = dests.reduce((s, d) => s + d.votes, 0);

  const firstName = (profile?.display_name?.trim() || user.email?.split("@")[0] || "you").split(/\s+/)[0];
  const isPro = !!(profile as { is_pro?: boolean } | null)?.is_pro;

  return (
    <div className="space-y-8">
      <PageHero
        crumbs={[{ label: "Mine" }]}
        title="Hey,"
        highlight={firstName}
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Pitches", value: dests.length },
          { label: "Votes received", value: totalVotes },
          { label: "Comments", value: commentCount },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur">
            <div className="font-display text-3xl text-primary">{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <MyAccount
        userId={user.id}
        email={user.email ?? ""}
        displayName={profile?.display_name ?? ""}
        isPro={isPro}
      />


      <section>
        <h2 className="font-display text-2xl">Your pitches</h2>
        {dests.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You haven't pitched anything yet. <Link to="/trips" className="text-primary hover:underline">Pitch your first trip</Link>.
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {dests.map((d) => (
              <li key={d.id}>
                <Link to="/trips/$id" params={{ id: d.id }} className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 transition hover:border-primary/40">
                  <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {d.image_url ? <img src={d.image_url} alt="" className="size-full object-cover" /> : <div className="size-full" style={{ background: "var(--gradient-hero)" }} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-lg">{d.title}</div>
                    <div className="text-xs text-muted-foreground"><MapPin className="mr-1 inline size-3" />{d.region}{d.country ? ` · ${d.country}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowUp className="size-4 text-primary" /> {d.votes}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-2xl">You upvoted</h2>
        {voted.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing yet. Browse <Link to="/trips" className="text-primary hover:underline">trips</Link>.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {voted.map((v) => v.destinations && (
              <li key={v.destination_id}>
                <Link to="/trips/$id" params={{ id: v.destination_id }} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-primary/50">
                  <MessageCircle className="size-3 text-primary" />
                  {(v.destinations as any).title}
                  <span className="text-muted-foreground">· {(v.destinations as any).region}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
