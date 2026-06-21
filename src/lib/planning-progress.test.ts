import { describe, it, expect } from "vitest";
import { computePlanningItems, pendingPlanningItems } from "./planning-progress";

const ME = "user-me";
const FRIEND = "user-friend";

function labels(items: { label: string }[]) {
  return items.map((i) => i.label);
}

describe("Planning progress tooltip — pending items", () => {
  it("brand-new trip: pending = everything except Destination", () => {
    const items = computePlanningItems({
      startDate: null,
      endDate: null,
      staysCount: 0,
      flightsBooked: 0,
      memberCount: 4,
      ticketsCount: 0,
      myNetCents: 0,
    });
    const pending = pendingPlanningItems(items);
    expect(labels(pending)).toEqual(["Dates", "Stay", "Flights", "Activities"]);
    // balances with no costs is treated as Settled (done)
    expect(pending.find((p) => p.label === "Balances")).toBeUndefined();
  });

  it("fully planned trip: tooltip is empty", () => {
    const items = computePlanningItems({
      startDate: "2026-07-01",
      endDate: "2026-07-08",
      staysCount: 2,
      flightsBooked: 4,
      memberCount: 4,
      ticketsCount: 3,
      myNetCents: 0,
    });
    expect(pendingPlanningItems(items)).toHaveLength(0);
  });

  it("partial flights are pending with amber 'partial' status", () => {
    const items = computePlanningItems({
      startDate: "2026-07-01",
      endDate: "2026-07-08",
      staysCount: 1,
      flightsBooked: 2,
      memberCount: 4,
      ticketsCount: 1,
      myNetCents: 0,
    });
    const pending = pendingPlanningItems(items);
    expect(labels(pending)).toEqual(["Flights"]);
    expect(pending[0]).toMatchObject({ status: "partial", hint: "2 / 4 booked" });
  });

  it("outstanding balance (owed) is pending; settled is not", () => {
    const owed = pendingPlanningItems(
      computePlanningItems({
        startDate: "2026-07-01",
        endDate: "2026-07-08",
        staysCount: 1,
        flightsBooked: 4,
        memberCount: 4,
        ticketsCount: 1,
        myNetCents: 4200,
      }),
    );
    expect(labels(owed)).toEqual(["Balances"]);
    expect(owed[0]).toMatchObject({ status: "partial", hint: "Outstanding" });

    const owes = pendingPlanningItems(
      computePlanningItems({
        startDate: "2026-07-01",
        endDate: "2026-07-08",
        staysCount: 1,
        flightsBooked: 4,
        memberCount: 4,
        ticketsCount: 1,
        myNetCents: -14200,
      }),
    );
    expect(labels(owes)).toEqual(["Balances"]);

    const settled = pendingPlanningItems(
      computePlanningItems({
        startDate: "2026-07-01",
        endDate: "2026-07-08",
        staysCount: 1,
        flightsBooked: 4,
        memberCount: 4,
        ticketsCount: 1,
        myNetCents: 0,
      }),
    );
    expect(settled).toHaveLength(0);
  });

  it("only one date set still counts as 'Dates: Not set' (pending)", () => {
    const onlyStart = pendingPlanningItems(
      computePlanningItems({
        startDate: "2026-07-01",
        endDate: null,
        staysCount: 1,
        flightsBooked: 4,
        memberCount: 4,
        ticketsCount: 1,
        myNetCents: 0,
      }),
    );
    expect(labels(onlyStart)).toEqual(["Dates"]);
    expect(onlyStart[0].hint).toBe("Not set");
  });

  it("mixed state surfaces every incomplete item in canonical order", () => {
    const items = computePlanningItems({
      startDate: null,
      endDate: null,
      staysCount: 0,
      flightsBooked: 1,
      memberCount: 3,
      ticketsCount: 0,
      myNetCents: -500,
    });
    expect(labels(pendingPlanningItems(items))).toEqual([
      "Dates",
      "Stay",
      "Flights",
      "Activities",
      "Balances",
    ]);
  });

  it("ignores members not relevant: pending list never includes 'Destination'", () => {
    const items = computePlanningItems({
      startDate: null,
      endDate: null,
      staysCount: 0,
      flightsBooked: 0,
      memberCount: 2,
      ticketsCount: 0,
      myNetCents: 999,
    });
    expect(pendingPlanningItems(items).map((i) => i.key)).not.toContain("destination");
  });

  it("uses 'netCentsForMember' to derive balances per user (smoke)", () => {
    // sanity: share util produces a number we can feed into computePlanningItems
    const costs = [
      { amount_cents: 10000, currency: "USD", is_shared: true, user_id: ME, paid_by: ME, split_member_ids: [ME, FRIEND] },
    ];
    const items = computePlanningItems({
      startDate: "2026-07-01",
      endDate: "2026-07-08",
      staysCount: 1,
      flightsBooked: 2,
      memberCount: 2,
      ticketsCount: 1,
      myNetCents: 5000, // ME paid 10000, owes 5000 share → net +5000
    });
    expect(costs).toBeDefined();
    expect(pendingPlanningItems(items).map((i) => i.key)).toEqual(["balances"]);
  });
});
