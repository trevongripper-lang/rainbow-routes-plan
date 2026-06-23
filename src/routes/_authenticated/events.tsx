import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, MapPin, ExternalLink, Sparkles, Plus, Check, X } from "lucide-react";
import { format } from "date-fns";
import { PageHero } from "@/components/page-hero";
import { useMe } from "@/hooks/use-me";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/events")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["events"],
      queryFn: fetchEvents,
      staleTime: 60_000,
    }),
  component: EventsPage,
});

type EventRow = {
  id: string;
  name: string;
  region: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string | null;
  description: string | null;
  url: string | null;
  tags: string | null;
};

type TripLite = { id: string; title: string; region: string; country: string | null };

async function fetchEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("start_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

async function fetchMyTrips(userId: string): Promise<TripLite[]> {
  const { data, error } = await supabase
    .from("trip_members")
    .select("destination_id, destinations:destination_id(id, title, region, country, is_past)")
    .eq("user_id", userId);
  if (error) throw error;
  return (
    (data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => r.destinations)
      .filter(
        (d: { is_past?: boolean } | null): d is TripLite & { is_past: boolean } =>
          !!d && !d.is_past,
      )
  );
}

async function fetchAttachments(tripId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("trip_events")
    .select("event_id")
    .eq("destination_id", tripId);
  if (error) throw error;
  return (data ?? []).map((r) => r.event_id);
}

function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

function EventsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const { data: events, isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: fetchEvents,
    staleTime: 60_000,
  });
  const { data: trips = [] } = useQuery({
    queryKey: ["my-trips-lite", me.data?.id],
    queryFn: () => fetchMyTrips(me.data!.id),
    enabled: !!me.data?.id,
  });

  const [region, setRegion] = useState<string>("All");
  const [tripId, setTripId] = useState<string>("all");

  // Default to the user's first upcoming trip so the Attach control is visible.
  useEffect(() => {
    if (tripId === "all" && trips.length > 0) setTripId(trips[0].id);
  }, [trips, tripId]);

  const activeTrip = trips.find((t) => t.id === tripId);

  const { data: attachedIds = [] } = useQuery({
    queryKey: ["trip-events", tripId],
    queryFn: () => fetchAttachments(tripId),
    enabled: tripId !== "all",
  });

  const attach = useMutation({
    mutationFn: async ({ eventId, attached }: { eventId: string; attached: boolean }) => {
      if (!me.data?.id || tripId === "all") return;
      if (attached) {
        const { error } = await supabase
          .from("trip_events")
          .delete()
          .eq("destination_id", tripId)
          .eq("event_id", eventId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("trip_events")
          .insert({ destination_id: tripId, event_id: eventId, added_by: me.data.id });
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["trip-events", tripId] });
      toast.success(vars.attached ? "Detached" : "Attached to trip");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const regions = useMemo(
    () => ["All", ...Array.from(new Set((events ?? []).map((e) => e.region)))],
    [events],
  );

  const filtered = useMemo(() => {
    let list = events ?? [];
    if (activeTrip) {
      const tCountry = norm(activeTrip.country);
      const tRegion = norm(activeTrip.region);
      const tTitle = norm(activeTrip.title);
      list = list.filter((e) => {
        if (attachedIds.includes(e.id)) return true;
        const eCountry = norm(e.country);
        const eRegion = norm(e.region);
        const eCity = norm(e.city);
        return (
          (tCountry && eCountry === tCountry) ||
          (tRegion && eRegion === tRegion) ||
          (tTitle && (eCity.includes(tTitle) || tTitle.includes(eCity)))
        );
      });
    }
    if (region !== "All") list = list.filter((e) => e.region === region);
    return list;
  }, [events, region, activeTrip, attachedIds]);

  return (
    <div className="space-y-8">
      <PageHero
        crumbs={[{ label: "Events" }]}
        eyebrow="Pride · circuit · beach"
        eyebrowIcon={Sparkles}
        title="Events by"
        highlight="region"
        description="Curated celebrations and parties around the world — attach them to a trip and they'll show up on your map."
      />

      <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/40 p-4 backdrop-blur md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Filter by trip
          </label>
          <select
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-sm"
          >
            <option value="all">All events</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} — {t.region}
              </option>
            ))}
          </select>
          {activeTrip && (
            <span className="text-xs text-muted-foreground">
              Showing events in <strong className="text-foreground">{activeTrip.region}</strong>
              {activeTrip.country ? `, ${activeTrip.country}` : ""} + attached
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {regions.map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`rounded-full border px-3 py-1 text-xs transition ${region === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card/40 text-muted-foreground hover:text-foreground"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-card/60" />
          ))}
        {filtered.map((e) => {
          const isAttached = attachedIds.includes(e.id);
          return (
            <article
              key={e.id}
              className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-primary">
                    <MapPin className="size-3" />
                    {e.region}
                  </span>
                  <span>
                    {e.city}, {e.country}
                  </span>
                  {e.tags && <span className="text-accent">· {e.tags}</span>}
                  {isAttached && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-accent">
                      <Check className="size-3" />
                      Attached
                    </span>
                  )}
                </div>
                <h3 className="mt-1.5 font-display text-xl">{e.name}</h3>
                {e.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5 text-sm font-medium">
                    <CalendarDays className="size-3.5 text-primary" />
                    {format(new Date(e.start_date), "MMM d")}
                    {e.end_date && e.end_date !== e.start_date
                      ? ` – ${format(new Date(e.end_date), "MMM d")}`
                      : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(e.start_date), "yyyy")}
                  </div>
                </div>
                {activeTrip && (
                  <button
                    onClick={() => attach.mutate({ eventId: e.id, attached: isAttached })}
                    disabled={attach.isPending}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition ${isAttached ? "border border-border bg-card text-muted-foreground hover:text-destructive" : "bg-primary text-primary-foreground hover:opacity-90"}`}
                    title={isAttached ? "Detach from trip" : `Attach to ${activeTrip.title}`}
                  >
                    {isAttached ? (
                      <>
                        <X className="size-3" />
                        Detach
                      </>
                    ) : (
                      <>
                        <Plus className="size-3" />
                        Attach
                      </>
                    )}
                  </button>
                )}
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>
            </article>
          );
        })}
        {filtered.length === 0 && !isLoading && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
            {activeTrip
              ? "No events match this trip yet. Try clearing the trip filter."
              : "Nothing in this region yet."}
          </div>
        )}
      </div>
    </div>
  );
}
