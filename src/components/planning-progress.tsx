import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { netForUser, type CostRow, type SettlementRow } from "@/lib/trip-balances";
import {
  computePlanningItems,
  computeWeightedScore,
  pendingPlanningItems,
  nextBestAction,
  type PlanningItem,
} from "@/lib/planning-progress";
import { track } from "@/lib/analytics";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, Circle, AlertCircle } from "lucide-react";

type Props = {
  destinationId: string;
  me: string;
  startDate: string | null;
  endDate: string | null;
  headcountFallback: number;
  defaultCurrency: string;
};

export function PlanningProgress({ destinationId, me, startDate, endDate, headcountFallback }: Props) {
  const results = useQueries({
    queries: [
      { queryKey: ["trip-members", destinationId], queryFn: async () => {
          const { data, error } = await supabase.from("trip_members").select("user_id, role").eq("destination_id", destinationId);
          if (error) throw error; return data ?? [];
        } },
      { queryKey: ["stays", destinationId], queryFn: async () => {
          const { data, error } = await supabase.from("trip_stays").select("id").eq("destination_id", destinationId);
          if (error) throw error; return data ?? [];
        } },
      { queryKey: ["flights", destinationId], queryFn: async () => {
          const { data, error } = await supabase.from("trip_flights").select("id, confirmation").eq("destination_id", destinationId);
          if (error) throw error; return data ?? [];
        } },
      { queryKey: ["tickets", destinationId], queryFn: async () => {
          const { data, error } = await supabase.from("trip_tickets").select("id").eq("destination_id", destinationId);
          if (error) throw error; return data ?? [];
        } },
      { queryKey: ["costs", destinationId], queryFn: async () => {
          const { data, error } = await supabase.from("trip_costs").select("*").eq("destination_id", destinationId);
          if (error) throw error; return data ?? [];
        } },
      { queryKey: ["settlements", destinationId], queryFn: async () => {
          const { data, error } = await supabase.from("trip_settlements").select("from_user, to_user, amount_cents, currency").eq("destination_id", destinationId);
          if (error) throw error; return data ?? [];
        } },
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

  const memberCount = Math.max(members.length, 1);
  const flightsBooked = flights.filter((f) => f.confirmation && f.confirmation.trim().length > 0).length;

  const memberIds = useMemo(() => {
    const ids = new Set<string>(members.map((m) => m.user_id));
    for (const c of costs) { ids.add(c.user_id); if (c.paid_by) ids.add(c.paid_by); }
    return Array.from(ids);
  }, [members, costs]);

  const myNetCents = useMemo(() => netForUser(costs, settlements, memberIds, me), [costs, settlements, memberIds, me]);

  useEffect(() => {
    if (!isLoading) track("planning_progress_view", {}, destinationId);
  }, [isLoading, destinationId]);

  const items = computePlanningItems({
    startDate,
    endDate,
    staysCount: stays.length,
    flightsBooked,
    memberCount,
    headcount: headcountFallback,
    ticketsCount: tickets.length,
    myNetCents,
    settlementsCount: settlements.length,
  });

  const { earned, total, pct } = computeWeightedScore(items);
  const remaining = pendingPlanningItems(items);
  const next = nextBestAction(items);

  return (
    <PlanningProgressView
      isLoading={isLoading}
      items={items}
      earned={earned}
      total={total}
      pct={pct}
      remaining={remaining}
      next={next}
    />
  );
}

export type PlanningProgressViewProps = {
  isLoading: boolean;
  items: PlanningItem[];
  earned: number;
  total: number;
  pct: number;
  remaining: PlanningItem[];
  next: PlanningItem | null;
};

export function PlanningProgressView({ isLoading, items, earned, total, pct, remaining, next }: PlanningProgressViewProps) {
  const summary = isLoading
    ? "Planning progress: loading"
    : remaining.length === 0
    ? `Planning progress: complete, ${earned} of ${total} points`
    : `Planning progress: ${pct} percent, ${earned} of ${total} points, ${remaining.length} pending — ${remaining
        .map((r) => `${r.label} ${r.hint.toLowerCase()}`)
        .join(", ")}`;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={summary}
            className="block w-full rounded-xl border border-border/60 bg-card px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-medium text-foreground">Planning progress</h2>
              <span className="text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
                {isLoading ? "…" : `${pct}%`}
              </span>
            </div>
            <Progress
              value={isLoading ? 0 : pct}
              aria-label="Planning progress"
              aria-valuetext={isLoading ? "Loading" : `${pct} percent complete`}
              className="mt-1.5 h-1"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-xs border-green-900/30 bg-green-950 p-3 text-green-50 shadow-lg">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : remaining.length === 0 ? (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
              <span>Everything's planned. Nice work.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium" id="planning-progress-pending-heading">
                Still to do
              </p>
              <ul className="space-y-1" aria-labelledby="planning-progress-pending-heading">
                {remaining.map((i) => {
                  const Icon = i.status === "partial" ? AlertCircle : Circle;
                  const color = i.status === "partial" ? "text-amber-500" : "text-muted-foreground";
                  return (
                    <li key={i.key} className="flex items-center gap-2 text-xs">
                      <Icon className={`size-3.5 ${color}`} aria-hidden="true" />
                      <span className="font-medium">{i.label}</span>
                      <span className="text-muted-foreground">
                        <span aria-hidden="true">· </span>
                        {i.hint}
                      </span>
                      <span className="ml-auto tabular-nums text-[10px] text-muted-foreground" aria-hidden="true">
                        {i.earned}/{i.weight}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {next && (
                <p className="border-t border-green-900/30 pt-1.5 text-[11px] text-green-200">
                  Next best action: <span className="font-medium">{next.label}</span> (+{next.weight - next.earned})
                </p>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
