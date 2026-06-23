import { describe, it, expect } from "vitest";
import {
  computePlanningItems,
  computeWeightedScore,
  pendingPlanningItems,
  nextBestAction,
} from "./planning-progress";

function labels(items: { label: string }[]) {
  return items.map((i) => i.label);
}

const FULL = {
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  staysCount: 2,
  flightsBooked: 4,
  memberCount: 4,
  headcount: 4,
  ticketsCount: 3,
  myNetCents: 0,
  settlementsCount: 0,
};

describe("weighted planning progress", () => {
  it("brand-new trip earns only Destination's 10 points", () => {
    const items = computePlanningItems({
      startDate: null, endDate: null, staysCount: 0, flightsBooked: 0,
      memberCount: 1, headcount: 4, ticketsCount: 0, myNetCents: 0, settlementsCount: 0,
    });
    const { earned, total, pct } = computeWeightedScore(items);
    expect(total).toBe(100);
    // Destination 10 + Invites partial (1/4 of 10) = ~3
    expect(earned).toBeGreaterThanOrEqual(10);
    expect(earned).toBeLessThan(20);
    expect(pct).toBe(earned);
  });

  it("fully planned trip scores 100 and has no pending items", () => {
    const items = computePlanningItems(FULL);
    const score = computeWeightedScore(items);
    expect(score.pct).toBe(100);
    expect(pendingPlanningItems(items)).toHaveLength(0);
    expect(nextBestAction(items)).toBeNull();
  });

  it("partial flights award proportional points", () => {
    const items = computePlanningItems({ ...FULL, flightsBooked: 2 });
    const flights = items.find((i) => i.key === "flights")!;
    expect(flights.status).toBe("partial");
    expect(flights.earned).toBe(Math.round((2 / 4) * 25));
    expect(flights.hint).toBe("2 / 4 booked");
  });

  it("only one date earns half credit (partial)", () => {
    const items = computePlanningItems({ ...FULL, startDate: "2026-07-01", endDate: null });
    const dates = items.find((i) => i.key === "dates")!;
    expect(dates.status).toBe("partial");
    expect(dates.earned).toBe(5);
  });

  it("invites scale by headcount target", () => {
    const items = computePlanningItems({ ...FULL, memberCount: 2, headcount: 4 });
    const invites = items.find((i) => i.key === "invites")!;
    expect(invites.earned).toBe(5);
    expect(invites.status).toBe("partial");
  });

  it("balances: settled is done, in-progress settlement is partial, outstanding-no-settlement is todo", () => {
    const settled = computePlanningItems({ ...FULL, myNetCents: 0 }).find((i) => i.key === "balances")!;
    expect(settled.status).toBe("done");

    const partial = computePlanningItems({ ...FULL, myNetCents: 4200, settlementsCount: 1 }).find((i) => i.key === "balances")!;
    expect(partial.status).toBe("partial");
    expect(partial.earned).toBe(8); // round(15 * 0.5)

    const todo = computePlanningItems({ ...FULL, myNetCents: 4200, settlementsCount: 0 }).find((i) => i.key === "balances")!;
    expect(todo.status).toBe("todo");
    expect(todo.earned).toBe(0);
  });

  it("nextBestAction picks the highest remaining-weight pending item", () => {
    // Missing only Flights (25) and Activities (15) → Flights wins.
    const items = computePlanningItems({ ...FULL, flightsBooked: 0, ticketsCount: 0 });
    expect(nextBestAction(items)?.key).toBe("flights");
  });

  it("pending list omits fully-earned items", () => {
    const items = computePlanningItems({ ...FULL, flightsBooked: 0 });
    expect(labels(pendingPlanningItems(items))).toEqual(["Flights"]);
  });
});
