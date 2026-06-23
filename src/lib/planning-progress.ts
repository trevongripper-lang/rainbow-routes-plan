// Weighted planning progress model. Each item earns up to `weight` points;
// total across items = 100, so `pct === sum(earned)`.

import { netForUser, type CostRow, type SettlementRow } from "./trip-balances";

export type PlanningStatus = "done" | "partial" | "todo";

export type PlanningKey =
  | "destination"
  | "dates"
  | "invites"
  | "stay"
  | "flights"
  | "activities"
  | "balances";

export type PlanningItem = {
  key: PlanningKey;
  label: string;
  status: PlanningStatus;
  hint: string;
  weight: number;
  earned: number;
};

export type PlanningInput = {
  startDate: string | null;
  endDate: string | null;
  staysCount: number;
  flightsBooked: number;
  memberCount: number;
  ticketsCount: number;
  myNetCents: number;
  /** Target trip size used as the Invites denominator. Falls back to memberCount. */
  headcount?: number;
  /** Any recorded settlements? Gives partial Balances credit while non-zero net remains. */
  settlementsCount?: number;
};

const W = {
  destination: 10,
  dates: 10,
  invites: 10,
  stay: 15,
  flights: 25,
  activities: 15,
  balances: 15,
} as const satisfies Record<PlanningKey, number>;

function statusFor(earned: number, weight: number): PlanningStatus {
  if (earned >= weight) return "done";
  if (earned > 0) return "partial";
  return "todo";
}

export function computePlanningItems(input: PlanningInput): PlanningItem[] {
  // Dates
  const datesEarned = input.startDate && input.endDate ? W.dates : input.startDate || input.endDate ? W.dates / 2 : 0;
  const datesHint = input.startDate && input.endDate ? "Set" : input.startDate || input.endDate ? "Partly set" : "Not set";

  // Invites
  const target = Math.max(1, input.headcount ?? input.memberCount);
  const inviteRatio = Math.min(1, input.memberCount / target);
  const invitesEarned = Math.round(inviteRatio * W.invites);
  const invitesHint =
    input.memberCount >= target ? `${input.memberCount} / ${target} joined` : `${input.memberCount} / ${target} joined`;

  // Stay
  const stayEarned = input.staysCount > 0 ? W.stay : 0;
  const stayHint = input.staysCount > 0 ? `${input.staysCount} booked` : "Not booked";

  // Flights
  const flightDenom = Math.max(1, input.memberCount);
  const flightRatio = Math.min(1, input.flightsBooked / flightDenom);
  const flightsEarned = Math.round(flightRatio * W.flights);
  const flightsHint = `${input.flightsBooked} / ${flightDenom} booked`;

  // Activities
  const actEarned = input.ticketsCount > 0 ? W.activities : 0;
  const actHint = input.ticketsCount > 0 ? `${input.ticketsCount} added` : "None yet";

  // Balances: settled OR no shared costs at all → done; some settlement progress → partial; else todo.
  const settled = Math.abs(input.myNetCents) < 1;
  const balancesEarned = settled ? W.balances : (input.settlementsCount ?? 0) > 0 ? Math.round(W.balances * 0.5) : 0;
  const balancesHint = settled ? "Settled" : (input.settlementsCount ?? 0) > 0 ? "Partly settled" : "Outstanding";

  return [
    { key: "destination", label: "Destination", weight: W.destination, earned: W.destination, status: "done", hint: "Decided" },
    { key: "dates", label: "Dates", weight: W.dates, earned: datesEarned, status: statusFor(datesEarned, W.dates), hint: datesHint },
    { key: "invites", label: "Invites", weight: W.invites, earned: invitesEarned, status: statusFor(invitesEarned, W.invites), hint: invitesHint },
    { key: "stay", label: "Stay", weight: W.stay, earned: stayEarned, status: statusFor(stayEarned, W.stay), hint: stayHint },
    { key: "flights", label: "Flights", weight: W.flights, earned: flightsEarned, status: statusFor(flightsEarned, W.flights), hint: flightsHint },
    { key: "activities", label: "Activities", weight: W.activities, earned: actEarned, status: statusFor(actEarned, W.activities), hint: actHint },
    { key: "balances", label: "Balances", weight: W.balances, earned: balancesEarned, status: statusFor(balancesEarned, W.balances), hint: balancesHint },
  ];
}

export function computeWeightedScore(items: PlanningItem[]): { earned: number; total: number; pct: number } {
  const earned = items.reduce((s, i) => s + i.earned, 0);
  const total = items.reduce((s, i) => s + i.weight, 0);
  const pct = total === 0 ? 0 : Math.round((earned / total) * 100);
  return { earned, total, pct };
}

/** Items the tooltip surfaces — anything not yet fully earned. */
export function pendingPlanningItems(items: PlanningItem[]): PlanningItem[] {
  return items.filter((i) => i.earned < i.weight);
}

/** Highest-impact pending item (max remaining weight). Null if everything's done. */
export function nextBestAction(items: PlanningItem[]): PlanningItem | null {
  const pending = pendingPlanningItems(items);
  if (pending.length === 0) return null;
  return pending.reduce((best, i) => (i.weight - i.earned > best.weight - best.earned ? i : best));
}

export function netCentsForMember(
  costs: CostRow[],
  settlements: SettlementRow[],
  memberIds: string[],
  userId: string,
): number {
  return netForUser(costs, settlements, memberIds, userId);
}
