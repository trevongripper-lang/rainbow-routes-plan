import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, useQuery, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ArrowUp, MapPin, Trash2, Star, Archive, RotateCcw, Wand2 } from "lucide-react";
import { Breadcrumbs } from "@/components/page-hero";
import { toast } from "sonner";

import { StaysTab, TicketsTab, CostsTab } from "@/components/trip-tabs";
import { FlightsTab } from "@/components/flights-tab";
import { Chatter } from "@/components/chatter";
import { InviteModal } from "@/components/invite-modal";
import { UnlockTripButton } from "@/components/unlock-trip-button";
import { ItineraryTab } from "@/components/itinerary-tab";
import { TripEventsStrip } from "@/components/trip-events-strip";
import { SmartAdd } from "@/components/smart-add";
import { PollsPanel } from "@/components/polls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AttendeesCard } from "@/components/attendees-card";

async function fetchTrip(id: string) {
  // 2 round-trips instead of 5: one combined destinations+votes+comments query,
  // then one profiles lookup for all author ids. Uses cached session (no network).
  const [{ data: session }, { data: dest }] = await Promise.all([
    supabase.auth.getSession(),
    supabase
      .from("destinations")
      .select("*, votes(user_id), comments(id, user_id, body, created_at, destination_id)")
      .eq("id", id)
      .order("created_at", { foreignTable: "comments", ascending: true })
      .maybeSingle(),
  ]);
  if (!dest) return null;
  const me = session.session?.user?.id;
  const votes = (dest as { votes: { user_id: string }[] }).votes ?? [];
  const comments = (dest as { comments: { id: string; user_id: string; body: string; created_at: string; destination_id: string }[] }).comments ?? [];
  const authorIds = Array.from(new Set([dest.user_id, ...comments.map((c) => c.user_id)]));
  const { data: profiles } = await supabase.rpc("get_public_profiles", { _ids: authorIds });
  const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return {
    dest,
    me,
    author: pmap.get(dest.user_id),
    votes: votes.length,
    voted: !!me && votes.some((v) => v.user_id === me),
    comments: comments.map((c) => ({ ...c, author: pmap.get(c.user_id) })),
  };
}

const tripQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["trip", id],
    queryFn: () => fetchTrip(id),
    staleTime: 30_000,
  });

export const Route = createFileRoute("/_authenticated/trips/$id")({
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData(tripQueryOptions(params.id)),
  head: ({ loaderData }) => {
    const img = (loaderData as { dest?: { image_url?: string | null } } | null | undefined)?.dest?.image_url;
    return {
      links: img
        ? [{ rel: "preload", as: "image", href: img, fetchpriority: "high" } as { rel: string; as: string; href: string; fetchpriority: string }]
        : [],
    };
  },
  component: TripDetail,
  errorComponent: ({ error }) => (
    <div className="py-20 text-center text-muted-foreground">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="py-20 text-center text-muted-foreground">Trip not found.</div>
  ),
});

