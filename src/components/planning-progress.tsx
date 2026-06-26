import { useEffect, useMemo } from "react";
import { useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  Lock,
  Plane,
  DollarSign,
  Hotel,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

type Props = {
  destinationId: string;
  me: string;
  startDate: string | null;
  endDate: string | null;
  headcountFallback: number;
  defaultCurrency: string;
  isOwner: boolean;
};

type MemberRow = { user_id: string; role: string; status: string; travel_status: string };
type DestFlags = { dates_locked: boolean; stay_not_needed: boolean; no_shared_costs: boolean };

export function PlanningProgress({
  destinationId,
  me,
  startDate,
  endDate,
  headcountFallback,
  isOwner,
}: Props) {
  const qc = useQueryClient();

  const results = useQueries({
    queries: [
      {
        queryKey: ["trip-members", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("trip_members")
            .select("user_id, role, status, travel_status" as never)
            .eq("destination_id", destinationId);
          if (error) throw error;
          return (data ?? []) as unknown as MemberRow[];
        },
      },
      {
        queryKey: ["dest-flags", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("destinations")
            .select("dates_locked, stay_not_needed, no_shared_costs" as never)
            .eq("id", destinationId)
            .maybeSingle();
          if (error) throw error;
          return (data ?? {
            dates_locked: false,
            stay_not_needed: false,
            no_shared_costs: false,
          }) as unknown as DestFlags;
        },
      },
      {
        queryKey: ["stays", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("trip_stays")
            .select("id")
            .eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ["costs", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("trip_costs")
            .select("*")
            .eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ["settlements", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("trip_settlements")
            .select("from_user, to_user, amount_cents, currency")
            .eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
    ],
  });

  const [membersQ, flagsQ, staysQ, costsQ, settlementsQ] = results;
  const isLoading = results.some((r) => r.isLoading);

  const members = useMemo(() => (membersQ.data ?? []) as MemberRow[], [membersQ.data]);
  const flags = (flagsQ.data ?? {
    dates_locked: false,
    stay_not_needed: false,
    no_shared_costs: false,
  }) as DestFlags;
  const stays = (staysQ.data ?? []) as { id: string }[];
  const costs = useMemo(() => (costsQ.data ?? []) as CostRow[], [costsQ.data]);
  const settlements = useMemo(
    () => (settlementsQ.data ?? []) as SettlementRow[],
    [settlementsQ.data],
  );

  const memberCount = Math.max(members.length, 1);
  const confirmedCount = members.filter(
    (m) => m.status === "confirmed" || m.role === "owner",
  ).length;
  const travelHandledCount = members.filter(
    (m) => m.travel_status === "booked" || m.travel_status === "not_needed",
  ).length;
  const hasSharedCosts = costs.some((c) => c.is_shared);

  const memberIds = useMemo(() => {
    const ids = new Set<string>(members.map((m) => m.user_id));
    for (const c of costs) {
      ids.add(c.user_id);
      if (c.paid_by) ids.add(c.paid_by);
    }
    return Array.from(ids);
  }, [members, costs]);

  const myNetCents = useMemo(
    () => netForUser(costs, settlements, memberIds, me),
    [costs, settlements, memberIds, me],
  );

  useEffect(() => {
    if (!isLoading) track("planning_progress_view", {}, destinationId);
  }, [isLoading, destinationId]);

  const items = computePlanningItems({
    startDate,
    endDate,
    datesLocked: flags.dates_locked,
    memberCount,
    confirmedCount,
    headcount: headcountFallback,
    staysCount: stays.length,
    stayNotNeeded: flags.stay_not_needed,
    travelHandledCount,
    myNetCents,
    settlementsCount: settlements.length,
    noSharedCosts: flags.no_shared_costs,
    hasSharedCosts,
  });

  const { earned, total, pct } = computeWeightedScore(items);
  const remaining = pendingPlanningItems(items);
  const next = nextBestAction(items);

  // Mutations for owner toggles + personal commitment
  const myStatus = members.find((m) => m.user_id === me);
  const myTravel = myStatus?.travel_status ?? "pending";

  const flipFlag = useMutation({
    mutationFn: async (patch: Partial<DestFlags>) => {
      const { error } = await supabase
        .from("destinations")
        .update(patch as never)
        .eq("id", destinationId);
      if (error) throw error;
    },
    onSuccess: (_d, patch) => {
      qc.invalidateQueries({ queryKey: ["dest-flags", destinationId] });
      qc.invalidateQueries({ queryKey: ["trip", destinationId] });
      const key = Object.keys(patch)[0] ?? "flag";
      const value = Object.values(patch)[0];
      track("planning_commit", { item: key, value }, destinationId);
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMe = useMutation({
    mutationFn: async (patch: { status?: string; travel_status?: string }) => {
      const { error } = await supabase
        .from("trip_members")
        .update(patch as never)
        .eq("destination_id", destinationId)
        .eq("user_id", me);
      if (error) throw error;
    },
    onSuccess: (_d, patch) => {
      qc.invalidateQueries({ queryKey: ["trip-members", destinationId] });
      const key = patch.status ? "member_confirmed" : "travel_not_needed";
      track("planning_commit", { item: key, value: Object.values(patch)[0] }, destinationId);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const actions: Partial<Record<string, () => void>> = {
    dates:
      isOwner && startDate && endDate && !flags.dates_locked
        ? () => flipFlag.mutate({ dates_locked: true })
        : undefined,
    stay:
      isOwner && !flags.stay_not_needed && stays.length === 0
        ? () => flipFlag.mutate({ stay_not_needed: true })
        : undefined,
    money:
      isOwner && !flags.no_shared_costs && !hasSharedCosts
        ? () => flipFlag.mutate({ no_shared_costs: true })
        : undefined,
    travel:
      myStatus && myTravel === "pending"
        ? () => updateMe.mutate({ travel_status: "not_needed" })
        : undefined,
    people:
      myStatus && myStatus.status !== "confirmed" && myStatus.role !== "owner"
        ? () => updateMe.mutate({ status: "confirmed" })
        : undefined,
  };

  const actionLabels: Partial<Record<string, string>> = {
    dates: "Lock dates",
    stay: "Mark not needed",
    money: "No shared costs",
    travel: "I don't need a flight",
    people: "Confirm I'm coming",
  };

  return (
    <PlanningProgressView
      isLoading={isLoading}
      items={items}
      earned={earned}
      total={total}
      pct={pct}
      remaining={remaining}
      next={next}
      actions={actions}
      actionLabels={actionLabels}
    />
  );
}

const ICON: Record<string, typeof Lock> = {
  dates: Lock,
  people: UserCheck,
  stay: Hotel,
  travel: Plane,
  money: DollarSign,
};

export type PlanningProgressViewProps = {
  isLoading: boolean;
  items: PlanningItem[];
  earned: number;
  total: number;
  pct: number;
  remaining: PlanningItem[];
  next: PlanningItem | null;
  actions?: Partial<Record<string, (() => void) | undefined>>;
  actionLabels?: Partial<Record<string, string>>;
};

export function PlanningProgressView({
  isLoading,
  items,
  earned,
  total,
  pct,
  remaining,
  next,
  actions,
  actionLabels,
}: PlanningProgressViewProps) {
  const summary = isLoading
    ? "Planning progress: loading"
    : remaining.length === 0
      ? `Planning progress: ready to go, ${earned} of ${total} points`
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
              <h2 className="text-xs font-medium text-foreground">Ready to go</h2>
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
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-sm border-green-900/30 bg-green-950 p-3 text-green-50 shadow-lg"
        >
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : remaining.length === 0 ? (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
              <span>Ready to go. Nothing left to chase.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium" id="planning-progress-pending-heading">
                Still to do
              </p>
              <ul className="space-y-1.5" aria-labelledby="planning-progress-pending-heading">
                {remaining.map((i) => {
                  const StatusIcon = i.status === "partial" ? AlertCircle : Circle;
                  const KindIcon = ICON[i.key];
                  const color = i.status === "partial" ? "text-amber-500" : "text-muted-foreground";
                  const onAction = actions?.[i.key];
                  const actionLabel = actionLabels?.[i.key];
                  return (
                    <li key={i.key} className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <StatusIcon className={`size-3.5 ${color}`} aria-hidden="true" />
                        {KindIcon && (
                          <KindIcon className="size-3.5 text-green-200" aria-hidden="true" />
                        )}
                        <span className="font-medium">{i.label}</span>
                        <span className="text-muted-foreground">
                          <span aria-hidden="true">· </span>
                          {i.hint}
                        </span>
                        <span
                          className="ml-auto tabular-nums text-[10px] text-muted-foreground"
                          aria-hidden="true"
                        >
                          {i.earned}/{i.weight}
                        </span>
                      </div>
                      {onAction && actionLabel && (
                        <button
                          type="button"
                          onClick={onAction}
                          className="ml-6 rounded-md border border-green-800/40 bg-green-900/40 px-2 py-0.5 text-[11px] text-green-50 hover:bg-green-800/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-green-300"
                        >
                          {actionLabel}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {next && (
                <p className="border-t border-green-900/30 pt-1.5 text-[11px] text-green-200">
                  Next best action: <span className="font-medium">{next.label}</span> (+
                  {next.weight - next.earned} pts)
                </p>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
