import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowUp,
  Download,
  FileDown,
  LogOut,
  MapPin,
  MessageCircle,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { toast } from "sonner";
import { closeExpiredTrips } from "@/lib/trips-maintenance.functions";
import { PitchTripDialog } from "@/components/pitch-trip-dialog";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { BulkConfirmDialog } from "@/components/bulk-confirm-dialog";
import { useMe } from "@/hooks/use-me";
import { exportTripsPdf } from "@/lib/exports/trip-pdf";
import { exportTripsIcs } from "@/lib/exports/trip-ics";
import { track } from "@/lib/analytics";

// CalendarDown isn't exported by lucide; we use Download / FileDown / Calendar below.
// (kept imports tidy below)

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
  id: string;
  user_id: string;
  title: string;
  region: string;
  country: string | null;
  city: string | null;
  description: string | null;
  image_url: string | null;
  best_months: string | null;
  created_at: string;
  is_past: boolean;
  start_date: string | null;
  end_date: string | null;
  vibes: string[] | null;
  budget: string | null;
  best_time: string | null;
  trip_length: string | null;
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
  (comments ?? []).forEach((c) => {
    commentCounts[c.destination_id] = (commentCounts[c.destination_id] ?? 0) + 1;
  });

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
  const names = [
    "winter",
    "winter",
    "spring",
    "spring",
    "spring",
    "early summer",
    "summer",
    "late summer",
    "early autumn",
    "autumn",
    "late autumn",
    "winter",
  ];
  const monthName = new Date(iso).toLocaleString(undefined, { month: "short" });
  return `${monthName} · ${names[m]}`;
}

