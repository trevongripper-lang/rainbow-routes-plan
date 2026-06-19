import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, MapPin, ExternalLink, Sparkles, X, Plus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

type EventRow = {
  id: string;
  name: string;
  region: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string | null;
  url: string | null;
  tags: string | null;
};

export function TripEventsStrip({
  destinationId,
  me,
  region,
  country,
  startDate = null,
  endDate = null,
  bufferDays = 3,
  variant = "compact",
}: {
  destinationId: string;
  me: string;
  region: string | null;
  country: string | null;
  startDate?: string | null;
  endDate?: string | null;
  bufferDays?: number;
  variant?: "compact" | "full";
}) {
  const qc = useQueryClient();
  const [buffer, setBuffer] = useState<number>(bufferDays);
  const [showOutside, setShowOutside] = useState<boolean>(false);

  const { data: allEvents = [] } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").order("start_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const { data: attachedIds = [] } = useQuery({
    queryKey: ["trip-events", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("trip_events").select("event_id").eq("destination_id", destinationId);
      if (error) throw error;
      return (data ?? []).map((r) => r.event_id);
    },
  });

  const attached = useMemo(
    () => allEvents.filter((e) => attachedIds.includes(e.id)),
    [allEvents, attachedIds],
  );

  const dateState = useMemo(() => {
    const hasStart = !!startDate;
    const hasEnd = !!endDate;
    if (!hasStart && !hasEnd) return { kind: "none" as const };
    if (!hasStart || !hasEnd) {
      return { kind: "incomplete" as const, message: `Add a ${!hasStart ? "start" : "end"} date to match events to this trip.` };
    }
    const s = new Date(startDate as string).getTime();
    const e = new Date(endDate as string).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) {
      return { kind: "invalid" as const, message: "Trip dates aren't valid — fix them to match events." };
    }
    if (e < s) {
      return { kind: "invalid" as const, message: "Trip end date is before the start date." };
    }
    return { kind: "ok" as const, s, e };
  }, [startDate, endDate]);

  const hasDates = dateState.kind === "ok";
  const windowMs = useMemo(() => {
    if (dateState.kind !== "ok") return null;
    const bufMs = Math.max(0, buffer) * 86400000;
    return { s: dateState.s - bufMs, e: dateState.e + bufMs + 86399999 };
  }, [dateState, buffer]);

  const matches = useMemo(() => {
    const r = norm(region);
    const c = norm(country);
    return allEvents.filter((e) => {
      if (attachedIds.includes(e.id)) return false;
      const placeOk = (r && norm(e.region) === r) || (c && norm(e.country) === c);
      if (!placeOk) return false;
      if (!windowMs || showOutside) return true;
      const es = new Date(e.start_date).getTime();
      const ee = e.end_date ? new Date(e.end_date).getTime() + 86399999 : es + 86399999;
      return ee >= windowMs.s && es <= windowMs.e;
    });
  }, [allEvents, attachedIds, region, country, windowMs, showOutside]);

  const toggle = useMutation({
    mutationFn: async ({ eventId, attached }: { eventId: string; attached: boolean }) => {
      if (attached) {
        const { error } = await supabase.from("trip_events").delete().eq("destination_id", destinationId).eq("event_id", eventId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("trip_events").insert({ destination_id: destinationId, event_id: eventId, added_by: me });
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["trip-events", destinationId] });
      toast.success(vars.attached ? "Detached" : "Attached");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const dateProblem = dateState.kind === "incomplete" || dateState.kind === "invalid" ? dateState.message : null;
  if (attached.length === 0 && matches.length === 0 && !hasDates && !dateProblem) return null;

  const list = variant === "compact" ? [...attached, ...matches.slice(0, 4)] : [...attached, ...matches];

  return (
    <section className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="font-display text-base">Events near this trip</h3>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          {hasDates && (
            <>
              <label className="flex items-center gap-1.5">
                <span>± days</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={buffer}
                  onChange={(e) => setBuffer(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                  disabled={showOutside}
                  className="w-12 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-foreground disabled:opacity-50"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowOutside((v) => !v)}
                className={`rounded-full border px-2 py-0.5 transition ${
                  showOutside
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border/60 hover:border-primary/40"
                }`}
                aria-pressed={showOutside}
              >
                {showOutside ? "Showing all dates" : "See events outside my dates"}
              </button>
            </>
          )}
          <span>{attached.length} attached · {matches.length} suggested</span>
        </div>
      </div>
      {dateProblem && (
        <p
          role="status"
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            dateState.kind === "invalid"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border/60 bg-background/40 text-muted-foreground"
          }`}
        >
          {dateProblem} Showing location matches only.
        </p>
      )}
      {hasDates && matches.length === 0 && attached.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">No events overlap this trip's window. Widen the ± buffer to see more.</p>
      )}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {list.map((e) => {
          const isAttached = attachedIds.includes(e.id);
          return (
            <li
              key={e.id}
              className={`group rounded-xl border p-3 text-sm transition ${
                isAttached
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/60 bg-background/40 hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{e.name}</span>
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noreferrer noopener" className="text-primary">
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3" />
                      {format(new Date(e.start_date), "MMM d")}
                      {e.end_date ? `–${format(new Date(e.end_date), "MMM d")}` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {e.city}
                    </span>
                    {isAttached ? (
                      <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        Attached
                      </span>
                    ) : (
                      <span className="rounded-full bg-accent/30 px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                        Matches trip
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => toggle.mutate({ eventId: e.id, attached: isAttached })}
                  disabled={toggle.isPending}
                  className={`shrink-0 rounded-full border p-1.5 transition ${
                    isAttached
                      ? "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                      : "border-primary/40 text-primary hover:bg-primary/15"
                  }`}
                  aria-label={isAttached ? "Detach" : "Attach"}
                >
                  {isAttached ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
