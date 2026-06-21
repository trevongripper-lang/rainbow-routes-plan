import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plane, BedDouble, Ticket, Wallet, Sparkles, CalendarDays, MapPin, ExternalLink, List, LayoutGrid, GripVertical, Trash2, CalendarClock } from "lucide-react";
import { addDays, differenceInCalendarDays, format, parseISO, isValid } from "date-fns";
import { TripEventsStrip } from "@/components/trip-events-strip";
import { track } from "@/lib/analytics";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { BulkConfirmDialog } from "@/components/bulk-confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { toast } from "sonner";

type OrderRow = { item_key: string; day_key: string; sort_order: number };

function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}
function parseDay(s: string | null | undefined) {
  if (!s) return null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
}
function dayKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

type Kind = "flight" | "stay" | "ticket" | "cost" | "event";
type Item = {
  id: string;
  kind: Kind;
  date: Date | null;        // primary anchor date
  endDate?: Date | null;    // for stays / multi-day events
  title: string;
  subtitle?: string;
  meta?: string;
  href?: string | null;
  matched?: boolean;
};

const kindMeta: Record<Kind, { label: string; Icon: typeof Plane; tone: string }> = {
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
  const [view, setView] = useState<"days" | "list">("days");

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

  const tripStart = parseDay(startDate);
  const tripEnd = parseDay(endDate);
  const qc = useQueryClient();

  const { data: orderRows = [] } = useQuery({
    queryKey: ["itinerary-order", destinationId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from("trip_itinerary_order" as any) as any)
        .select("item_key, day_key, sort_order")
        .eq("destination_id", destinationId);
      return (data ?? []) as OrderRow[];
    },
  });

  const saveOrder = useMutation({
    mutationFn: async (rows: { item_key: string; day_key: string; sort_order: number }[]) => {
      if (rows.length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("trip_itinerary_order" as any) as any).upsert(
        rows.map((r) => ({ destination_id: destinationId, ...r })),
        { onConflict: "destination_id,item_key" },
      );
      if (error) throw error;
      track("itinerary_reordered", { count: rows.length }, destinationId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["itinerary-order", destinationId] }),
  });

  const orderMap = useMemo(() => {
    const m = new Map<string, OrderRow>();
    for (const r of orderRows) m.set(r.item_key, r);
    return m;
  }, [orderRows]);

  const items: Item[] = useMemo(() => {
    const r = norm(region);
    const c = norm(country);
    const out: Item[] = [];

    for (const f of flights) {
      out.push({
        id: `f-${f.id}`,
        kind: "flight",
        date: parseDay(f.flight_date),
        title: `${f.airline ?? "Flight"} ${f.flight_number ?? ""}`.trim(),
        subtitle: [f.depart_airport, f.arrive_airport].filter(Boolean).join(" → ") || undefined,
        meta: [f.depart_time, f.arrive_time].filter(Boolean).join(" – "),
      });
    }
    for (const s of stays) {
      const ci = parseDay(s.check_in);
      const co = parseDay(s.check_out);
      const nights = ci && co ? Math.max(0, differenceInCalendarDays(co, ci)) : 0;
      out.push({
        id: `s-${s.id}`,
        kind: "stay",
        date: ci,
        endDate: co,
        title: s.title,
        subtitle: s.address ?? s.description ?? undefined,
        meta: nights > 0 ? `${nights} ${nights === 1 ? "night" : "nights"}` : undefined,
        href: s.url,
      });
    }
    for (const t of tickets) {
      out.push({
        id: `t-${t.id}`,
        kind: "ticket",
        date: null,
        title: t.name,
        subtitle: t.notes ?? undefined,
        meta: t.price_cents != null ? `${(t.price_cents / 100).toFixed(2)} ${t.currency}` : undefined,
        href: t.url,
      });
    }
    for (const c2 of costs) {
      out.push({
        id: `c-${c2.id}`,
        kind: "cost",
        date: parseDay((c2 as { cost_date?: string | null }).cost_date),
        title: c2.label,
        subtitle: c2.category,
        meta: `${(c2.amount_cents / 100).toFixed(2)} ${c2.currency}`,
      });
    }
    for (const e of attached) {
      const ds = parseDay(e.start_date);
      const de = parseDay(e.end_date);
      const matched = !!((r && norm(e.region) === r) || (c && norm(e.country) === c));
      out.push({
        id: `e-${e.id}`,
        kind: "event",
        date: ds,
        endDate: de,
        title: e.name,
        subtitle: [e.city, e.country].filter(Boolean).join(", "),
        meta: de && ds ? `${format(ds, "MMM d")} – ${format(de, "MMM d")}` : ds ? format(ds, "MMM d") : undefined,
        href: e.url,
        matched,
      });
    }

    return out;
  }, [flights, stays, tickets, costs, attached, region, country]);

  // Build day buckets across the trip window
  const days = useMemo(() => {
    if (!tripStart || !tripEnd) return [];
    const span = Math.max(0, differenceInCalendarDays(tripEnd, tripStart));
    return Array.from({ length: span + 1 }, (_, i) => addDays(tripStart, i));
  }, [tripStart, tripEnd]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const outside: Item[] = [];
    const undated: Item[] = [];

    const inWindow = (d: Date) => {
      if (!tripStart || !tripEnd) return true;
      return d >= tripStart && d <= addDays(tripEnd, 0);
    };

    for (const it of items) {
      if (!it.date) {
        undated.push(it);
        continue;
      }
      if (it.kind === "stay" && it.endDate) {
        // Span every covered day in the window
        const lastBand = it.endDate;
        let cur = it.date;
        let pushedAny = false;
        while (cur <= lastBand) {
          if (inWindow(cur)) {
            const k = dayKey(cur);
            (map.get(k) ?? map.set(k, []).get(k)!).push(it);
            pushedAny = true;
          }
          cur = addDays(cur, 1);
        }
        if (!pushedAny) outside.push(it);
        continue;
      }
      if (!inWindow(it.date)) {
        outside.push(it);
        continue;
      }
      const k = dayKey(it.date);
      (map.get(k) ?? map.set(k, []).get(k)!).push(it);
    }

    // Apply saved per-day ordering (stable fallback to insertion order).
    for (const [k, list] of map) {
      list.sort((a, b) => {
        const ao = orderMap.get(a.id);
        const bo = orderMap.get(b.id);
        const av = ao && ao.day_key === k ? ao.sort_order : Number.POSITIVE_INFINITY;
        const bv = bo && bo.day_key === k ? bo.sort_order : Number.POSITIVE_INFINITY;
        return av - bv;
      });
    }
    return { map, outside, undated };
  }, [items, tripStart, tripEnd, orderMap]);

  const range =
    startDate && endDate
      ? `${format(parseISO(startDate), "MMM d")} – ${format(parseISO(endDate), "MMM d, yyyy")}`
      : endDate
      ? `Ends ${format(parseISO(endDate), "MMM d, yyyy")}`
      : null;

  const hasDayView = days.length > 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" />
            <h2 className="font-display text-2xl">Itinerary</h2>
          </div>
          {hasDayView && (
            <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/40 p-0.5 text-xs">
              <button onClick={() => setView("days")} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${view === "days" ? "bg-primary/20 text-primary" : "text-muted-foreground"}`}>
                <LayoutGrid className="size-3.5" /> Days
              </button>
              <button onClick={() => setView("list")} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${view === "list" ? "bg-primary/20 text-primary" : "text-muted-foreground"}`}>
                <List className="size-3.5" /> List
              </button>
            </div>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasDayView ? "Day-by-day plan." : "Everything attached to this trip."}
          {range ? <span className="ml-2 text-primary">{range}</span> : null}
        </p>
      </section>

      <TripEventsStrip destinationId={destinationId} me={me} region={region} country={country} startDate={startDate} endDate={endDate} variant="full" />

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nothing on the timeline yet. Add flights, stays, tickets, costs, or attach events.
        </div>
      ) : hasDayView && view === "days" ? (
        <DayView
          days={days}
          byDay={byDay.map}
          undated={byDay.undated}
          outside={byDay.outside}
          onReorder={(dk, ordered) => {
            saveOrder.mutate(
              ordered.map((id, i) => ({ item_key: id, day_key: dk, sort_order: i })),
            );
          }}
        />
      ) : (
        <ListView items={items} />
      )}
    </div>
  );
}

