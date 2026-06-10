import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plane, BedDouble, Ticket, Wallet, Sparkles, CalendarDays, MapPin, ExternalLink } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { TripEventsStrip } from "@/components/trip-events-strip";

function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

type Item = {
  id: string;
  date: Date | null;
  kind: "flight" | "stay" | "ticket" | "cost" | "event";
  title: string;
  subtitle?: string;
  meta?: string;
  href?: string | null;
  matched?: boolean;
};

const kindMeta: Record<Item["kind"], { label: string; Icon: typeof Plane; tone: string }> = {
  flight: { label: "Flight", Icon: Plane, tone: "text-sky-300" },
  stay: { label: "Stay", Icon: BedDouble, tone: "text-emerald-300" },
  ticket: { label: "Ticket", Icon: Ticket, tone: "text-amber-300" },
  cost: { label: "Cost", Icon: Wallet, tone: "text-rose-300" },
  event: { label: "Event", Icon: Sparkles, tone: "text-primary" },
};

export function ItineraryTab({
  destinationId,
  region,
  country,
  startDate,
  endDate,
  me,
}: {
  destinationId: string;
  region: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  me: string;
}) {
  const { data: flights = [] } = useQuery({
    queryKey: ["flights", destinationId],
    queryFn: async () => {
      const { data } = await supabase.from("trip_flights").select("*").eq("destination_id", destinationId);
      return data ?? [];
    },
  });
  const { data: stays = [] } = useQuery({
    queryKey: ["stays", destinationId],
    queryFn: async () => {
      const { data } = await supabase.from("trip_stays").select("*").eq("destination_id", destinationId);
      return data ?? [];
    },
  });
  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets", destinationId],
    queryFn: async () => {
      const { data } = await supabase.from("trip_tickets").select("*").eq("destination_id", destinationId);
      return data ?? [];
    },
  });
  const { data: costs = [] } = useQuery({
    queryKey: ["costs", destinationId],
    queryFn: async () => {
      const { data } = await supabase.from("trip_costs").select("*").eq("destination_id", destinationId);
      return data ?? [];
    },
  });
  const { data: attached = [] } = useQuery({
    queryKey: ["trip-events-full", destinationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("trip_events")
        .select("event_id, events:event_id(*)")
        .eq("destination_id", destinationId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => r.events).filter(Boolean);
    },
  });

  const items: Item[] = useMemo(() => {
    const r = norm(region);
    const c = norm(country);
    const out: Item[] = [];

    for (const f of flights) {
      const d = f.flight_date ? parseISO(f.flight_date) : null;
      out.push({
        id: `f-${f.id}`,
        date: d && isValid(d) ? d : null,
        kind: "flight",
        title: `${f.airline ?? "Flight"} ${f.flight_number ?? ""}`.trim(),
        subtitle: [f.depart_airport, f.arrive_airport].filter(Boolean).join(" → ") || undefined,
        meta: [f.depart_time, f.arrive_time].filter(Boolean).join(" – "),
      });
    }
    for (const s of stays) {
      out.push({
        id: `s-${s.id}`,
        date: null,
        kind: "stay",
        title: s.title,
        subtitle: s.description ?? undefined,
        href: s.url,
      });
    }
    for (const t of tickets) {
      out.push({
        id: `t-${t.id}`,
        date: null,
        kind: "ticket",
        title: t.name,
        subtitle: t.notes ?? undefined,
        meta: t.price_cents != null ? `${(t.price_cents / 100).toFixed(2)} ${t.currency}` : undefined,
        href: t.url,
      });
    }
    for (const c2 of costs) {
      out.push({
        id: `c-${c2.id}`,
        date: null,
        kind: "cost",
        title: c2.label,
        subtitle: c2.category,
        meta: `${(c2.amount_cents / 100).toFixed(2)} ${c2.currency}`,
      });
    }
    for (const e of attached) {
      const d = e.start_date ? parseISO(e.start_date) : null;
      const matched = (r && norm(e.region) === r) || (c && norm(e.country) === c);
      out.push({
        id: `e-${e.id}`,
        date: d && isValid(d) ? d : null,
        kind: "event",
        title: e.name,
        subtitle: [e.city, e.country].filter(Boolean).join(", "),
        meta: e.end_date ? `${format(d!, "MMM d")} – ${format(parseISO(e.end_date), "MMM d")}` : d ? format(d, "MMM d") : undefined,
        href: e.url,
        matched,
      });
    }

    return out.sort((a, b) => {
      if (a.date && b.date) return a.date.getTime() - b.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
  }, [flights, stays, tickets, costs, attached, region, country]);

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of items) {
      const key = i.date ? format(i.date, "yyyy-MM-dd") : "undated";
      const arr = map.get(key) ?? [];
      arr.push(i);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  const range =
    startDate && endDate
      ? `${format(parseISO(startDate), "MMM d")} – ${format(parseISO(endDate), "MMM d, yyyy")}`
      : endDate
      ? `Ends ${format(parseISO(endDate), "MMM d, yyyy")}`
      : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-5 text-primary" />
          <h2 className="font-display text-2xl">Itinerary</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything attached to this trip, in chronological order.
          {range ? <span className="ml-2 text-primary">{range}</span> : null}
        </p>
      </section>

      <TripEventsStrip destinationId={destinationId} me={me} region={region} country={country} variant="full" />

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nothing on the timeline yet. Add flights, stays, tickets, costs, or attach events.
        </div>
      ) : (
        <ol className="relative space-y-6 border-l border-border/60 pl-6">
          {grouped.map(([key, list]) => {
            const dated = key !== "undated";
            return (
              <li key={key} className="relative">
                <span className="absolute -left-[31px] top-1 size-3 rounded-full border-2 border-primary bg-background" />
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {dated ? format(parseISO(key), "EEE, MMM d, yyyy") : "Undated"}
                </div>
                <ul className="mt-2 space-y-2">
                  {list.map((it) => {
                    const { Icon, label, tone } = kindMeta[it.kind];
                    return (
                      <li
                        key={it.id}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${
                          it.matched
                            ? "border-primary/60 bg-primary/10"
                            : "border-border/60 bg-card"
                        }`}
                      >
                        <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {label}
                            </span>
                            <span className="font-medium">{it.title}</span>
                            {it.href && (
                              <a href={it.href} target="_blank" rel="noreferrer noopener" className="text-primary">
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                            {it.matched && (
                              <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                Matches this trip
                              </span>
                            )}
                          </div>
                          {it.subtitle && (
                            <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                              {it.kind === "event" || it.kind === "stay" ? <MapPin className="size-3" /> : null}
                              <span className="truncate">{it.subtitle}</span>
                            </div>
                          )}
                          {it.meta && <div className="mt-0.5 text-xs text-muted-foreground">{it.meta}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
