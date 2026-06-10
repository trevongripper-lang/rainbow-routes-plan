import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { format, addMonths, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarDays, Map as MapIcon } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { useMe } from "@/hooks/use-me";

type EventRow = {
  id: string;
  name: string;
  region: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string | null;
  url: string | null;
  latitude: number | null;
  longitude: number | null;
};

type TripLite = { id: string; title: string; region: string; country: string | null };

export const Route = createFileRoute("/_authenticated/map")({
  ssr: false,
  component: MapPage,
});

async function fetchEvents() {
  const { data, error } = await supabase.from("events").select("*").order("start_date");
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

async function fetchMyTrips(userId: string): Promise<TripLite[]> {
  const { data, error } = await supabase
    .from("trip_members")
    .select("destination_id, destinations:destination_id(id, title, region, country, is_past)")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => r.destinations)
    .filter((d: { is_past?: boolean } | null): d is TripLite & { is_past: boolean } => !!d && !d.is_past);
}

async function fetchAttachments(tripId: string): Promise<string[]> {
  const { data, error } = await supabase.from("trip_events").select("event_id").eq("destination_id", tripId);
  if (error) throw error;
  return (data ?? []).map((r) => r.event_id);
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function MapPage() {
  const me = useMe();
  const { data } = useQuery({ queryKey: ["events"], queryFn: fetchEvents });
  const { data: trips = [] } = useQuery({
    queryKey: ["my-trips-lite", me.data?.id],
    queryFn: () => fetchMyTrips(me.data!.id),
    enabled: !!me.data?.id,
  });

  const today = new Date();
  const [from, setFrom] = useState(format(today, "yyyy-MM-dd"));
  const [to, setTo] = useState(format(addMonths(today, 6), "yyyy-MM-dd"));
  const [tripId, setTripId] = useState<string>("all");
  const [mounted, setMounted] = useState(false);
  const [EventsMap, setEventsMap] = useState<ComponentType<{ events: EventRow[] }> | null>(null);

  const activeTrip = trips.find((t) => t.id === tripId);

  const { data: attachedIds = [] } = useQuery({
    queryKey: ["trip-events", tripId],
    queryFn: () => fetchAttachments(tripId),
    enabled: tripId !== "all",
  });

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    import("@/components/EventsMap").then((mod) => {
      if (!cancelled) setEventsMap(() => mod.default);
    });
    return () => { cancelled = true; };
  }, [mounted]);

  const filtered = useMemo(() => {
    const f = parseISO(from);
    const t = parseISO(to);
    let list = (data ?? []).filter((e) => {
      if (e.latitude == null || e.longitude == null) return false;
      const s = parseISO(e.start_date);
      const en = e.end_date ? parseISO(e.end_date) : s;
      return en >= f && s <= t;
    });
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
    return list;
  }, [data, from, to, activeTrip, attachedIds]);

  return (
    <div className="space-y-8">
      <PageHero
        crumbs={[{ label: "Map" }]}
        eyebrow="See it on the globe"
        eyebrowIcon={MapIcon}
        title="Events on the"
        highlight="map"
        description="Pick a date range — or a trip — and see what's happening where."
      />

      <div className="grid gap-3 rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="from" className="text-xs text-muted-foreground">From</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="to" className="text-xs text-muted-foreground">To</Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="trip" className="text-xs text-muted-foreground">Trip</Label>
          <select
            id="trip"
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All trips</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>{t.title} — {t.region}</option>
            ))}
          </select>
        </div>
        <div className="rounded-xl bg-background/40 px-4 py-2 text-sm text-muted-foreground">
          <CalendarDays className="mr-1.5 inline size-4 text-primary" />
          {filtered.length} event{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card" style={{ height: "60vh", minHeight: 420 }}>
        {mounted && EventsMap ? (
          <EventsMap events={filtered as EventRow[]} />
        ) : (
          <div className="size-full animate-pulse bg-card/60" />
        )}
      </div>
    </div>
  );
}
