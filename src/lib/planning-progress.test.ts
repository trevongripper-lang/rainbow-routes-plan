import { describe, it, expect } from "vitest";
import {
  computePlanningItems,
  computeWeightedScore,
  pendingPlanningItems,
  nextBestAction,
  type PlanningInput,
} from "./planning-progress";

const FULL: PlanningInput = {
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  datesLocked: true,
  memberCount: 4,
  confirmedCount: 4,
  headcount: 4,
  staysCount: 2,
  stayNotNeeded: false,
  travelHandledCount: 4,
  myNetCents: 0,
  settlementsCount: 1,
  noSharedCosts: false,
  hasSharedCosts: true,
};

const NEW_TRIP: PlanningInput = {
  startDate: null,
  endDate: null,
  datesLocked: false,
  memberCount: 1,
  confirmedCount: 1,
  headcount: 4,
  staysCount: 0,
  stayNotNeeded: false,
  travelHandledCount: 0,
  myNetCents: 0,
  settlementsCount: 0,
  noSharedCosts: false,
  hasSharedCosts: false,
};

describe("commitment planning progress", () => {
  it("brand-new trip: Money is NOT auto-done from emptiness (the fix)", () => {
    const items = computePlanningItems(NEW_TRIP);
    const money = items.find((i) => i.key === "money")!;
    expect(money.status).toBe("todo");
    expect(money.earned).toBe(0);
    expect(money.hint).toBe("Not discussed");
  });

  it("no shared costs toggled → Money is done", () => {
    const items = computePlanningItems({ ...NEW_TRIP, noSharedCosts: true });
    const money = items.find((i) => i.key === "money")!;
    expect(money.status).toBe("done");
    expect(money.hint).toBe("No shared costs");
  });

  it("shared costs exist but unsettled → todo (Outstanding)", () => {
    const items = computePlanningItems({ ...FULL, hasSharedCosts: true, myNetCents: 4200, settlementsCount: 0 });
    const money = items.find((i) => i.key === "money")!;
    expect(money.status).toBe("todo");
    expect(money.hint).toBe("Outstanding");
  });

  it("shared costs with partial settlements → partial", () => {
    const items = computePlanningItems({ ...FULL, hasSharedCosts: true, myNetCents: 4200, settlementsCount: 1 });
    const money = items.find((i) => i.key === "money")!;
    expect(money.status).toBe("partial");
    expect(money.earned).toBe(10);
  });

  it("dates: both set but unlocked is only partial credit", () => {
    const items = computePlanningItems({ ...NEW_TRIP, startDate: "2026-07-01", endDate: "2026-07-08", datesLocked: false });
    const dates = items.find((i) => i.key === "dates")!;
    expect(dates.status).toBe("partial");
    expect(dates.earned).toBe(7);
    expect(dates.hint).toMatch(/lock/i);
  });

  it("dates: locked earns full credit", () => {
    const items = computePlanningItems({ ...NEW_TRIP, startDate: "2026-07-01", endDate: "2026-07-08", datesLocked: true });
    const dates = items.find((i) => i.key === "dates")!;
    expect(dates.status).toBe("done");
    expect(dates.earned).toBe(15);
  });

  it("dates: only one date set → minimal credit", () => {
    const items = computePlanningItems({ ...NEW_TRIP, startDate: "2026-07-01", endDate: null });
    const dates = items.find((i) => i.key === "dates")!;
    expect(dates.earned).toBe(3);
    expect(dates.status).toBe("partial");
  });

  it("people: confirmations scale to headcount", () => {
    const items = computePlanningItems({ ...FULL, confirmedCount: 2, headcount: 4 });
    const people = items.find((i) => i.key === "people")!;
    expect(people.earned).toBe(8);
    expect(people.status).toBe("partial");
    expect(people.hint).toBe("2 / 4 confirmed");
  });

  it("travel: per-member opt-out counts toward done", () => {
    const items = computePlanningItems({ ...FULL, memberCount: 4, travelHandledCount: 4 });
    const travel = items.find((i) => i.key === "travel")!;
    expect(travel.status).toBe("done");
    expect(travel.hint).toBe("4 / 4 handled");
  });

  it("travel: partial handling earns proportional credit", () => {
    const items = computePlanningItems({ ...FULL, memberCount: 4, travelHandledCount: 2 });
    const travel = items.find((i) => i.key === "travel")!;
    expect(travel.earned).toBe(Math.round((2 / 4) * 25));
    expect(travel.status).toBe("partial");
  });

  it("stay: opt-out earns full credit even with zero stays", () => {
    const items = computePlanningItems({ ...NEW_TRIP, stayNotNeeded: true });
    const stay = items.find((i) => i.key === "stay")!;
    expect(stay.status).toBe("done");
    expect(stay.hint).toBe("Not needed");
  });

  it("fully ready trip scores 100", () => {
    expect(computeWeightedScore(computePlanningItems(FULL)).pct).toBe(100);
    expect(nextBestAction(computePlanningItems(FULL))).toBeNull();
  });

  it("brand-new trip scores only Destination's 10", () => {
    const items = computePlanningItems(NEW_TRIP);
    const { earned, pct } = computeWeightedScore(items);
    // Destination 10 + People partial (1/4 of 15 = 4) = ~14
    expect(earned).toBeGreaterThanOrEqual(10);
    expect(earned).toBeLessThan(20);
    expect(pct).toBe(earned);
  });

  it("nextBestAction picks the highest-impact pending item", () => {
    // Missing Travel (25) and Money (20) — Travel wins
    const items = computePlanningItems({ ...FULL, travelHandledCount: 0, noSharedCosts: false, hasSharedCosts: false });
    expect(nextBestAction(items)?.key).toBe("travel");
  });

  it("labels match the commitment frame", () => {
    const items = computePlanningItems(FULL);
    expect(items.map((i) => i.label)).toEqual([
      "Destination picked",
      "Dates locked",
      "People confirmed",
      "Stay handled",
      "Travel handled",
      "Money handled",
    ]);
  });

  it("pending list excludes fully-earned items", () => {
    const items = computePlanningItems({ ...FULL, travelHandledCount: 0 });
    expect(pendingPlanningItems(items).map((i) => i.key)).toEqual(["travel"]);
  });
});
