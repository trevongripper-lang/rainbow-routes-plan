import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { netForUser, type CostRow, type SettlementRow } from "@/lib/trip-balances";
import { computePlanningItems, pendingPlanningItems } from "@/lib/planning-progress";
import {
  AlertCircle,
  Circle,
  Flame,
  Users,
  Plane,
  Wallet,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

type MemberRow = { user_id: string; role: string; status: string; travel_status: string };
type DestFlags = { dates_locked: boolean; stay_not_needed: boolean; no_shared_costs: boolean };
type InviteRow = { id: string; accepted_at: string | null; expires_at: string | null };

export type MissionControlProps = {
  destinationId: string;
  me: string;
  startDate: string | null;
  endDate: string | null;
  headcountFallback: number;
  defaultCurrency: string;
  canOrganize: boolean;
  /** Opens the Trip settings disclosure in the header. */
  onOpenTripSettings?: () => void;
  /** Opens the existing crew dialog. */
  onOpenCrew?: () => void;
};

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4">
      <h2 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5 text-primary" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  );
}

function CardError({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <AlertCircle className="size-3.5 text-amber-500" aria-hidden="true" />
      {label} couldn&apos;t be loaded right now.
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function MissionControl({
  destinationId,
  me,
  startDate,
  endDate,
  headcountFallback,
  defaultCurrency,
  canOrganize,
  onOpenTripSettings,
  onOpenCrew,
}: MissionControlProps) {
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
      {
        queryKey: ["trip-invites", destinationId],
        queryFn: async (): Promise<InviteRow[]> => {
          const { data, error } = await supabase
            .from("trip_invites")
            .select("id, accepted_at, expires_at")
            .eq("destination_id", destinationId);
          if (error) throw error;
          return (data ?? []) as InviteRow[];
        },
      },
      {
        queryKey: ["flights", destinationId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("trip_flights")
            .select("id")
            .eq("destination_id", destinationId);
          if (error) throw error;
          return data ?? [];
        },
      },
    ],
  });

  const [membersQ, flagsQ, staysQ, costsQ, settlementsQ, invitesQ, flightsQ] = results;

  const members = useMemo(() => (membersQ.data ?? []) as MemberRow[], [membersQ.data]);
  const costs = useMemo(() => (costsQ.data ?? []) as CostRow[], [costsQ.data]);
  const settlements = useMemo(
    () => (settlementsQ.data ?? []) as SettlementRow[],
    [settlementsQ.data],
  );

  const memberIds = useMemo(() => {
    const ids = new Set<string>(members.map((m) => m.user_id));
    for (const c of costs) {
      ids.add(c.user_id);
      if (c.paid_by) ids.add(c.paid_by);
    }
    return Array.from(ids);
  }, [members, costs]);

  const flags = (flagsQ.data ?? {
    dates_locked: false,
    stay_not_needed: false,
    no_shared_costs: false,
  }) as DestFlags;
  const stays = (staysQ.data ?? []) as { id: string }[];
  const invites = (invitesQ.data ?? []) as InviteRow[];
  const flights = (flightsQ.data ?? []) as { id: string }[];

  const committed = members.filter((m) => m.status === "confirmed" || m.role === "owner").length;
  const travelHandled = members.filter(
    (m) => m.travel_status === "booked" || m.travel_status === "not_needed",
  ).length;
  const travelRemaining = Math.max(0, members.length - travelHandled);
  const awaitingResponse = invites.filter(
    (i) => !i.accepted_at && (!i.expires_at || new Date(i.expires_at) > new Date()),
  ).length;

  const sharedCostsCents = costs.reduce((s, c) => (c.is_shared ? s + c.amount_cents : s), 0);
  const hasSharedCosts = costs.some((c) => c.is_shared);
  const myNetCents = netForUser(costs, settlements, memberIds, me);

  const items = computePlanningItems({
    startDate,
    endDate,
    datesLocked: flags.dates_locked,
    memberCount: Math.max(members.length, 1),
    confirmedCount: committed,
    headcount: headcountFallback,
    staysCount: stays.length,
    stayNotNeeded: flags.stay_not_needed,
    travelHandledCount: travelHandled,
    myNetCents,
    settlementsCount: settlements.length,
    noSharedCosts: flags.no_shared_costs,
    hasSharedCosts,
  });

  const pending = pendingPlanningItems(items).slice(0, 4);

  const planningLoading = membersQ.isLoading || flagsQ.isLoading || staysQ.isLoading;
  const planningError = membersQ.isError || flagsQ.isError || staysQ.isError || costsQ.isError;

  const NEXT_UP: Record<
    string,
    { label: string; tab?: string; settings?: boolean; organizerOnly?: boolean }
  > = {
    dates: { label: "Lock the trip dates", settings: true, organizerOnly: true },
    people: { label: "Confirm who is coming", tab: "overview" },
    stay: { label: "Add a stay", tab: "stays" },
    travel: { label: "Add your travel details", tab: "flights" },
    money: { label: "Record the budget", tab: "costs" },
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Next up" icon={Flame}>
        {planningLoading ? (
          <Skeleton />
        ) : planningError ? (
          <CardError label="Planning status" />
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Everything is handled — this trip is ready to go.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {pending.map((i) => {
              const cfg = NEXT_UP[i.key];
              if (!cfg) return null;
              if (cfg.organizerOnly && !canOrganize) return null;
              const inner = (
                <>
                  <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{cfg.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{i.hint}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </>
              );
              const cls =
                "flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
              return (
                <li key={i.key}>
                  {cfg.settings ? (
                    <button type="button" onClick={onOpenTripSettings} className={cls}>
                      {inner}
                    </button>
                  ) : (
                    <Link
                      to="/trips/$id"
                      params={{ id: destinationId }}
                      search={{ tab: cfg.tab as string }}
                      className={cls}
                    >
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Travelers" icon={Users}>
        {membersQ.isLoading ? (
          <Skeleton />
        ) : membersQ.isError ? (
          <CardError label="Travelers" />
        ) : (
          <div className="space-y-1.5">
            <Stat label="Joined" value={String(members.length)} />
            <Stat label="Committed" value={String(committed)} />
            <Stat
              label="Awaiting response"
              value={invitesQ.isError ? "—" : invitesQ.isLoading ? "…" : String(awaitingResponse)}
            />
            {onOpenCrew && (
              <button
                type="button"
                onClick={onOpenCrew}
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                See everyone on this trip
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </Card>

      <Card title="Travel" icon={Plane}>
        {flightsQ.isLoading || membersQ.isLoading ? (
          <Skeleton />
        ) : flightsQ.isError ? (
          <CardError label="Travel" />
        ) : (
          <div className="space-y-1.5">
            <Stat label="Flights added" value={String(flights.length)} />
            <Stat
              label="Travel details remaining"
              value={membersQ.isError ? "—" : String(travelRemaining)}
            />
            <Link
              to="/trips/$id"
              params={{ id: destinationId }}
              search={{ tab: "flights" }}
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {flights.length === 0 ? "Add the first flight" : "Open the Flights tab"}
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </div>
        )}
      </Card>

      <Card title="Budget" icon={Wallet}>
        {costsQ.isLoading ? (
          <Skeleton />
        ) : costsQ.isError ? (
          <CardError label="Budget" />
        ) : (
          <div className="space-y-1.5">
            <Stat label="Recorded group costs" value={money(sharedCostsCents, defaultCurrency)} />
            <Stat
              label="Your unsettled balance"
              value={settlementsQ.isError ? "—" : money(myNetCents, defaultCurrency)}
            />
            <Link
              to="/trips/$id"
              params={{ id: destinationId }}
              search={{ tab: "costs" }}
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {hasSharedCosts ? "Open the Costs tab" : "Record the first cost"}
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