function isEffectivelyPast(d: DestRow): boolean {
  if (d.is_past) return true;
  if (!d.end_date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return d.end_date < today;
}

type Trip = Awaited<ReturnType<typeof fetchTrips>>[number];

function TripsPage() {
  const { data } = useSuspenseQuery(tripsQueryOptions);
  const me = useMe().data;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [query, setQuery] = useState("");
  const sel = useBulkSelection<string>();
  const [confirmKind, setConfirmKind] = useState<null | "delete" | "leave">(null);
  const [working, setWorking] = useState(false);

  // Opportunistic auto-close expired trips, then refresh.
  useEffect(() => {
    let cancelled = false;
    closeExpiredTrips()
      .then((r) => {
        if (!cancelled && r?.closed) qc.invalidateQueries({ queryKey: ["trips"] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [qc]);

  // Clear selection when switching tabs.
  useEffect(() => {
    sel.clear();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const filtered = (data ?? [])
    .filter((d) => (tab === "past" ? isEffectivelyPast(d) : !isEffectivelyPast(d)))
    .filter((d) => {
      if (!q) return true;
      const hay = [d.title, d.region, d.country, d.city, d.description, ...(d.vibes ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

  const orderedIds = useMemo(() => filtered.map((d) => d.id), [filtered]);
  const tripById = useMemo(() => new Map(filtered.map((d) => [d.id, d])), [filtered]);
  const selectedTrips: Trip[] = sel.ids.map((id) => tripById.get(id)).filter(Boolean) as Trip[];
  const myId = me?.id;

  const partition = (kind: "delete" | "leave") => {
    const willApply: { id: string; label: string }[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];
    for (const t of selectedTrips) {
      const isOwner = !!myId && t.user_id === myId;
      const label = t.title;
      if (kind === "delete") {
        if (isOwner) willApply.push({ id: t.id, label });
        else skipped.push({ id: t.id, label, reason: "you're not the owner — use Leave" });
      } else {
        if (!isOwner) willApply.push({ id: t.id, label });
        else skipped.push({ id: t.id, label, reason: "you own this trip — use Delete" });
      }
    }
    return { willApply, skipped };
  };

  const runDelete = async () => {
    const { willApply } = partition("delete");
    setWorking(true);
    try {
      const results = await Promise.allSettled(
        willApply.map((w) => supabase.from("destinations").delete().eq("id", w.id)),
      );
      const failed = results.filter(
        (r) => r.status === "rejected" || (r.value as { error?: unknown }).error,
      ).length;
      const ok = results.length - failed;
      if (ok) toast.success(`Deleted ${ok} trip${ok === 1 ? "" : "s"}`);
      if (failed) toast.error(`${failed} failed to delete`);
      track("bulk_delete", { surface: "trips", count: ok });
      sel.clear();
      qc.invalidateQueries({ queryKey: ["trips"] });
    } finally {
      setWorking(false);
      setConfirmKind(null);
    }
  };

  const runLeave = async () => {
    const { willApply } = partition("leave");
    if (!myId) return;
    setWorking(true);
    try {
      const results = await Promise.allSettled(
        willApply.map((w) =>
          supabase.from("trip_members").delete().eq("destination_id", w.id).eq("user_id", myId),
        ),
      );
      const failed = results.filter(
        (r) => r.status === "rejected" || (r.value as { error?: unknown }).error,
      ).length;
      const ok = results.length - failed;
      if (ok) toast.success(`Left ${ok} trip${ok === 1 ? "" : "s"}`);
      if (failed) toast.error(`${failed} failed`);
      track("bulk_leave", { surface: "trips", count: ok });
      sel.clear();
      qc.invalidateQueries({ queryKey: ["trips"] });
    } finally {
      setWorking(false);
      setConfirmKind(null);
    }
  };

  const runExportPdf = async () => {
    if (selectedTrips.length === 0) return;
    setWorking(true);
    try {
      await exportTripsPdf(selectedTrips);
      track("bulk_export", { format: "pdf", count: selectedTrips.length });
      toast.success(
        `Exported ${selectedTrips.length} trip${selectedTrips.length === 1 ? "" : "s"} to PDF`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setWorking(false);
    }
  };

  const runExportIcs = async () => {
    if (selectedTrips.length === 0) return;
    setWorking(true);
    try {
      await exportTripsIcs(selectedTrips);
      track("bulk_export", { format: "ics", count: selectedTrips.length });
      toast.success(
        `Exported ${selectedTrips.length} trip${selectedTrips.length === 1 ? "" : "s"} to calendar`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Calendar export failed");
    } finally {
      setWorking(false);
    }
  };

  const allVisibleSelected = orderedIds.length > 0 && orderedIds.every((id) => sel.isSelected(id));

  return (
    <div className="space-y-8 pb-24">
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
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search trips, places, vibes…"
            aria-label="Search trips"
            className="w-full rounded-full border border-border/60 bg-card/60 py-1.5 pl-9 pr-3 text-sm backdrop-blur outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
          />
        </div>
      </div>
      {q && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} match{filtered.length === 1 ? "" : "es"} for "{query}"
        </p>
      )}

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

        {filtered.map((d) => (
          <TripCard
            key={d.id}
            d={d}
            selected={sel.isSelected(d.id)}
            anySelected={sel.count > 0}
            onSelect={(shift) => (shift ? sel.toggleRange(d.id, orderedIds) : sel.toggle(d.id))}
          />
        ))}
      </div>

      <BulkActionBar
        count={sel.count}
        noun="trip"
        onClear={sel.clear}
        leading={
          orderedIds.length > sel.count && (
            <button
              type="button"
              onClick={() => sel.selectAll(orderedIds)}
              className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {allVisibleSelected ? "" : `Select all ${orderedIds.length}`}
            </button>
          )
        }
        actions={[
          { label: "Export PDF", icon: FileDown, onClick: runExportPdf, pending: working },
          { label: "Export calendar", icon: Download, onClick: runExportIcs, pending: working },
          {
            label: "Leave",
            icon: LogOut,
            onClick: () => setConfirmKind("leave"),
            pending: working,
          },
          {
            label: "Delete",
            icon: Trash2,
            onClick: () => setConfirmKind("delete"),
            destructive: true,
            pending: working,
          },
        ]}
      />

      {confirmKind && (
        <BulkConfirmDialog
          open
          onOpenChange={(v) => !v && setConfirmKind(null)}
          title={confirmKind === "delete" ? "Delete selected trips?" : "Leave selected trips?"}
          description={
            confirmKind === "delete"
              ? "Deleting a trip removes its costs, stays, flights and chatter for everyone. This cannot be undone."
              : "You'll be removed as a member. The trip stays for everyone else."
          }
          willApply={partition(confirmKind).willApply}
          skipped={partition(confirmKind).skipped}
          destructive
          confirmLabel={confirmKind === "delete" ? "Delete" : "Leave"}
          onConfirm={confirmKind === "delete" ? runDelete : runLeave}
        />
      )}
    </div>
  );
}

function TripCard({
  d,
  selected,
  anySelected,
  onSelect,
}: {
  d: Trip;
  selected: boolean;
  anySelected: boolean;
  onSelect: (shiftKey: boolean) => void;
}) {
  const qc = useQueryClient();
  const vote = useMutation({
    mutationFn: async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw new Error("Not signed in");
      const uid = s.session.user.id;
      if (d.voted) {
        const { error } = await supabase
          .from("votes")
          .delete()
          .eq("destination_id", d.id)
          .eq("user_id", uid);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("votes")
          .insert({ destination_id: d.id, user_id: uid });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void import("@/lib/analytics").then(({ track }) =>
        track(d.voted ? "trip_unvote" : "trip_vote", {}, d.id),
      );
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Vote failed"),
  });

  const [imgState, setImgState] = useState<"loading" | "loaded" | "error">(
    d.image_url ? "loading" : "error",
  );
  const dateSubtitle = seasonLabel(d.start_date);
  const past = isEffectivelyPast(d);

  // Deterministic gradient cover from the trip title (no external CDN, no 404s).
  const cover = useMemo(() => {
    const seed = (d.title + d.region).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const hue = seed % 360;
    const initial = (d.city || d.title).trim().charAt(0).toUpperCase() || "?";
    return {
      bg: `linear-gradient(135deg, hsl(${hue} 70% 35%) 0%, hsl(${(hue + 40) % 360} 65% 22%) 60%, hsl(${(hue + 80) % 360} 60% 18%) 100%)`,
      initial,
    };
  }, [d.title, d.region, d.city]);

  const handleCheckbox = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(e.shiftKey);
  };

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-soft)] transition ${
        selected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border/60 hover:border-primary/40"
      }`}
    >
      {/* Selection checkbox — always visible once anything is selected, otherwise on hover */}
      <button
        type="button"
        onClick={handleCheckbox}
        aria-pressed={selected}
        aria-label={selected ? `Deselect ${d.title}` : `Select ${d.title}`}
        title="Shift-click to select a range"
        className={`absolute left-3 top-3 z-20 grid size-7 place-items-center rounded-full border bg-background/90 backdrop-blur transition ${
          selected || anySelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        } ${selected ? "border-primary text-primary" : "border-border/70 text-muted-foreground hover:text-foreground"}`}
      >
        <Checkbox checked={selected} className="pointer-events-none size-4" />
      </button>

      <Link to="/trips/$id" params={{ id: d.id }} className="block">
        <div className="relative aspect-[16/10] overflow-hidden bg-muted">
          {d.image_url && imgState === "loading" && (
            <Skeleton className="absolute inset-0 size-full rounded-none" />
          )}
          {d.image_url && imgState !== "error" && (
            <img
              src={d.image_url}
              alt={`${d.title} preview`}
              className={`size-full object-cover transition group-hover:scale-105 ${imgState === "loaded" ? "opacity-100" : "opacity-0"}`}
              loading="lazy"
              onLoad={() => setImgState("loaded")}
              onError={() => setImgState("error")}
            />
          )}
          {(!d.image_url || imgState === "error") && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center"
              style={{ background: cover.bg }}
              aria-hidden
            >
              <span className="font-display text-6xl font-bold text-white/90 drop-shadow-sm">
                {cover.initial}
              </span>
              <p className="px-4 font-display text-base text-white/85">{d.title}</p>
            </div>
          )}
          <div className="absolute left-12 top-3 rounded-full bg-background/80 px-2.5 py-1 text-xs backdrop-blur">
            <MapPin className="mr-1 inline size-3 text-primary" />
            {d.city ? `${d.city}, ${d.region}` : d.region}
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
          <Link
            to="/trips/$id"
            params={{ id: d.id }}
            className="font-display text-xl hover:text-primary"
          >
            {d.title}
          </Link>
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
              <span
                key={v}
                className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground"
              >
                {v}
              </span>
            ))}
            {d.vibes.length > 3 && (
              <span className="text-[11px] text-muted-foreground">+{d.vibes.length - 3}</span>
            )}
          </div>
        )}
        {d.description && (
          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
        )}
        <Link
          to="/trips/$id"
          params={{ id: d.id }}
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <MessageCircle className="size-3.5" /> {d.comments} in chatter
        </Link>
      </div>
    </article>
  );
}
