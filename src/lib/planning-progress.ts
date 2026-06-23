// Commitment-framed planning progress. Each item earns up to `weight`;
// items sum to 100 so pct === sum(earned).

import { netForUser, type CostRow, type SettlementRow } from "./trip-balances";

export type PlanningStatus = "done" | "partial" | "todo";

export type PlanningKey = "destination" | "dates" | "people" | "stay" | "travel" | "money";

export type PlanningItem = {
  key: PlanningKey;
  label: string;
  status: PlanningStatus;
  hint: string;
  weight: number;
  earned: number;
};

export type PlanningInput = {
  // Dates
  startDate: string | null;
  endDate: string | null;
  datesLocked: boolean;
  // People
  memberCount: number;
  confirmedCount: number;
  headcount: number;
  // Stay
  staysCount: number;
  stayNotNeeded: boolean;
  // Travel (per-member, computed by caller)
  travelHandledCount: number; // booked OR not_needed
  // Money
  myNetCents: number;
  settlementsCount: number;
  noSharedCosts: boolean;
  /** Are there any shared cost rows on the trip? */
  hasSharedCosts: boolean;
};

const W = {
  destination: 10,
  dates: 15,
  people: 15,
  stay: 15,
  travel: 25,
  money: 20,
} as const satisfies Record<PlanningKey, number>;

function statusFor(earned: number, weight: number): PlanningStatus {
  if (earned >= weight) return "done";
  if (earned > 0) return "partial";
  return "todo";
}

export function computePlanningItems(input: PlanningInput): PlanningItem[] {
  // Dates
  let datesEarned = 0;
  let datesHint = "Not set";
  if (input.startDate && input.endDate && input.datesLocked) {
    datesEarned = W.dates;
    datesHint = "Locked";
  } else if (input.startDate && input.endDate) {
    datesEarned = 7;
    datesHint = "Set — lock to commit";
  } else if (input.startDate || input.endDate) {
    datesEarned = 3;
    datesHint = "Partly set";
  }

  // People confirmed
  const target = Math.max(1, input.headcount);
  const confirmedRatio = Math.min(1, input.confirmedCount / target);
  const peopleEarned = Math.round(confirmedRatio * W.people);
  const peopleHint = `${input.confirmedCount} / ${target} confirmed`;

  // Stay
  const stayEarned = input.stayNotNeeded ? W.stay : input.staysCount > 0 ? W.stay : 0;
  const stayHint = input.stayNotNeeded
    ? "Not needed"
    : input.staysCount > 0
      ? `${input.staysCount} booked`
      : "Not handled";

  // Travel — per-member coverage (booked or opted out)
  const travelDenom = Math.max(1, input.memberCount);
  const travelRatio = Math.min(1, input.travelHandledCount / travelDenom);
  const travelEarned = Math.round(travelRatio * W.travel);
  const travelHint = `${input.travelHandledCount} / ${travelDenom} handled`;

  // Money — never auto-completes from emptiness
  let moneyEarned = 0;
  let moneyHint = "Not handled";
  if (input.noSharedCosts) {
    moneyEarned = W.money;
    moneyHint = "No shared costs";
  } else if (!input.hasSharedCosts) {
    // Costs haven't been discussed yet — explicitly NOT done
    moneyEarned = 0;
    moneyHint = "Not discussed";
  } else if (Math.abs(input.myNetCents) < 1 && input.settlementsCount > 0) {
    moneyEarned = W.money;
    moneyHint = "Settled";
  } else if (input.settlementsCount > 0) {
    moneyEarned = Math.round(W.money * 0.5);
    moneyHint = "Partly settled";
  } else {
    moneyEarned = 0;
    moneyHint = "Outstanding";
  }

  return [
    {
      key: "destination",
      label: "Destination picked",
      weight: W.destination,
      earned: W.destination,
      status: "done",
      hint: "Decided",
    },
    {
      key: "dates",
      label: "Dates locked",
      weight: W.dates,
      earned: datesEarned,
      status: statusFor(datesEarned, W.dates),
      hint: datesHint,
    },
    {
      key: "people",
      label: "People confirmed",
      weight: W.people,
      earned: peopleEarned,
      status: statusFor(peopleEarned, W.people),
      hint: peopleHint,
    },
    {
      key: "stay",
      label: "Stay handled",
      weight: W.stay,
      earned: stayEarned,
      status: statusFor(stayEarned, W.stay),
      hint: stayHint,
    },
    {
      key: "travel",
      label: "Travel handled",
      weight: W.travel,
      earned: travelEarned,
      status: statusFor(travelEarned, W.travel),
      hint: travelHint,
    },
    {
      key: "money",
      label: "Money handled",
      weight: W.money,
      earned: moneyEarned,
      status: statusFor(moneyEarned, W.money),
      hint: moneyHint,
    },
  ];
}

export function computeWeightedScore(items: PlanningItem[]): {
  earned: number;
  total: number;
  pct: number;
} {
  const earned = items.reduce((s, i) => s + i.earned, 0);
  const total = items.reduce((s, i) => s + i.weight, 0);
  const pct = total === 0 ? 0 : Math.round((earned / total) * 100);
  return { earned, total, pct };
}

export function pendingPlanningItems(items: PlanningItem[]): PlanningItem[] {
  return items.filter((i) => i.earned < i.weight);
}

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
