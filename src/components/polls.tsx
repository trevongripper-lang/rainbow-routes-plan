import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Vote, Plus, Trash2, Lock, Check, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

type Poll = {
  id: string;
  destination_id: string;
  user_id: string;
  question: string;
  kind: string;
  allow_multi: boolean;
  closed_at: string | null;
  created_at: string;
  options: { id: string; label: string; image_url: string | null }[];
  votes: { option_id: string; user_id: string }[];
};

async function fetchPolls(destinationId: string): Promise<Poll[]> {
  const { data: polls } = await supabase
    .from("trip_polls")
    .select("*")
    .eq("destination_id", destinationId)
    .order("created_at", { ascending: false });
  if (!polls?.length) return [];
  const ids = polls.map((p) => p.id);
  const [{ data: options }, { data: votes }] = await Promise.all([
    supabase.from("trip_poll_options").select("id, poll_id, label, image_url, sort_order").in("poll_id", ids).order("sort_order"),
    supabase.from("trip_poll_votes").select("poll_id, option_id, user_id").in("poll_id", ids),
  ]);
  return polls.map((p) => ({
    ...p,
    options: (options ?? []).filter((o) => o.poll_id === p.id).map((o) => ({ id: o.id, label: o.label, image_url: o.image_url })),
    votes: (votes ?? []).filter((v) => v.poll_id === p.id).map((v) => ({ option_id: v.option_id, user_id: v.user_id })),
  }));
}

export function PollsPanel({ destinationId, me }: { destinationId: string; me: string }) {
  const qc = useQueryClient();
  const { data: polls = [], isLoading } = useQuery({
    queryKey: ["polls", destinationId],
    queryFn: () => fetchPolls(destinationId),
  });

  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState("");
  const [opts, setOpts] = useState<string[]>(["", ""]);
  const [allowMulti, setAllowMulti] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      const q = question.trim();
      const cleanOpts = opts.map((o) => o.trim()).filter(Boolean);
      if (!q) throw new Error("Add a question");
      if (cleanOpts.length < 2) throw new Error("Add at least two options");
      const { data: poll, error } = await supabase
        .from("trip_polls")
        .insert({ destination_id: destinationId, user_id: me, question: q, allow_multi: allowMulti })
        .select("id")
        .single();
      if (error) throw error;
      const { error: oerr } = await supabase
        .from("trip_poll_options")
        .insert(cleanOpts.map((label, i) => ({ poll_id: poll.id, label, sort_order: i })));
      if (oerr) throw oerr;
    },
    onSuccess: () => {
      setCreating(false);
      setQuestion("");
      setOpts(["", ""]);
      setAllowMulti(false);
      qc.invalidateQueries({ queryKey: ["polls", destinationId] });
      toast.success("Poll posted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote className="size-5 text-primary" />
          <h3 className="font-display text-lg">Group decisions</h3>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating((v) => !v)}>
          <Plus className="mr-1 size-4" /> New poll
        </Button>
      </div>

      {creating && (
        <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Which Airbnb? / Friday night plans? / Pizza or tapas?"
            maxLength={280}
          />
          <div className="space-y-2">
            {opts.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={o}
                  onChange={(e) => {
                    const next = [...opts];
                    next[i] = e.target.value;
                    setOpts(next);
                  }}
                  placeholder={`Option ${i + 1}`}
                  maxLength={200}
                />
                {opts.length > 2 && (
                  <button
                    onClick={() => setOpts(opts.filter((_, idx) => idx !== i))}
                    className="rounded-md p-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setOpts([...opts, ""])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              + Add option
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={allowMulti} onChange={(e) => setAllowMulti(e.target.checked)} />
            Allow multiple selections per person
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : "Post poll"}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {isLoading && <div className="h-20 animate-pulse rounded-xl bg-background/40" />}
        {!isLoading && polls.length === 0 && !creating && (
          <p className="text-sm text-muted-foreground">
            No polls yet. Stop debating in chat — put it to a vote.
          </p>
        )}
        {polls.map((poll) => (
          <PollCard key={poll.id} poll={poll} me={me} />
        ))}
      </div>
    </section>
  );
}

function PollCard({ poll, me }: { poll: Poll; me: string }) {
  const qc = useQueryClient();
  const closed = !!poll.closed_at;
  const total = poll.votes.length;
  const voters = new Set(poll.votes.map((v) => v.user_id)).size;
  const myVotes = new Set(poll.votes.filter((v) => v.user_id === me).map((v) => v.option_id));
  const canManage = poll.user_id === me;

  const toggle = useMutation({
    mutationFn: async (optionId: string) => {
      if (closed) return;
      const has = myVotes.has(optionId);
      if (has) {
        const { error } = await supabase
          .from("trip_poll_votes")
          .delete()
          .eq("poll_id", poll.id)
          .eq("option_id", optionId)
          .eq("user_id", me);
        if (error) throw error;
      } else {
        if (!poll.allow_multi && myVotes.size > 0) {
          await supabase.from("trip_poll_votes").delete().eq("poll_id", poll.id).eq("user_id", me);
        }
        const { error } = await supabase
          .from("trip_poll_votes")
          .insert({ poll_id: poll.id, option_id: optionId, user_id: me });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["polls", poll.destination_id] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Vote failed"),
  });

  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("trip_polls")
        .update({ closed_at: closed ? null : new Date().toISOString() })
        .eq("id", poll.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["polls", poll.destination_id] }),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("trip_polls").delete().eq("id", poll.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["polls", poll.destination_id] }),
  });

  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{poll.question}</p>
          <p className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Users className="size-3" /> {voters} {voters === 1 ? "voter" : "voters"} · {total} {total === 1 ? "vote" : "votes"}</span>
            {closed && <span className="inline-flex items-center gap-1 text-amber-500"><Lock className="size-3" /> Closed</span>}
            {poll.allow_multi && <span>multi-select</span>}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-1">
            <button onClick={() => close.mutate()} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground" title={closed ? "Reopen" : "Close"}>
              <Lock className="size-3.5" />
            </button>
            <button onClick={() => del.mutate()} className="rounded-md p-1.5 text-muted-foreground hover:text-destructive" title="Delete">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {poll.options.map((o) => {
          const count = poll.votes.filter((v) => v.option_id === o.id).length;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const picked = myVotes.has(o.id);
          return (
            <button
              key={o.id}
              onClick={() => toggle.mutate(o.id)}
              disabled={closed}
              className={`group relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition ${
                picked ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              } ${closed ? "cursor-default opacity-80" : ""}`}
            >
              <div
                className={`absolute inset-y-0 left-0 transition-all ${picked ? "bg-primary/15" : "bg-muted/40"}`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {picked && <Check className="size-4 text-primary" />}
                  {o.label}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{pct}% · {count}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
