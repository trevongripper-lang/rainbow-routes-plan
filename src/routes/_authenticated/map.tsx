import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { format, addMonths, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarDays, Map as MapIcon } from "lucide-react";
import { PageHero } from "@/components/page-hero";


type EventRow = {
  id: string;
  name: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string | null;
  url: string | null;
  latitude: number | null;
  longitude: number | null;
};

export const Route = createFileRoute("/_authenticated/map")({
  ssr: false,
  component: MapPage,
});

async function fetchEvents() {
  const { data, error } = await supabase.from("events").select("*").order("start_date");
  if (error) throw error;
  return data ?? [];
}

function MapPage() {
  const { data } = useQuery({ queryKey: ["events"], queryFn: fetchEvents });
  const today = new Date();
  const [from, setFrom] = useState(format(today, "yyyy-MM-dd"));
  const [to, setTo] = useState(format(addMonths(today, 6), "yyyy-MM-dd"));
  const [mounted, setMounted] = useState(false);
  const [EventsMap, setEventsMap] = useState<ComponentType<{ events: EventRow[] }> | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;

    import("@/components/EventsMap").then((mod) => {
      if (!cancelled) setEventsMap(() => mod.default);
    });

    return () => {
      cancelled = true;
    };
  }, [mounted]);

  const filtered = useMemo(() => {
    const f = parseISO(from);
    const t = parseISO(to);
    return (data ?? []).filter((e) => {
      if (e.latitude == null || e.longitude == null) return false;
      const s = parseISO(e.start_date);
      const en = e.end_date ? parseISO(e.end_date) : s;
      return en >= f && s <= t;
    });
  }, [data, from, to]);

  return (
    <div className="space-y-8">
      <PageHero
        crumbs={[{ label: "Map" }]}
        eyebrow="See it on the globe"
        eyebrowIcon={MapIcon}
        title="Events on the"
        highlight="map"
        description="Pick a date range and see what's happening where — perfect for stacking a trip around an event."
      />


      <div className="grid gap-3 rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="from" className="text-xs text-muted-foreground">From</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="to" className="text-xs text-muted-foreground">To</Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="rounded-xl bg-background/40 px-4 py-2 text-sm text-muted-foreground">
          <CalendarDays className="mr-1.5 inline size-4 text-primary" />
          {filtered.length} event{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card" style={{ height: "60vh", minHeight: 420 }}>
        {mounted && EventsMap ? (
          <EventsMap events={filtered as EventRow[]} />
        ) : (
          <div className="size-full animate-pulse bg-card/60" />
        )}
      </div>
    </div>
  );
}
