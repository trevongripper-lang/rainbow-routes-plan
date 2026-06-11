import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { ArrowUp, MessageCircle, MapPin, Sparkles, Check, Mail, LogOut } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { CreditsPanel } from "@/components/credits-panel";
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

function MyAccount({ userId, email, displayName, isPro }: { userId: string; email: string; displayName: string; isPro: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState(displayName);
  useEffect(() => { setName(displayName); }, [displayName]);
  const dirty = name.trim() !== displayName.trim();

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("profiles").update({ display_name: name.trim() || null }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["me", "profile"] }); toast.success("Saved"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl">My account</h2>

      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Display name</Label>
            <div className="mt-1 flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              {dirty && (
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Email</Label>
            <div className="mt-1 flex h-10 items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 text-sm text-muted-foreground">
              <Mail className="size-3.5" /> {email}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={signOut} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </div>

      {isPro ? (
        <div className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-5 backdrop-blur">
          <div className="grid size-10 place-items-center rounded-full bg-primary/20 text-primary">
            <Check className="size-5" />
          </div>
          <div className="flex-1">
            <div className="font-display text-lg">You're on Pro</div>
            <p className="text-sm text-muted-foreground">Unlimited crew size. Thanks for backing the build.</p>
          </div>
          <Link to="/pricing" className="text-sm text-primary hover:underline">Manage</Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur md:p-8" style={{ backgroundImage: "var(--gradient-hero)" }}>
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-md">
              <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">
                <Sparkles className="size-3.5 text-accent" /> Free up to 5 people
              </p>
              <h3 className="font-display text-2xl md:text-3xl">Bring the whole <em className="text-primary not-italic">crew</em>.</h3>
              <p className="mt-2 text-sm text-muted-foreground">Upgrade to Pro for unlimited members per trip, priority support, and everything we ship next.</p>
            </div>
            <Link
              to="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground shadow-[var(--shadow-soft)] hover:opacity-90"
            >
              <Sparkles className="size-4" /> Upgrade to Pro
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

