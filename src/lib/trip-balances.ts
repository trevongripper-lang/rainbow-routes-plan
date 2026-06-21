// Pure utilities for computing per-member balances from trip costs + settlements.

export type CostRow = {
  amount_cents: number;
  currency: string;
  is_shared: boolean;
  user_id: string;
  paid_by?: string | null;
  split_member_ids?: string[] | null;
};

export type SettlementRow = {
  from_user: string;
  to_user: string;
  amount_cents: number;
  currency: string;
};

/**
 * Compute net balance per user (in cents) from shared costs and settlements.
 * Positive = is owed money. Negative = owes money.
 */
export function computeNetByUser(
  costs: CostRow[],
  settlements: SettlementRow[],
  memberIds: string[],
): Map<string, number> {
  const paid = new Map<string, number>();
  const owed = new Map<string, number>();

  for (const c of costs) {
    if (!c.is_shared) continue;
    const payer = c.paid_by ?? c.user_id;
    paid.set(payer, (paid.get(payer) ?? 0) + c.amount_cents);
    const splitIds = c.split_member_ids && c.split_member_ids.length > 0 ? c.split_member_ids : memberIds;
    const denom = Math.max(1, splitIds.length);
    const share = c.amount_cents / denom;
    for (const uid of splitIds) {
      owed.set(uid, (owed.get(uid) ?? 0) + share);
    }
  }

  const known = new Set<string>([...memberIds, ...paid.keys(), ...owed.keys()]);
  const net = new Map<string, number>();
  for (const id of known) {
    net.set(id, (paid.get(id) ?? 0) - (owed.get(id) ?? 0));
  }

  // Settlements: from_user pays to_user → from's debt decreases (net +), to's credit decreases (net -).
  for (const s of settlements) {
    net.set(s.from_user, (net.get(s.from_user) ?? 0) + s.amount_cents);
    net.set(s.to_user, (net.get(s.to_user) ?? 0) - s.amount_cents);
  }

  return net;
}

export function netForUser(
  costs: CostRow[],
  settlements: SettlementRow[],
  memberIds: string[],
  userId: string,
): number {
  return computeNetByUser(costs, settlements, memberIds).get(userId) ?? 0;
}

export function formatCents(cents: number, currency: string): string {
  const abs = Math.abs(cents) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(abs);
  } catch {
    return `${abs.toFixed(2)} ${currency}`;
  }
}
