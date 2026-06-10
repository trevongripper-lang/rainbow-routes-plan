import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plane, Sparkles, Trash2, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { lookupFlight } from "@/lib/flight-lookup.functions";
import { format, parseISO } from "date-fns";

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

export function FlightsTab({ destinationId, me }: { destinationId: string; me: string }) {
  const qc = useQueryClient();
  const lookup = useServerFn(lookupFlight);
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [form, setForm] = useState<FlightForm>(empty);
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

  const add = useMutation({
    mutationFn: async () => {
      if (!form.airline.trim() && !form.flight_number.trim()) {
        throw new Error("Airline or flight number required");
      }
      const { error } = await supabase.from("trip_flights").insert({
        destination_id: destinationId,
        user_id: me,
        passenger_name: form.passenger_name.trim() || null,
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
      setForm(empty);
      qc.invalidateQueries({ queryKey: ["flights", destinationId] });
      toast.success("Flight added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trip_flights").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flights", destinationId] }),
  });

  async function runAiLookup() {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    try {
      const result = await lookup({ data: { query: aiQuery.trim() } });
      setForm((f) => ({
        ...f,
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
      toast.success(`Filled (confidence: ${result.confidence}). Double-check before saving.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI lookup failed");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Prominent AI Lookup Hero Card */}
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
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2">
          <Plane className="size-5 text-primary" />
          <h3 className="font-display text-lg">Flight details</h3>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Passenger</Label>
            <Input value={form.passenger_name} onChange={(e) => setForm({ ...form, passenger_name: e.target.value })} placeholder="Your name" maxLength={100} />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={form.flight_date} onChange={(e) => setForm({ ...form, flight_date: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Airline</Label>
            <Input value={form.airline} onChange={(e) => setForm({ ...form, airline: e.target.value })} placeholder="Delta" maxLength={80} />
          </div>
          <div>
            <Label className="text-xs">Flight #</Label>
            <Input value={form.flight_number} onChange={(e) => setForm({ ...form, flight_number: e.target.value })} placeholder="DL123" maxLength={20} />
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input value={form.depart_airport} onChange={(e) => setForm({ ...form, depart_airport: e.target.value })} placeholder="JFK" maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input value={form.arrive_airport} onChange={(e) => setForm({ ...form, arrive_airport: e.target.value })} placeholder="LAX" maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Depart time</Label>
            <Input type="time" value={form.depart_time} onChange={(e) => setForm({ ...form, depart_time: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Arrive time</Label>
            <Input type="time" value={form.arrive_time} onChange={(e) => setForm({ ...form, arrive_time: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Confirmation #</Label>
            <Input value={form.confirmation} onChange={(e) => setForm({ ...form, confirmation: e.target.value })} placeholder="ABCDEF" maxLength={40} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={500} placeholder="Seat 12A, meeting at gate..." />
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setForm(empty)}>Clear</Button>
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            <Plus className="mr-1 size-4" />Save flight
          </Button>
        </div>
      </section>

      <ul className="space-y-3">
        {flights.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No flights logged yet.
          </li>
        )}
        {flights.map((f) => (
          <li key={f.id} className="rounded-xl border border-border/60 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Plane className="size-4 text-primary" />
                  <span className="font-medium">
                    {f.airline ?? "Flight"} {f.flight_number ?? ""}
                  </span>
                  {f.passenger_name && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{f.passenger_name}</span>
                  )}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {f.depart_airport ?? "?"} → {f.arrive_airport ?? "?"}
                  {f.flight_date && <> · {format(parseISO(f.flight_date), "MMM d, yyyy")}</>}
                  {f.depart_time && <> · {f.depart_time}{f.arrive_time ? `–${f.arrive_time}` : ""}</>}
                </div>
                {f.confirmation && (
                  <div className="mt-1 text-xs text-muted-foreground">Conf: <span className="font-mono">{f.confirmation}</span></div>
                )}
                {f.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{f.notes}</p>}
              </div>
              {f.user_id === me && (
                <button onClick={() => del.mutate(f.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
