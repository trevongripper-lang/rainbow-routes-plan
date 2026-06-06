import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowUp, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/trips/$id")({
  component: TripDetail,
});

async function fetchTrip(id: string) {
  const [{ data: dest }, { data: votes }, { data: comments }, { data: user }] = await Promise.all([
    supabase.from("destinations").select("*").eq("id", id).maybeSingle(),
    supabase.from("votes").select("user_id").eq("destination_id", id),
    supabase.from("comments").select("*").eq("destination_id", id).order("created_at", { ascending: true }),
    supabase.auth.getUser(),
  ]);
  if (!dest) return null;
  const me = user.user?.id;
  const authorIds = Array.from(new Set([dest.user_id, ...(comments ?? []).map((c) => c.user_id)]));
  const { data: profiles } = await supabase.from("profiles").select("id, display_name, avatar_url").in("id", authorIds);
  const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return {
    dest,
    me,
    author: pmap.get(dest.user_id),
    votes: votes?.length ?? 0,
    voted: !!votes?.some((v) => v.user_id === me),
    comments: (comments ?? []).map((c) => ({ ...c, author: pmap.get(c.user_id) })),
  };
}

function TripDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["trip", id], queryFn: () => fetchTrip(id) });
  const [body, setBody] = useState("");

  const vote = useMutation({
    mutationFn: async () => {
      if (!data?.me) return;
      if (data.voted) {
        await supabase.from("votes").delete().eq("destination_id", id).eq("user_id", data.me);
      } else {
        await supabase.from("votes").insert({ destination_id: id, user_id: data.me });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trip", id] }); qc.invalidateQueries({ queryKey: ["trips"] }); },
  });

  const addComment = useMutation({
    mutationFn: async () => {
      if (!data?.me || !body.trim()) return;
      const { error } = await supabase.from("comments").insert({ destination_id: id, user_id: data.me, body: body.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: ["trip", id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteTrip = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("destinations").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Deleted"); navigate({ to: "/trips" }); },
  });

  if (isLoading) return <div className="h-96 animate-pulse rounded-2xl bg-card/60" />;
  if (!data) return <div className="py-20 text-center text-muted-foreground">Trip not found.</div>;

  const { dest, author, votes, voted, comments, me } = data;
  const isOwner = me === dest.user_id;

  return (
    <div className="space-y-8">
      <Link to="/trips" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All trips
      </Link>

      <header className="overflow-hidden rounded-3xl border border-border/60 bg-card">
        {dest.image_url ? (
          <img src={dest.image_url} alt={dest.title} className="aspect-[16/8] w-full object-cover" />
        ) : (
          <div className="aspect-[16/8] w-full" style={{ background: "var(--gradient-hero)" }} />
        )}
        <div className="p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="size-3.5 text-primary" /> {dest.region}{dest.country ? ` · ${dest.country}` : ""}{dest.best_months ? ` · ${dest.best_months}` : ""}
              </div>
              <h1 className="mt-2 font-display text-4xl md:text-5xl">{dest.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">Pitched by {author?.display_name ?? "someone"}</p>
            </div>
            <button
              onClick={() => vote.mutate()}
              className={`flex flex-col items-center rounded-2xl border px-5 py-3 text-base transition ${voted ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/50"}`}
            >
              <ArrowUp className="size-5" />
              <span className="font-medium tabular-nums">{votes}</span>
            </button>
          </div>
          {dest.description && <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">{dest.description}</p>}
          {isOwner && (
            <button onClick={() => deleteTrip.mutate()} className="mt-5 inline-flex items-center gap-1.5 text-xs text-destructive hover:underline">
              <Trash2 className="size-3.5" /> Delete this pitch
            </button>
          )}
        </div>
      </header>

      <section>
        <h2 className="font-display text-2xl">Chatter</h2>
        <p className="text-sm text-muted-foreground">Trip tips, flight finds, club intel.</p>

        <form onSubmit={(e) => { e.preventDefault(); addComment.mutate(); }} className="mt-4 space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add to the chatter..." rows={3} />
          <div className="flex justify-end"><Button type="submit" disabled={addComment.isPending || !body.trim()}>Post</Button></div>
        </form>

        <ul className="mt-6 space-y-3">
          {comments.length === 0 && <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No chatter yet. Kick it off.</li>}
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-border/60 bg-card p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="grid size-6 place-items-center rounded-full bg-primary/20 text-[10px] font-medium text-primary">
                  {(c.author?.display_name ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <span className="text-foreground">{c.author?.display_name ?? "Someone"}</span>
                <span>· {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
