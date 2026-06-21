import { useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { CheckCircle2, Circle, AlertCircle, ChevronRight, MapPin, Calendar, BedDouble, Plane, Ticket, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { netForUser, formatCents, type CostRow, type SettlementRow } from "@/lib/trip-balances";
import { track } from "@/lib/analytics";

type Status = "done" | "partial" | "todo";

type Props = {
  destinationId: string;
  me: string;
  startDate: string | null;
  endDate: string | null;
  headcountFallback: number;
  defaultCurrency: string;
};

export function PlanningProgress({ destinationId, me, startDate, endDate, headcountFallback, defaultCurrency }: Props) {
  const results = useQueries({
    queries: [
      {
        queryKey: ["trip-members", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase.from("trip_members").select("user_id, role").eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ["stays", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase.from("trip_stays").select("id").eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ["flights", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase.from("trip_flights").select("id, confirmation").eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ["tickets", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase.from("trip_tickets").select("id").eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ["costs", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase.from("trip_costs").select("*").eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ["settlements", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase.from("trip_settlements").select("from_user, to_user, amount_cents, currency").eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
    ],
  });

  const [membersQ, staysQ, flightsQ, ticketsQ, costsQ, settlementsQ] = results;
  const isLoading = results.some((r) => r.isLoading);

  const members = (membersQ.data ?? []) as { user_id: string; role: string }[];
  const stays = (staysQ.data ?? []) as { id: string }[];
  const flights = (flightsQ.data ?? []) as { id: string; confirmation: string | null }[];
  const tickets = (ticketsQ.data ?? []) as { id: string }[];
  const costs = (costsQ.data ?? []) as CostRow[];
  const settlements = (settlementsQ.data ?? []) as SettlementRow[];

  const memberCount = Math.max(members.length, headcountFallback, 1);
  const flightsBooked = flights.filter((f) => f.confirmation && f.confirmation.trim().length > 0).length;

  const memberIds = useMemo(() => {
    const ids = new Set<string>(members.map((m) => m.user_id));
    for (const c of costs) {
      ids.add(c.user_id);
      if (c.paid_by) ids.add(c.paid_by);
    }
    return Array.from(ids);
  }, [members, costs]);

  const myNetCents = useMemo(() => netForUser(costs, settlements, memberIds, me), [costs, settlements, memberIds, me]);
  const balanceCurrency = costs.find((c) => c.is_shared)?.currency ?? costs[0]?.currency ?? defaultCurrency;

  useEffect(() => {
    if (!isLoading) track("planning_progress_view", {}, destinationId);
  }, [isLoading, destinationId]);

  const datesDone = !!(startDate && endDate);
  const datesSummary = datesDone ? `${startDate} → ${endDate}` : "Not set";

  const staysStatus: Status = stays.length > 0 ? "done" : "todo";
  const staysSummary = stays.length > 0 ? `Booked · ${stays.length} ${stays.length === 1 ? "place" : "places"}` : "Not booked";

  const flightsStatus: Status = flightsBooked === 0 ? "todo" : flightsBooked >= memberCount ? "done" : "partial";
  const flightsSummary = `${flightsBooked} / ${memberCount} booked`;

  const ticketsStatus: Status = tickets.length > 0 ? "done" : "todo";
  const ticketsSummary = tickets.length > 0 ? `${tickets.length} added` : "None yet";

  let balanceStatus: Status = "done";
  let balanceSummary = "Settled";
  if (Math.abs(myNetCents) >= 1) {
    balanceStatus = "partial";
    balanceSummary = myNetCents > 0
      ? `You're owed ${formatCents(myNetCents, balanceCurrency)}`
      : `You owe ${formatCents(myNetCents, balanceCurrency)}`;
  } else if (costs.length === 0) {
    balanceStatus = "todo";
    balanceSummary = "No costs yet";
  }

  const rows: Array<{ key: string; icon: typeof MapPin; label: string; summary: string; status: Status; tab: string; onClick?: () => void }> = [
    { key: "destination", icon: MapPin, label: "Destination", summary: "Decided", status: "done", tab: "overview" },
    { key: "dates", icon: Calendar, label: "Dates", summary: datesSummary, status: datesDone ? "done" : "todo", tab: "overview" },
    { key: "stay", icon: BedDouble, label: "Stay", summary: staysSummary, status: staysStatus, tab: "stays" },
    { key: "flights", icon: Plane, label: "Flights", summary: flightsSummary, status: flightsStatus, tab: "flights" },
    { key: "activities", icon: Ticket, label: "Activities", summary: ticketsSummary, status: ticketsStatus, tab: "tickets" },
    { key: "balances", icon: Wallet, label: "Balances", summary: balanceSummary, status: balanceStatus, tab: "costs" },
  ];

  const doneCount = rows.filter((r) => r.status === "done").length;

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">Planning progress</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{doneCount} / {rows.length} done</span>
      </div>

      <ul className="mt-5 divide-y divide-border/60">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <div className="size-6 animate-pulse rounded-full bg-muted" />
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="ml-auto h-4 w-32 animate-pulse rounded bg-muted" />
              </li>
            ))
          : rows.map((row) => {
              const Icon = row.icon;
              const StatusIcon = row.status === "done" ? CheckCircle2 : row.status === "partial" ? AlertCircle : Circle;
              const statusClass =
                row.status === "done"
                  ? "text-primary"
                  : row.status === "partial"
                  ? "text-amber-500"
                  : "text-muted-foreground";
              return (
                <li key={row.key} className="group flex items-center gap-3 py-3">
                  <StatusIcon className={`size-5 shrink-0 ${statusClass}`} />
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{row.label}</span>
                      <span className="truncate text-sm text-muted-foreground">{row.summary}</span>
                    </div>
                  </div>
                  <Link
                    to="/trips/$id"
                    params={{ id: destinationId }}
                    search={{ tab: row.tab }}
                    onClick={() => track("planning_progress_click", { section: row.key }, destinationId)}
                    className="inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-xs text-muted-foreground transition hover:border-border hover:text-foreground"
                  >
                    Go <ChevronRight className="size-3.5" />
                  </Link>
                </li>
              );
            })}
      </ul>
    </section>
  );
}
