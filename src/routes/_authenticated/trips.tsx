import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowUp, MapPin, MessageCircle, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/trips")({
  component: TripsPage,
});

type DestRow = {
  id: string; user_id: string; title: string; region: string; country: string | null;
  description: string | null; image_url: string | null; best_months: string | null; created_at: string;
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

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Where to next?</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pitch a destination, upvote favorites, plot the move.</p>
        </div>
        <NewTripDialog />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-2xl bg-card/60" />
        ))}
        {data?.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card/30 p-10 text-center">
            <p className="font-display text-xl">No destinations yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Be the first to pitch one.</p>
          </div>
        )}
        {data?.map((d) => <TripCard key={d.id} d={d} />)}
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
        </div>
      </Link>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <Link to="/trips/$id" params={{ id: d.id }} className="font-display text-xl hover:text-primary">{d.title}</Link>
          <button
            onClick={() => vote.mutate()}
            disabled={vote.isPending}
            className={`flex shrink-0 flex-col items-center rounded-xl border px-3 py-1.5 text-sm transition ${d.voted ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/50"}`}
          >
            <ArrowUp className="size-4" />
            <span className="font-medium tabular-nums">{d.votes}</span>
          </button>
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
