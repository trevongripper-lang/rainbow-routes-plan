import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plane, Sparkles, Trash2, Plus, Wand2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { lookupFlight } from "@/lib/flight-lookup.functions";
import { format, parseISO } from "date-fns";
import { AirportCombobox } from "@/components/airport-combobox";
import { findAirport } from "@/data/airports";
import { useMe } from "@/hooks/use-me";
import { cn } from "@/lib/utils";

type FlightForm = {
  passenger_name: string;
  airline: string;
  flight_number: string;
  flight_date: string;
  depart_airport: string;
  arrive_airport: string;
  depart_time: string;
  arrive_time: string;
  confirmation: string;
  notes: string;
};

const empty: FlightForm = {
  passenger_name: "",
  airline: "",
  flight_number: "",
  flight_date: "",
  depart_airport: "",
  arrive_airport: "",
  depart_time: "",
  arrive_time: "",
  confirmation: "",
  notes: "",
};

type Props = {
  destinationId: string;
  me: string;
  startDate?: string | null;
  endDate?: string | null;
};

export function FlightsTab({ destinationId, me, startDate, endDate }: Props) {
  const qc = useQueryClient();
  const lookup = useServerFn(lookupFlight);
  const { data: myProfile } = useMe();
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [form, setForm] = useState<FlightForm>(empty);
  const [showForm, setShowForm] = useState(false);
  const [showBookingDetails, setShowBookingDetails] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  const { data: flights = [] } = useQuery({
    queryKey: ["flights", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_flights")
        .select("*")
        .eq("destination_id", destinationId)
        .order("flight_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Auto-expand the form once flights exist or after a lookup.
  useEffect(() => {
    if (flights.length > 0) setShowForm(true);
  }, [flights.length]);

  // Prefill passenger name with current user's display name.
  useEffect(() => {
    setForm((f) => {
      if (f.passenger_name || !myProfile?.display_name) return f;
      return { ...f, passenger_name: myProfile.display_name };
    });
  }, [myProfile?.display_name]);

  // Smart date default: outbound on start_date, return on end_date if an
  // outbound flight already exists for the user on start_date.
  useEffect(() => {
    setForm((f) => {
      if (f.flight_date) return f;
      const mine = flights.filter((x) => x.user_id === me);
      const hasOutbound =
        startDate && mine.some((x) => x.flight_date === startDate);
      const next = hasOutbound ? endDate : startDate;
      return next ? { ...f, flight_date: next } : f;
    });
  }, [startDate, endDate, flights, me]);

  const canSave = form.passenger_name.trim().length > 0 &&
    (form.airline.trim().length > 0 || form.flight_number.trim().length > 0);

  const add = useMutation({
    mutationFn: async () => {
      if (!form.passenger_name.trim()) throw new Error("Passenger name is required");
      if (!form.airline.trim() && !form.flight_number.trim()) {
        throw new Error("Airline or flight number required");
      }
      // Duplicate check (warn, not block).
      const dupe = flights.find(
        (x) =>
          (x.flight_number ?? "").toUpperCase() === form.flight_number.trim().toUpperCase() &&
          x.flight_date === (form.flight_date || null) &&
          (x.passenger_name ?? "").toLowerCase() === form.passenger_name.trim().toLowerCase(),
      );
      if (dupe) {
        const ok = window.confirm(
          "A matching flight is already saved for this passenger. Save another?",
        );
        if (!ok) throw new Error("__cancelled__");
      }
      const { error } = await supabase.from("trip_flights").insert({
        destination_id: destinationId,
        user_id: me,
        passenger_name: form.passenger_name.trim(),
        airline: form.airline.trim() || null,
        flight_number: form.flight_number.trim() || null,
        flight_date: form.flight_date || null,
        depart_airport: form.depart_airport.trim() || null,
        arrive_airport: form.arrive_airport.trim() || null,
        depart_time: form.depart_time.trim() || null,
        arrive_time: form.arrive_time.trim() || null,
        confirmation: form.confirmation.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ ...empty, passenger_name: myProfile?.display_name ?? "" });
      setShowBookingDetails(false);
      qc.invalidateQueries({ queryKey: ["flights", destinationId] });
      toast.success("Flight added");
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "__cancelled__") return;
      toast.error(e instanceof Error ? e.message : "Failed");
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trip_flights").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flights", destinationId] });
      toast.success("Flight removed");
    },
  });

  async function runAiLookup() {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    try {
      const result = await lookup({ data: { query: aiQuery.trim() } });
      setForm((f) => ({
        ...f,
        // Never overwrite passenger from AI.
        airline: result.airline || f.airline,
        flight_number: result.flight_number || f.flight_number,
        flight_date: result.flight_date || f.flight_date,
        depart_airport: result.depart_airport || f.depart_airport,
        arrive_airport: result.arrive_airport || f.arrive_airport,
        depart_time: result.depart_time || f.depart_time,
        arrive_time: result.arrive_time || f.arrive_time,
        notes: result.notes
          ? `${f.notes ? f.notes + "\n" : ""}AI (${result.confidence}): ${result.notes}`
          : f.notes,
      }));
      setShowForm(true);
      toast.success(`Filled (confidence: ${result.confidence}). Double-check before saving.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI lookup failed");
    } finally {
      setAiLoading(false);
    }
  }

  // Group saved flights by date for the list.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof flights>();
    for (const f of flights) {
      const key = f.flight_date ?? "Unscheduled";
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [flights]);

  return (
    <div className="space-y-6">
      {/* AI Lookup Hero */}
      <section
        className="relative overflow-hidden rounded-3xl border-0 p-6 md:p-8"
        style={{
          background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(250 60% 45%) 100%)",
        }}
      >
        <div className="absolute -right-8 -top-8 size-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-10 -left-10 size-48 rounded-full bg-white/10 blur-2xl" />

        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
              <Wand2 className="size-5 text-white" />
            </div>
            <div>
              <h3 className="font-display text-xl text-white">AI Flight Lookup</h3>
              <p className="text-[13px] text-white/70">
                Just type anything — we'll figure out the rest.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Input
                ref={aiInputRef}
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                placeholder="e.g. UA 88 from EWR to LHR on Sep 12"
                maxLength={200}
                className="h-12 border-0 bg-white/15 pl-11 text-white placeholder:text-white/50 backdrop-blur-sm focus-visible:ring-white/40"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runAiLookup();
                  }
                }}
              />
              <Sparkles className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-white/60" />
            </div>
            <Button
              onClick={runAiLookup}
              disabled={aiLoading || !aiQuery.trim()}
              className="h-12 bg-white px-6 text-primary hover:bg-white/90"
            >
              {aiLoading ? "Looking..." : "Look up"}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "DL123 Aug 14 JFK-LAX",
              "BA 112 tomorrow LHR to JFK",
              "United 45 next Friday",
            ].map((example) => (
              <button
                key={example}
                onClick={() => {
                  setAiQuery(example);
                  aiInputRef.current?.focus();
                }}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                {example}
              </button>
            ))}
          </div>

          {!showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="mt-4 text-xs text-white/80 underline-offset-2 hover:text-white hover:underline"
            >
              Or enter flight details manually →
            </button>
          )}
        </div>
      </section>

      {showForm && (
        <section className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="flex items-center gap-2">
            <Plane className="size-5 text-primary" />
            <h3 className="font-display text-lg">Flight details</h3>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">
                Passenger <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.passenger_name}
                onChange={(e) => setForm({ ...form, passenger_name: e.target.value })}
                placeholder="Your name"
                maxLength={100}
                required
                aria-required="true"
              />
            </div>

            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={form.flight_date}
                onChange={(e) => setForm({ ...form, flight_date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Airline</Label>
                <Input
                  value={form.airline}
                  onChange={(e) => setForm({ ...form, airline: e.target.value })}
                  placeholder="Delta"
                  maxLength={80}
                />
              </div>
              <div>
                <Label className="text-xs">Flight #</Label>
                <Input
                  value={form.flight_number}
                  onChange={(e) => setForm({ ...form, flight_number: e.target.value })}
                  placeholder="DL123"
                  maxLength={20}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">From</Label>
              <AirportCombobox
                value={form.depart_airport}
                onChange={(v) => setForm({ ...form, depart_airport: v })}
                placeholder="Departure airport"
                ariaLabel="Departure airport"
              />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <AirportCombobox
                value={form.arrive_airport}
                onChange={(v) => setForm({ ...form, arrive_airport: v })}
                placeholder="Arrival airport"
                ariaLabel="Arrival airport"
              />
            </div>

            <div>
              <Label className="text-xs">Depart (local)</Label>
              <Input
                type="time"
                value={form.depart_time}
                onChange={(e) => setForm({ ...form, depart_time: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Arrive (local)</Label>
              <Input
                type="time"
                value={form.arrive_time}
                onChange={(e) => setForm({ ...form, arrive_time: e.target.value })}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowBookingDetails((s) => !s)}
            className="mt-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                showBookingDetails && "rotate-180",
              )}
            />
            {showBookingDetails ? "Hide" : "Add"} booking details (confirmation, notes)
          </button>

          {showBookingDetails && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Confirmation #</Label>
                <Input
                  value={form.confirmation}
                  onChange={(e) => setForm({ ...form, confirmation: e.target.value })}
                  placeholder="ABCDEF"
                  maxLength={40}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  maxLength={500}
                  placeholder="Seat 12A, meeting at gate..."
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setForm({ ...empty, passenger_name: myProfile?.display_name ?? "" })}
            >
              Clear
            </Button>
            <Button onClick={() => add.mutate()} disabled={add.isPending || !canSave}>
              <Plus className="mr-1 size-4" />
              Save flight
            </Button>
          </div>
        </section>
      )}

      {/* Saved flights, grouped by date */}
      {flights.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No flights logged yet.
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, items]) => (
            <div key={date}>
              <div className="sticky top-0 z-10 -mx-1 mb-2 bg-background/80 px-1 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                {date === "Unscheduled"
                  ? "Unscheduled"
                  : format(parseISO(date), "EEEE, MMM d, yyyy")}
              </div>
              <ul className="space-y-3">
                {items.map((f) => {
                  const dep = findAirport(f.depart_airport);
                  const arr = findAirport(f.arrive_airport);
                  return (
                    <li
                      key={f.id}
                      className="rounded-xl border border-border/60 bg-card p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Plane className="size-4 text-primary" />
                            <span className="font-medium">
                              {f.airline ?? "Flight"} {f.flight_number ?? ""}
                            </span>
                            {f.passenger_name && (
                              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                                {f.passenger_name}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            <span title={dep?.name}>
                              {f.depart_airport ?? "?"}
                              {dep ? ` · ${dep.city}` : ""}
                            </span>
                            {" → "}
                            <span title={arr?.name}>
                              {f.arrive_airport ?? "?"}
                              {arr ? ` · ${arr.city}` : ""}
                            </span>
                            {f.depart_time && (
                              <>
                                {" · "}
                                {f.depart_time}
                                {f.arrive_time ? `–${f.arrive_time}` : ""}
                              </>
                            )}
                          </div>
                          {f.confirmation && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Conf: <span className="font-mono">{f.confirmation}</span>
                            </div>
                          )}
                          {f.notes && (
                            <p className="mt-1 whitespace-pre-wrap text-sm">{f.notes}</p>
                          )}
                        </div>
                        {f.user_id === me && (
                          <button
                            onClick={() => setPendingDelete(f.id)}
                            aria-label="Remove flight"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this flight?</AlertDialogTitle>
            <AlertDialogDescription>
              Other trip members will no longer see it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) del.mutate(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