function DayView({
  days,
  byDay,
  undated,
  outside,
  onReorder,
}: {
  days: Date[];
  byDay: Map<string, Item[]>;
  undated: Item[];
  outside: Item[];
  onReorder: (dayKey: string, orderedItemIds: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <ol className="relative space-y-4 border-l border-border/60 pl-6">
        {days.map((d, idx) => {
          const k = dayKey(d);
          const list = byDay.get(k) ?? [];
          return (
            <li key={k} className="relative">
              <span className="absolute -left-[31px] top-1 size-3 rounded-full border-2 border-primary bg-background" />
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Day {idx + 1}</span>
                <span className="text-sm font-medium">{format(d, "EEE, MMM d")}</span>
              </div>
              {list.length === 0 ? (
                <p className="mt-1 text-xs italic text-muted-foreground">Free day — what should we do?</p>
              ) : (
                <DayList items={list} dayKey={k} onReorder={onReorder} />
              )}
            </li>
          );
        })}
      </ol>

      {(undated.length > 0 || outside.length > 0) && (
        <section className="rounded-2xl border border-dashed border-border/60 bg-background/30 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Not on a trip day</h3>
          <ul className="mt-2 space-y-2">
            {[...outside, ...undated].map((it) => <ItemRow key={it.id} it={it} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function DayList({
  items,
  dayKey: dk,
  onReorder,
}: {
  items: Item[];
  dayKey: string;
  onReorder: (dayKey: string, orderedItemIds: string[]) => void;
}) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const ids = order ?? items.map((i) => i.id);
  // Resync when upstream items change (only if no active drag).
  if (!dragId && order && (order.length !== items.length || order.some((id, i) => items[i]?.id !== id))) {
    // Defer the reset so React doesn't warn about state updates during render.
    queueMicrotask(() => setOrder(null));
  }
  const byId = new Map(items.map((i) => [i.id, i]));

  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = [...ids];
    const fi = next.indexOf(from);
    const ti = next.indexOf(to);
    if (fi < 0 || ti < 0) return;
    next.splice(fi, 1);
    next.splice(ti, 0, from);
    setOrder(next);
  };

  return (
    <ul className="mt-2 space-y-2">
      {ids.map((id) => {
        const it = byId.get(id);
        if (!it) return null;
        return (
          <li
            key={`${id}-${dk}`}
            draggable
            onDragStart={(e) => {
              setDragId(id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overId !== id) setOverId(id);
            }}
            onDragLeave={() => { if (overId === id) setOverId(null); }}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData("text/plain") || dragId;
              if (from && from !== id) {
                move(from, id);
                const next = [...ids];
                const fi = next.indexOf(from); next.splice(fi, 1);
                const ti = next.indexOf(id); next.splice(ti, 0, from);
                onReorder(dk, next);
              }
              setDragId(null);
              setOverId(null);
            }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            className={`${dragId === id ? "opacity-50" : ""} ${overId === id && dragId !== id ? "ring-2 ring-primary/40 rounded-xl" : ""}`}
          >
            <ItemRow it={it} dayKey={dk} draggable />
          </li>
        );
      })}
    </ul>
  );
}

function ListView({ items }: { items: Item[] }) {
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.date && b.date) return a.date.getTime() - b.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
  }, [items]);
  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of sorted) {
      const key = i.date ? dayKey(i.date) : "undated";
      (map.get(key) ?? map.set(key, []).get(key)!).push(i);
    }
    return Array.from(map.entries());
  }, [sorted]);
  return (
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
              {list.map((it) => <ItemRow key={it.id} it={it} />)}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

function ItemRow({ it, dayKey: dk, draggable = false }: { it: Item; dayKey?: string; draggable?: boolean }) {
  const { Icon, label, tone } = kindMeta[it.kind];
  let bandLabel: string | null = null;
  if (it.kind === "stay" && dk && it.date && it.endDate) {
    if (dk === format(it.date, "yyyy-MM-dd")) bandLabel = "Check-in";
    else if (dk === format(it.endDate, "yyyy-MM-dd")) bandLabel = "Check-out";
    else bandLabel = "Staying";
  }
  const content = (
    <div className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${it.matched ? "border-primary/60 bg-primary/10" : "border-border/60 bg-card"}`}>
      {draggable && (
        <GripVertical
          className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing"
          aria-hidden
        />
      )}
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
          {bandLabel && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">{bandLabel}</span>
          )}
          <span className="font-medium">{it.title}</span>
          {it.href && (
            <a href={it.href} target="_blank" rel="noreferrer noopener" className="text-primary">
              <ExternalLink className="size-3.5" />
            </a>
          )}
          {it.matched && (
            <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">Matches this trip</span>
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
    </div>
  );
  // When draggable, the parent <DayList> already provides the <li> wrapper.
  if (draggable) return content;
  return <li>{content}</li>;
}
