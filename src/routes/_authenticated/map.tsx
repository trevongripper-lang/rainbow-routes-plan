import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { format, addMonths, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarDays } from "lucide-react";

const EventsMap = lazy(() => import("@/components/EventsMap"));

export const Route = createFileRoute("/_authenticated/map")({
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
  useEffect(() => { setMounted(true); }, []);

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
    <div>
      <h1 className="font-display text-3xl md:text-4xl">Events on the map</h1>
      <p className="mt-1 text-sm text-muted-foreground">Pick a date range and see what's happening where.</p>

      <div className="mt-6 grid gap-3 rounded-2xl border border-border/60 bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
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
        {mounted ? (
          <Suspense fallback={<div className="size-full animate-pulse bg-card/60" />}>
            <EventsMap events={filtered as any} />
          </Suspense>
        ) : (
          <div className="size-full animate-pulse bg-card/60" />
        )}
      </div>
    </div>
  );
}
