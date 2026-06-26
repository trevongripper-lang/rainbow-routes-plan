import { describe, it, expect, vi } from "vitest";
import {
  buildTicketAutoCost,
  buildStayAutoCost,
  insertAutoCost,
  type AutoCostInsert,
} from "./auto-cost";

describe("buildTicketAutoCost", () => {
  it("returns null when price is missing or zero (invalid/empty amount)", () => {
    expect(
      buildTicketAutoCost({
        destinationId: "d1",
        me: "u1",
        ticketId: "t1",
        name: "Party",
        priceCents: null,
        currency: "USD",
      }),
    ).toBeNull();
    expect(
      buildTicketAutoCost({
        destinationId: "d1",
        me: "u1",
        ticketId: "t1",
        name: "Party",
        priceCents: 0,
        currency: "USD",
      }),
    ).toBeNull();
  });

  it("builds a Tickets & events cost row with source_kind/id and paid_by=me, is_shared=false", () => {
    const row = buildTicketAutoCost({
      destinationId: "d1",
      me: "u1",
      ticketId: "t1",
      name: "  Opening party  ",
      priceCents: 2500,
      currency: "usd",
    });
    expect(row).toEqual<AutoCostInsert>({
      destination_id: "d1",
      user_id: "u1",
      category: "Tickets & events",
      label: "Opening party",
      amount_cents: 2500,
      currency: "USD",
      is_shared: false,
      paid_by: "u1",
      cost_date: null,
      source_kind: "ticket",
      source_id: "t1",
    });
  });
});

describe("buildStayAutoCost", () => {
  it("returns null without rate or dates", () => {
    const base = {
      destinationId: "d1",
      me: "u1",
      stayId: "s1",
      title: "Hotel",
      currency: "USD",
    };
    expect(
      buildStayAutoCost({
        ...base,
        nightlyRateCents: 0,
        checkIn: "2025-01-01",
        checkOut: "2025-01-03",
      }),
    ).toBeNull();
    expect(
      buildStayAutoCost({ ...base, nightlyRateCents: 1000, checkIn: null, checkOut: "2025-01-03" }),
    ).toBeNull();
  });

  it("multiplies nightly rate by nights and labels with nights count", () => {
    const row = buildStayAutoCost({
      destinationId: "d1",
      me: "u1",
      stayId: "s1",
      title: "Casa Bonita",
      nightlyRateCents: 12000,
      currency: "USD",
      checkIn: "2025-01-01",
      checkOut: "2025-01-04",
      bookedBy: "u2",
    });
    expect(row).toMatchObject({
      category: "Lodging",
      label: "Casa Bonita · 3 nights",
      amount_cents: 36000,
      is_shared: false,
      paid_by: "u2",
      cost_date: "2025-01-01",
      source_kind: "stay",
      source_id: "s1",
    });
  });
});

describe("insertAutoCost", () => {
  const row = buildTicketAutoCost({
    destinationId: "d1",
    me: "u1",
    ticketId: "t1",
    name: "Party",
    priceCents: 2500,
    currency: "USD",
  })!;

  it("returns ok on successful insert", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn(() => ({ insert })) };
    await expect(insertAutoCost(client, row)).resolves.toEqual({ ok: true, duplicate: false });
    expect(client.from).toHaveBeenCalledWith("trip_costs");
    expect(insert).toHaveBeenCalledWith(row);
  });

  it("treats unique-violation (23505) as a duplicate, not an error", async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    const client = { from: vi.fn(() => ({ insert })) };
    await expect(insertAutoCost(client, row)).resolves.toEqual({ ok: true, duplicate: true });
  });

  it("surfaces other errors", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: "42501", message: "RLS denied" } });
    const client = { from: vi.fn(() => ({ insert })) };
    await expect(insertAutoCost(client, row)).resolves.toEqual({
      ok: false,
      error: "RLS denied",
    });
  });
});
