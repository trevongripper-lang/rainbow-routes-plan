import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowUp, MapPin, MessageCircle, Plus, Star } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/trips/")({
  component: TripsPage,
});

type DestRow = {
  id: string; user_id: string; title: string; region: string; country: string | null;
  description: string | null; image_url: string | null; best_months: string | null; created_at: string;
  is_past: boolean;
};

async function fetchTrips() {
  const [{ data: dests }, { data: votes }, { data: comments }, { data: user }] = await Promise.all([
    supabase.from("destinations").select("*").order("created_at", { ascending: false }),
    supabase.from("votes").select("destination_id, user_id"),
    supabase.from("comments").select("destination_id"),
    supabase.auth.getUser(),
  ]);
  const me = user.user?.id;
  const voteCounts: Record<string, number> = {};
  const myVotes: Record<string, boolean> = {};
  (votes ?? []).forEach((v) => {
    voteCounts[v.destination_id] = (voteCounts[v.destination_id] ?? 0) + 1;
    if (v.user_id === me) myVotes[v.destination_id] = true;
  });
  const commentCounts: Record<string, number> = {};
  (comments ?? []).forEach((c) => { commentCounts[c.destination_id] = (commentCounts[c.destination_id] ?? 0) + 1; });

  const enriched = ((dests ?? []) as DestRow[]).map((d) => ({
    ...d,
    votes: voteCounts[d.id] ?? 0,
    voted: !!myVotes[d.id],
    comments: commentCounts[d.id] ?? 0,
  }));
  enriched.sort((a, b) => b.votes - a.votes);
  return enriched;
}

function TripsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["trips"], queryFn: fetchTrips });
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const filtered = (data ?? []).filter((d) => (tab === "past" ? d.is_past : !d.is_past));

  return (
    <div className="space-y-10">
      <header className="rounded-3xl border border-border/60 bg-card/30 p-8 backdrop-blur md:p-10">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="size-3.5 text-accent" /> Your crew's wanderlust
        </p>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <h1 className="font-display text-4xl leading-[1.05] md:text-6xl">
              Where to <em className="text-primary not-italic">next</em>?
            </h1>
            <p className="mt-4 text-base text-muted-foreground md:text-lg">
              Pitch a destination, upvote favorites, plot the move — together.
            </p>
          </div>
          <NewTripDialog />
        </div>

        <div className="mt-8 inline-flex rounded-full border border-border/60 bg-card/60 p-1 text-sm backdrop-blur">
          {(["upcoming", "past"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 capitalize transition ${tab === t ? "bg-primary text-primary-foreground shadow-[var(--shadow-soft)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t} trips
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-2xl bg-card/60" />
        ))}
        {!isLoading && filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center backdrop-blur">
            <p className="font-display text-2xl">{tab === "past" ? "No past trips yet." : "No destinations yet."}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {tab === "past" ? "Mark a trip as past from its detail page after the trip wraps." : "Be the first to pitch one."}
            </p>
          </div>
        )}
        {filtered.map((d) => <TripCard key={d.id} d={d} />)}
      </div>
    </div>
  );
}

function TripCard({ d }: { d: Awaited<ReturnType<typeof fetchTrips>>[number] }) {
  const qc = useQueryClient();
  const vote = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      if (d.voted) {
        const { error } = await supabase.from("votes").delete().eq("destination_id", d.id).eq("user_id", u.user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("votes").insert({ destination_id: d.id, user_id: u.user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trips"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Vote failed"),
  });

  return (
    <article className="group overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-soft)] transition hover:border-primary/40">
      <Link to="/trips/$id" params={{ id: d.id }} className="block">
        <div className="relative aspect-[16/10] overflow-hidden bg-muted">
          {d.image_url ? (
            <img src={d.image_url} alt={d.title} className="size-full object-cover transition group-hover:scale-105" loading="lazy" />
          ) : (
            <div className="size-full" style={{ background: "var(--gradient-hero)" }} />
          )}
          <div className="absolute left-3 top-3 rounded-full bg-background/80 px-2.5 py-1 text-xs backdrop-blur">
            <MapPin className="mr-1 inline size-3 text-primary" />{d.region}
          </div>
          {d.is_past && (
            <div className="absolute right-3 top-3 rounded-full bg-accent/90 px-2.5 py-1 text-xs font-medium text-accent-foreground backdrop-blur">
              Past trip
            </div>
          )}
        </div>
      </Link>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <Link to="/trips/$id" params={{ id: d.id }} className="font-display text-xl hover:text-primary">{d.title}</Link>
          {d.is_past ? (
            <Link
              to="/trips/$id"
              params={{ id: d.id }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm hover:border-primary/50"
            >
              <Star className="size-4 text-primary" /> Rate
            </Link>
          ) : (
            <button
              onClick={() => vote.mutate()}
              disabled={vote.isPending}
              className={`flex shrink-0 flex-col items-center rounded-xl border px-3 py-1.5 text-sm transition ${d.voted ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/50"}`}
            >
              <ArrowUp className="size-4" />
              <span className="font-medium tabular-nums">{d.votes}</span>
            </button>
          )}
        </div>
        {d.country && <p className="mt-0.5 text-xs text-muted-foreground">{d.country}{d.best_months ? ` · ${d.best_months}` : ""}</p>}
        {d.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>}
        <Link to="/trips/$id" params={{ id: d.id }} className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <MessageCircle className="size-3.5" /> {d.comments} in chatter
        </Link>
      </div>
    </article>
  );
}

function NewTripDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", region: "", country: "", description: "", image_url: "", best_months: "" });

  const create = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase.from("destinations").insert({ ...form, user_id: u.user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("Destination pitched!");
      setOpen(false);
      setForm({ title: "", region: "", country: "", description: "", image_url: "", best_months: "" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="shrink-0"><Plus className="size-4" /> Pitch a trip</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">Pitch a destination</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
          <div><Label>Title</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Mykonos circuit week" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Region</Label><Input required value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="Europe" /></div>
            <div><Label>Country</Label><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Greece" /></div>
          </div>
          <div><Label>Best months</Label><Input value={form.best_months} onChange={(e) => setForm({ ...form, best_months: e.target.value })} placeholder="Aug" /></div>
          <div><Label>Image URL</Label><Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." /></div>
          <div><Label>Why it slaps</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
          <Button type="submit" disabled={create.isPending} className="w-full">{create.isPending ? "Pitching..." : "Pitch it"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