async function fetchRatingData(id: string, me: string | undefined) {
  const [{ data: agg }, mine] = await Promise.all([
    supabase.rpc("get_trip_rating_aggregate", { _destination_id: id }),
    me ? supabase.from("trip_ratings").select("*").eq("destination_id", id).eq("user_id", me).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const a = (agg as any)?.[0] ?? { avg_rating: null, rating_count: 0, feedbacks: [] };
  return { agg: a, mine: (mine as any)?.data ?? null };
}

function TripDetail() {
  const { id } = Route.useParams();
  const search = useSearch({ from: "/_authenticated/trips/$id" });
  const tab = (search as Record<string, unknown>)?.tab as string | undefined;
  const activeTab = tab || "overview";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(tripQueryOptions(id));
  const [endDateDraft, setEndDateDraft] = useState<string>("");
  const [startDateDraft, setStartDateDraft] = useState<string>("");

  useEffect(() => {
    if (data?.dest.end_date) setEndDateDraft(data.dest.end_date);
  }, [data?.dest.end_date]);
  useEffect(() => {
    const sd = (data?.dest as { start_date?: string | null } | undefined)?.start_date;
    if (sd) setStartDateDraft(sd);
  }, [data?.dest]);

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

  const saveDates = useMutation({
    mutationFn: async ({ start, end }: { start: string; end: string }) => {
      if (start && end && end < start) throw new Error("End date can't be before start date");
      const { error } = await supabase
        .from("destinations")
        .update({ start_date: start || null, end_date: end || null } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trip", id] }); toast.success("Trip dates saved"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteTrip = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("destinations").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Deleted"); navigate({ to: "/trips" }); },
  });

  const togglePast = useMutation({
    mutationFn: async () => {
      if (!data) return;
      const { error } = await supabase.from("destinations").update({ is_past: !data.dest.is_past }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trip", id] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success(data?.dest.is_past ? "Moved back to upcoming" : "Archived as past trip");
    },
  });

  if (!data) return <div className="py-20 text-center text-muted-foreground">Trip not found.</div>;

  const { dest, author, votes, voted, me } = data;
  const isOwner = me === dest.user_id;

  const isOverview = activeTab === "overview";

  return (
    <div className="space-y-8">
      <Breadcrumbs items={[{ label: "Trips", to: "/trips" }, { label: dest.title }]} />

      {isOverview ? (
        <header className="overflow-hidden rounded-3xl border border-border/60 bg-card">
          {dest.image_url ? (
            <img src={dest.image_url} alt={dest.title} className="aspect-[16/8] w-full object-cover" fetchPriority="high" />
          ) : (
            <div className="aspect-[16/8] w-full" style={{ background: "var(--gradient-hero)" }} />
          )}
          <div className="p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="size-3.5 text-primary" /> {dest.region}{dest.country ? ` · ${dest.country}` : ""}
                  {dest.is_past && <span className="ml-1 rounded-full bg-accent/30 px-2 py-0.5 text-accent-foreground">Past trip</span>}
                </div>
                <h1 className="mt-2 font-display text-4xl md:text-5xl">{dest.title}</h1>
                <p className="mt-2 text-sm text-muted-foreground">Pitched by {author?.display_name ?? "someone"}</p>
                <div className="mt-3"><AttendeesCard destinationId={id} /></div>
              </div>
              {!dest.is_past && (
                <button
                  onClick={() => vote.mutate()}
                  aria-pressed={voted}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${voted ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/50"}`}
                >
                  <ArrowUp className={`size-4 ${voted ? "fill-primary" : ""}`} />
                  <span>{voted ? "Upvoted" : "Upvote"}</span>
                  <span className="tabular-nums text-muted-foreground">· {votes}</span>
                </button>
              )}
              <Link
                to="/trips/$id"
                params={{ id }}
                search={{ tab: "flights" }}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-base font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
              >
                <Wand2 className="size-5" />
                AI Flight Lookup
              </Link>
            </div>
            {dest.description && <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">{dest.description}</p>}
            {isOwner && (
              <div className="mt-5 flex flex-wrap items-end gap-3">
                <InviteModal destinationId={id} isOwner={isOwner} />
                <UnlockTripButton destinationId={id} isOwner={isOwner} />
                <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
                  <div className="min-w-0 flex-1 sm:flex-none">
                    <Label className="text-xs">Start date</Label>
                    <Input
                      type="date"
                      value={startDateDraft}
                      onChange={(e) => setStartDateDraft(e.target.value)}
                      className="w-full sm:w-40"
                    />
                  </div>
                  <div className="min-w-0 flex-1 sm:flex-none">
                    <Label className="text-xs">End date</Label>
                    <Input
                      type="date"
                      value={endDateDraft}
                      min={startDateDraft || undefined}
                      onChange={(e) => setEndDateDraft(e.target.value)}
                      className="w-full sm:w-40"
                    />
                  </div>
                  {(startDateDraft !== ((dest as { start_date?: string | null }).start_date ?? "") ||
                    endDateDraft !== (dest.end_date ?? "")) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={saveDates.isPending}
                      onClick={() => saveDates.mutate({ start: startDateDraft, end: endDateDraft })}
                      className="shrink-0"
                    >
                      Save dates
                    </Button>
                  )}
                </div>
                <p className="basis-full text-[11px] text-muted-foreground sm:basis-auto sm:self-end">
                  Trips auto-close 1 day after the end date · ratings open then.
                </p>
              </div>
            )}
            {isOwner && (
              <div className="mt-4 flex flex-wrap gap-4 text-xs">
                <button onClick={() => togglePast.mutate()} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  {dest.is_past ? <><RotateCcw className="size-3.5" /> Override: reopen trip</> : <><Archive className="size-3.5" /> Override: mark as past now</>}
                </button>
                <button onClick={() => deleteTrip.mutate()} className="inline-flex items-center gap-1.5 text-destructive hover:underline">
                  <Trash2 className="size-3.5" /> Delete this pitch
                </button>
              </div>
            )}
          </div>
        </header>
      ) : (
        <header className="relative overflow-hidden rounded-2xl border border-border/60 bg-card">
          {dest.image_url && (
            <img src={dest.image_url} alt="" className="absolute inset-0 size-full object-cover opacity-30" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-card via-card/80 to-card/40" />
          <div className="relative flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl md:text-2xl">{dest.title}</h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="size-3 text-primary" />
                {dest.region}{dest.country ? ` · ${dest.country}` : ""}
                {dest.end_date && <span> · {dest.end_date}</span>}
                {dest.is_past && <span className="ml-1 rounded-full bg-accent/30 px-2 py-0.5 text-accent-foreground">Past</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AttendeesCard destinationId={id} />
              {isOwner && <InviteModal destinationId={id} isOwner={isOwner} />}
            </div>
          </div>
        </header>
      )}

      <Tabs value={activeTab} onValueChange={(v) => navigate({ to: "/trips/$id", params: { id }, search: { tab: v } })} className="w-full">


        <TabsContent value="overview" className="mt-6">
          {me ? (
            <div className="space-y-6">
              <SmartAdd destinationId={id} me={me} />
              <PollsPanel destinationId={id} me={me} />
              <TripEventsStrip destinationId={id} me={me} region={dest.region} country={dest.country} startDate={(dest as { start_date?: string | null }).start_date ?? null} endDate={dest.end_date} />
              <Chatter destinationId={id} me={me} />
            </div>
          ) : null}
        </TabsContent>

        {me && (
          <>
            <TabsContent value="itinerary" className="mt-6">
              <ItineraryTab
                destinationId={id}
                region={dest.region}
                country={dest.country}
                startDate={(dest as { start_date?: string | null }).start_date ?? null}
                endDate={dest.end_date}
                me={me}
              />
            </TabsContent>
            <TabsContent value="flights" className="mt-6"><FlightsTab destinationId={id} me={me} /></TabsContent>
            <TabsContent value="stays" className="mt-6"><StaysTab destinationId={id} me={me} title={dest.title} country={dest.country} /></TabsContent>
            <TabsContent value="tickets" className="mt-6">
              <div className="space-y-6">
                <TripEventsStrip destinationId={id} me={me} region={dest.region} country={dest.country} startDate={(dest as { start_date?: string | null }).start_date ?? null} endDate={dest.end_date} />
                <TicketsTab destinationId={id} me={me} />
              </div>
            </TabsContent>
            <TabsContent value="costs" className="mt-6"><CostsTab destinationId={id} me={me} headcount={dest.headcount ?? 2} isOwner={isOwner} /></TabsContent>
          </>
        )}

        {dest.is_past && me && (
          <TabsContent value="ratings" className="mt-6"><RatingsSection destinationId={id} me={me} /></TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function RatingsSection({ destinationId, me }: { destinationId: string; me: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["ratings", destinationId],
    queryFn: () => fetchRatingData(destinationId, me),
  });
  const [stars, setStars] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [hover, setHover] = useState(0);

  // Hydrate form once user's existing rating loads
  useEffect(() => {
    if (data?.mine) {
      setStars(data.mine.rating);
      setFeedback(data.mine.feedback ?? "");
    }
  }, [data?.mine]);

  const save = useMutation({
    mutationFn: async () => {
      if (!stars) throw new Error("Pick a star rating first");
      const { error } = await supabase.from("trip_ratings").upsert(
        { destination_id: destinationId, user_id: me, rating: stars, feedback: feedback.trim() || null },
        { onConflict: "destination_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Thanks for rating!");
      qc.invalidateQueries({ queryKey: ["ratings", destinationId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const avg = data?.agg?.avg_rating ? Number(data.agg.avg_rating) : 0;
  const count = Number(data?.agg?.rating_count ?? 0);
  const feedbacks: string[] = data?.agg?.feedbacks ?? [];

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">How was the trip?</h2>
          <p className="text-sm text-muted-foreground">Ratings & feedback are aggregated and anonymous.</p>
        </div>
        {count > 0 && (
          <div className="text-right">
            <div className="font-display text-3xl text-primary">{avg.toFixed(1)}<span className="text-base text-muted-foreground">/5</span></div>
            <div className="text-xs text-muted-foreground">{count} {count === 1 ? "rating" : "ratings"}</div>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-border/60 bg-background/40 p-5">
        <p className="text-sm font-medium">Your rating</p>
        <div className="mt-2 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onClick={() => setStars(n)}
              className="p-1"
            >
              <Star className={`size-7 transition ${(hover || stars) >= n ? "fill-primary text-primary" : "text-muted-foreground"}`} />
            </button>
          ))}
        </div>
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Anonymous feedback for the group — what worked, what to skip next time..."
          rows={3}
          className="mt-3"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Only the aggregate is shown to others.</p>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !stars}>
            {data?.mine ? "Update rating" : "Submit rating"}
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium">What the tribe said</p>
        {isLoading ? (
          <div className="mt-2 h-16 animate-pulse rounded-xl bg-card/60" />
        ) : feedbacks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No feedback yet — be the first.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {feedbacks.map((f, i) => (
              <li key={i} className="rounded-xl border border-border/60 bg-background/40 p-4 text-sm italic text-muted-foreground">
                &ldquo;{f}&rdquo;
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
