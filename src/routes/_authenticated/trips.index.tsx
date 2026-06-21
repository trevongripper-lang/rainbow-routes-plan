import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";


import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUp, MapPin, MessageCircle, Search, Sparkles, Star } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { toast } from "sonner";
import { closeExpiredTrips } from "@/lib/trips-maintenance.functions";
import { PitchTripDialog } from "@/components/pitch-trip-dialog";

export const Route = createFileRoute("/_authenticated/trips/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(tripsQueryOptions),
  component: TripsPage,
  errorComponent: ({ error }) => (
    <div className="py-20 text-center text-muted-foreground">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="py-20 text-center text-muted-foreground">Not found.</div>
  ),
});

type DestRow = {
  id: string; user_id: string; title: string; region: string; country: string | null;
  city: string | null;
  description: string | null; image_url: string | null; best_months: string | null; created_at: string;
  is_past: boolean; start_date: string | null; end_date: string | null;
  vibes: string[] | null; budget: string | null; best_time: string | null; trip_length: string | null;
};

async function fetchTrips() {
  const [{ data: dests }, { data: votes }, { data: comments }, { data: user }] = await Promise.all([
    supabase.from("destinations").select("*").order("created_at", { ascending: false }),
    supabase.from("votes").select("destination_id, user_id"),
    supabase.from("comments").select("destination_id"),
    supabase.auth.getSession().then((r) => ({ data: { user: r.data.session?.user ?? null } })),
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

const tripsQueryOptions = queryOptions({
  queryKey: ["trips"],
  queryFn: fetchTrips,
  staleTime: 30_000,
});

function seasonLabel(iso: string | null): string {
  if (!iso) return "";
  const m = new Date(iso).getUTCMonth();
  const names = ["winter", "winter", "spring", "spring", "spring", "early summer", "summer", "late summer", "early autumn", "autumn", "late autumn", "winter"];
  const monthName = new Date(iso).toLocaleString(undefined, { month: "short" });
  return `${monthName} · ${names[m]}`;
}

function isEffectivelyPast(d: DestRow): boolean {
  if (d.is_past) return true;
  if (!d.end_date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return d.end_date < today;
}

function TripsPage() {
  const { data } = useSuspenseQuery(tripsQueryOptions);
  const qc = useQueryClient();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [query, setQuery] = useState("");

  // Opportunistic auto-close expired trips, then refresh.
  useEffect(() => {
    let cancelled = false;
    closeExpiredTrips()
      .then((r) => { if (!cancelled && r?.closed) qc.invalidateQueries({ queryKey: ["trips"] }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [qc]);

  const q = query.trim().toLowerCase();
  const filtered = (data ?? [])
    .filter((d) => (tab === "past" ? isEffectivelyPast(d) : !isEffectivelyPast(d)))
    .filter((d) => {
      if (!q) return true;
      const hay = [d.title, d.region, d.country, d.city, d.description, ...(d.vibes ?? [])]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });

  return (
    <div className="space-y-8">
      <PageHero
        crumbs={[{ label: "Trips" }]}
        eyebrow="Your crew's wanderlust"
        eyebrowIcon={Sparkles}
        title="Where to"
        highlight="next?"
        description="Pitch a destination, upvote favorites, plot the move — together."
        actions={<PitchTripDialog />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-border/60 bg-card/60 p-1 text-sm backdrop-blur">
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
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center backdrop-blur">
            <p className="font-display text-2xl">
              {tab === "past" ? "No past trips yet." : "Your crew's next move starts here."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {tab === "past"
                ? "Trips auto-close 1 day after their end date."
                : "Get them out of the group chat and into the plan — pitch the first destination."}
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

  const imageSrc = useMemo(() => {
    if (d.image_url) return d.image_url;
    const place = d.city || d.title.replace(/\b(trip|week|weekend|circuit|tour|getaway|vacation|holiday|adventure|crew|squad)\b/gi, "").trim();
    const season = seasonLabel(d.start_date || d.end_date).split(" · ")[1] || "";
    const parts = [place, d.region, d.country, season, "travel"].filter(Boolean);
    return `https://source.unsplash.com/featured/800x500/?${encodeURIComponent(parts.join(","))}`;
  }, [d.image_url, d.title, d.city, d.region, d.country, d.start_date, d.end_date]);

  const [imgState, setImgState] = useState<"loading" | "loaded" | "error">("loading");
  const dateSubtitle = seasonLabel(d.start_date);
  const past = isEffectivelyPast(d);

  return (
    <article className="group overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-soft)] transition hover:border-primary/40">
      <Link to="/trips/$id" params={{ id: d.id }} className="block">
        <div className="relative aspect-[16/10] overflow-hidden bg-muted">
          {imgState === "loading" && <Skeleton className="absolute inset-0 size-full rounded-none" />}
          {imgState !== "error" && (
            <img
              src={imageSrc}
              alt={`${d.title} preview`}
              className={`size-full object-cover transition group-hover:scale-105 ${imgState === "loaded" ? "opacity-100" : "opacity-0"}`}
              loading="lazy"
              onLoad={() => setImgState("loaded")}
              onError={() => setImgState("error")}
            />
          )}
          {imgState === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/15 via-accent/10 to-muted text-center">
              <ImageOff className="size-7 text-muted-foreground" aria-hidden />
              <p className="font-display text-base text-foreground/80">{d.title}</p>
              <p className="text-xs text-muted-foreground">No preview image yet</p>
            </div>
          )}
          <div className="absolute left-3 top-3 rounded-full bg-background/80 px-2.5 py-1 text-xs backdrop-blur">
            <MapPin className="mr-1 inline size-3 text-primary" />{d.city ? `${d.city}, ${d.region}` : d.region}
          </div>
          {past && (
            <div className="absolute right-3 top-3 rounded-full bg-accent/90 px-2.5 py-1 text-xs font-medium text-accent-foreground backdrop-blur">
              Past trip
            </div>
          )}
        </div>
      </Link>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <Link to="/trips/$id" params={{ id: d.id }} className="font-display text-xl hover:text-primary">{d.title}</Link>
          {past ? (
            <Link
              to="/trips/$id"
              params={{ id: d.id }}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:border-primary/50"
            >
              <Star className="size-4 text-primary" /> Rate
            </Link>
          ) : (
            <button
              onClick={() => vote.mutate()}
              disabled={vote.isPending}
              aria-pressed={d.voted}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${d.voted ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/50"}`}
            >
              <ArrowUp className={`size-4 ${d.voted ? "fill-primary" : ""}`} />
              <span>{d.voted ? "Upvoted" : "Upvote"}</span>
              <span className="tabular-nums text-muted-foreground">· {d.votes}</span>
            </button>
          )}
        </div>
        {(d.country || dateSubtitle || d.best_time || d.trip_length) && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[d.country, dateSubtitle || d.best_time, d.trip_length].filter(Boolean).join(" · ")}
            {d.budget ? ` · ${d.budget}` : ""}
          </p>
        )}
        {d.vibes && d.vibes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.vibes.slice(0, 3).map((v) => (
              <span key={v} className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">{v}</span>
            ))}
            {d.vibes.length > 3 && <span className="text-[11px] text-muted-foreground">+{d.vibes.length - 3}</span>}
          </div>
        )}
        {d.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>}
        <Link to="/trips/$id" params={{ id: d.id }} className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <MessageCircle className="size-3.5" /> {d.comments} in chatter
        </Link>
      </div>
    </article>
  );
}

