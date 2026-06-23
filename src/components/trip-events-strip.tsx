import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarDays,
  MapPin,
  ExternalLink,
  Sparkles,
  X,
  Plus,
  BadgeCheck,
  Flag,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { geocodeDestination } from "@/lib/geocode.functions";

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
  latitude: number | null;
  longitude: number | null;
  distance_miles: number | null;
  verified?: boolean | null;
  match_score?: number | null;
};

const REPORT_REASONS = [
  { value: "not_relevant", label: "Not relevant to this trip" },
  { value: "wrong_date", label: "Wrong date" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "incorrect_info", label: "Incorrect info" },
  { value: "duplicate", label: "Duplicate of another event" },
  { value: "other", label: "Other" },
] as const;

export function TripEventsStrip({
  destinationId,
  me,
  region,
  country,
  startDate = null,
  endDate = null,
  bufferDays = 30,
  radiusMiles = 100,
  variant = "compact",
}: {
  destinationId: string;
  me: string;
  region: string | null;
  country: string | null;
  startDate?: string | null;
  endDate?: string | null;
  bufferDays?: number;
  radiusMiles?: number;
  variant?: "compact" | "full";
}) {
  const qc = useQueryClient();
  const [buffer, setBuffer] = useState<number>(bufferDays);
  const [radius, setRadius] = useState<number>(radiusMiles);
  const [showOutside, setShowOutside] = useState<boolean>(false);
  const geocode = useServerFn(geocodeDestination);

  const dateState = useMemo(() => {
    const hasStart = !!startDate;
    const hasEnd = !!endDate;
    if (!hasStart && !hasEnd) return { kind: "none" as const };
    if (!hasStart || !hasEnd)
      return {
        kind: "incomplete" as const,
        message: `Add a ${!hasStart ? "start" : "end"} date to match events to this trip.`,
      };
    const s = new Date(startDate as string).getTime();
    const e = new Date(endDate as string).getTime();
    if (Number.isNaN(s) || Number.isNaN(e))
      return {
        kind: "invalid" as const,
        message: "Trip dates aren't valid — fix them to match events.",
      };
    if (e < s)
      return { kind: "invalid" as const, message: "Trip end date is before the start date." };
    return { kind: "ok" as const };
  }, [startDate, endDate]);
  const hasDates = dateState.kind === "ok";

  // Lazy backfill of coordinates so distance filtering works
  useEffect(() => {
    if (!region && !country) return;
    let cancelled = false;
    (async () => {
      const { data: d } = await supabase
        .from("destinations")
        .select("latitude,longitude")
        .eq("id", destinationId)
        .maybeSingle();
      if (cancelled || !d || d.latitude != null) return;
      try {
        await geocode({ data: { destinationId } });
        qc.invalidateQueries({ queryKey: ["match-events", destinationId] });
      } catch {
        // swallow — falls back to country/region match
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destinationId, region, country, geocode, qc]);

  const { data: matches = [] } = useQuery({
    queryKey: ["match-events", destinationId, radius, buffer, showOutside],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("match_trip_events", {
        _dest: destinationId,
        _radius_miles: radius,
        _buffer_days: buffer,
        _include_outside_dates: showOutside,
      });
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const { data: attachedIds = [] } = useQuery({
    queryKey: ["trip-events", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_events")
        .select("event_id")
        .eq("destination_id", destinationId);
      if (error) throw error;
      return (data ?? []).map((r) => r.event_id);
    },
  });

  const { data: attachedRows = [] } = useQuery({
    enabled: attachedIds.length > 0,
    queryKey: ["attached-events", destinationId, attachedIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").in("id", attachedIds);
      if (error) throw error;
      return (data ?? []).map((e) => ({ ...e, distance_miles: null }) as EventRow);
    },
  });

  const suggested = useMemo(
    () => matches.filter((e) => !attachedIds.includes(e.id)),
    [matches, attachedIds],
  );

  const toggle = useMutation({
    mutationFn: async ({ eventId, attached }: { eventId: string; attached: boolean }) => {
      if (attached) {
        const { error } = await supabase
          .from("trip_events")
          .delete()
          .eq("destination_id", destinationId)
          .eq("event_id", eventId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("trip_events")
          .insert({ destination_id: destinationId, event_id: eventId, added_by: me });
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["trip-events", destinationId] });
      toast.success(vars.attached ? "Detached" : "Attached");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const dateProblem =
    dateState.kind === "incomplete" || dateState.kind === "invalid" ? dateState.message : null;
  if (attachedRows.length === 0 && suggested.length === 0 && !hasDates && !dateProblem) return null;

  const list =
    variant === "compact"
      ? [...attachedRows, ...suggested.slice(0, 4)]
      : [...attachedRows, ...suggested];

  return (
    <section className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="font-display text-base">Events near this trip</h3>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <span>Within</span>
            <input
              type="number"
              min={10}
              max={1000}
              step={10}
              value={radius}
              onChange={(e) =>
                setRadius(Math.max(10, Math.min(1000, Number(e.target.value) || 100)))
              }
              className="w-16 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-foreground"
            />
            <span>mi</span>
          </label>
          {hasDates && (
            <>
              <label className="flex items-center gap-1.5">
                <span>± days</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={buffer}
                  onChange={(e) =>
                    setBuffer(Math.max(0, Math.min(120, Number(e.target.value) || 0)))
                  }
                  disabled={showOutside}
                  className="w-14 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-foreground disabled:opacity-50"
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
                {showOutside ? "Showing all dates" : "See outside my dates"}
              </button>
            </>
          )}
          <span className="whitespace-nowrap">
            {attachedRows.length} attached · {suggested.length} suggested
          </span>
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
          {dateProblem} Showing nearby matches only.
        </p>
      )}
      {hasDates && suggested.length === 0 && attachedRows.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No events within {radius} mi and ±{buffer} days. Widen the radius or tap "See outside my
          dates".
        </p>
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
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary"
                      >
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
                      {e.distance_miles != null && (
                        <span className="opacity-70">· {e.distance_miles} mi</span>
                      )}
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
