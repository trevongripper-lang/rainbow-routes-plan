// Pure helpers for auto-creating a trip_costs row from another trip item
// (ticket, stay, etc.). Keep this UI-free and side-effect-free so it can be
// unit-tested without mocking Supabase.

import { differenceInCalendarDays, parseISO } from "date-fns";

export type AutoCostSourceKind = "ticket" | "stay";

export type AutoCostInsert = {
  destination_id: string;
  user_id: string;
  category: string;
  label: string;
  amount_cents: number;
  currency: string;
  is_shared: boolean;
  paid_by: string;
  cost_date: string | null;
  source_kind: AutoCostSourceKind;
  source_id: string;
};

export type BuildTicketCostInput = {
  destinationId: string;
  me: string;
  ticketId: string;
  name: string;
  priceCents: number | null;
  currency: string | null;
};

export type BuildStayCostInput = {
  destinationId: string;
  me: string;
  stayId: string;
  title: string;
  nightlyRateCents: number | null;
  currency: string | null;
  checkIn: string | null;
  checkOut: string | null;
  bookedBy?: string | null;
};

/** Returns null if there's no usable amount to record. */
export function buildTicketAutoCost(i: BuildTicketCostInput): AutoCostInsert | null {
  if (!i.priceCents || i.priceCents <= 0) return null;
  return {
    destination_id: i.destinationId,
    user_id: i.me,
    category: "Tickets & events",
    label: i.name.trim() || "Ticket",
    amount_cents: i.priceCents,
    currency: (i.currency || "USD").toUpperCase().slice(0, 3),
    is_shared: false,
    paid_by: i.me,
    cost_date: null,
    source_kind: "ticket",
    source_id: i.ticketId,
  };
}

/** Returns null if rate or dates are missing/invalid. */
export function buildStayAutoCost(i: BuildStayCostInput): AutoCostInsert | null {
  if (!i.nightlyRateCents || i.nightlyRateCents <= 0) return null;
  if (!i.checkIn || !i.checkOut) return null;
  let nights: number;
  try {
    nights = Math.max(1, differenceInCalendarDays(parseISO(i.checkOut), parseISO(i.checkIn)));
  } catch {
    return null;
  }
  const total = i.nightlyRateCents * nights;
  if (!Number.isFinite(total) || total <= 0) return null;
  return {
    destination_id: i.destinationId,
    user_id: i.me,
    category: "Lodging",
    label: `${i.title.trim() || "Stay"} · ${nights} ${nights === 1 ? "night" : "nights"}`,
    amount_cents: total,
    currency: (i.currency || "USD").toUpperCase().slice(0, 3),
    is_shared: false,
    paid_by: i.bookedBy || i.me,
    cost_date: i.checkIn,
    source_kind: "stay",
    source_id: i.stayId,
  };
}

export type AutoCostResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; error: string };

// Minimal shape we need from a Supabase-like client. Kept loose on purpose so
// the real supabase client (with deep generics) and a vi.fn() mock both fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MinimalInserter = { from: (table: "trip_costs") => { insert: (row: AutoCostInsert) => any } };

/**
 * Insert an auto-generated cost. Treats unique-violation on
 * (source_kind, source_id) as a successful duplicate (no-op),
 * so retries and double-submits never create extra rows.
 */
export async function insertAutoCost(
  client: MinimalInserter,
  row: AutoCostInsert,
): Promise<AutoCostResult> {
  const res = (await client.from("trip_costs").insert(row)) as {
    error: { code?: string; message: string } | null;
  };
  const error = res?.error ?? null;
  if (!error) return { ok: true, duplicate: false };
  if (error.code === "23505") return { ok: true, duplicate: true };
  return { ok: false, error: error.message };
}
