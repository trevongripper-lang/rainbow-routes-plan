// Pure logic powering the Planning Progress tooltip:
// given a trip's data, return the ordered list of items and which are pending.

import { netForUser, type CostRow, type SettlementRow } from "./trip-balances";

export type PlanningStatus = "done" | "partial" | "todo";

export type PlanningItem = {
  key: "destination" | "dates" | "stay" | "flights" | "activities" | "balances";
  label: string;
  status: PlanningStatus;
  hint: string;
};

export type PlanningInput = {
  startDate: string | null;
  endDate: string | null;
  staysCount: number;
  flightsBooked: number;
  memberCount: number;
  ticketsCount: number;
  myNetCents: number;
};

export function computePlanningItems(input: PlanningInput): PlanningItem[] {
  const datesDone = !!(input.startDate && input.endDate);
  const stays: PlanningStatus = input.staysCount > 0 ? "done" : "todo";
  const flights: PlanningStatus =
    input.flightsBooked === 0
      ? "todo"
      : input.flightsBooked >= input.memberCount
      ? "done"
      : "partial";
  const tickets: PlanningStatus = input.ticketsCount > 0 ? "done" : "todo";
  const balances: PlanningStatus = Math.abs(input.myNetCents) < 1 ? "done" : "partial";

  return [
    { key: "destination", label: "Destination", status: "done", hint: "Decided" },
    { key: "dates", label: "Dates", status: datesDone ? "done" : "todo", hint: datesDone ? "Set" : "Not set" },
    {
      key: "stay",
      label: "Stay",
      status: stays,
      hint: input.staysCount > 0 ? `${input.staysCount} booked` : "Not booked",
    },
    {
      key: "flights",
      label: "Flights",
      status: flights,
      hint: `${input.flightsBooked} / ${input.memberCount} booked`,
    },
    {
      key: "activities",
      label: "Activities",
      status: tickets,
      hint: input.ticketsCount > 0 ? `${input.ticketsCount} added` : "None yet",
    },
    {
      key: "balances",
      label: "Balances",
      status: balances,
      hint: balances === "done" ? "Settled" : "Outstanding",
    },
  ];
}

/** Items the tooltip surfaces — anything not yet done. */
export function pendingPlanningItems(items: PlanningItem[]): PlanningItem[] {
  return items.filter((i) => i.status !== "done");
}

/** Convenience for callers that have raw cost/settlement rows. */
export function netCentsForMember(
  costs: CostRow[],
  settlements: SettlementRow[],
  memberIds: string[],
  userId: string,
): number {
  return netForUser(costs, settlements, memberIds, userId);
}
