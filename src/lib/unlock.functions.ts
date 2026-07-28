import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UnlockQuote = {
  destinationId: string;
  members: number;
  tier: "tier1" | "tier2" | "tier3" | null;
  priceCents: number;
  status: "free" | "paid" | "credited";
  creditsAvailable: number;
  dueCents: number;
  isOwner: boolean;
};

export const quoteUnlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { destinationId: string }) => d)
  .handler(async ({ data, context }): Promise<UnlockQuote> => {
    try {
      const { supabase, userId } = context;

      const { data: dest, error: derr } = await supabase
        .from("destinations")
        .select("id, user_id, headcount, unlock_status")
        .eq("id", data.destinationId)
        .maybeSingle();
      if (derr) throw new Error(derr.message);
      if (!dest) throw new Error("Trip not found");

      const { count: memberCount } = await supabase
        .from("trip_members")
        .select("user_id", { count: "exact", head: true })
        .eq("destination_id", data.destinationId);
      const members = memberCount ?? 0;
      const effective = Math.max(members, dest.headcount ?? 0);

      const { data: tierRow } = await supabase.rpc("required_unlock_tier", { _members: effective });
      const tier = (tierRow as { tier: string | null; cents: number }[] | null)?.[0]?.tier ?? null;
      const cents = (tierRow as { tier: string | null; cents: number }[] | null)?.[0]?.cents ?? 0;

      let credits = 0;
      if (dest.user_id === userId) {
        const { data: rows } = await supabase
          .from("user_credits")
          .select("remaining")
          .eq("user_id", userId);
        credits = (rows ?? []).reduce((s, r) => s + (r.remaining ?? 0), 0);
      }

      const status = dest.unlock_status as "free" | "paid" | "credited";
      const needsPayment = status === "free" && tier !== null;
      const dueCents = needsPayment ? (credits > 0 ? 0 : cents) : 0;

      return {
        destinationId: data.destinationId,
        members,
        tier: tier as UnlockQuote["tier"],
        priceCents: cents,
        status,
        creditsAvailable: credits,
        dueCents,
        isOwner: dest.user_id === userId,
      };
    } catch (err) {
      console.error("[quoteUnlock] failed", { destinationId: data.destinationId, err });
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

/**
 * Credit-path unlock.
 *
 * Delegates the entire ownership check + payments-flag check + credit-row lock
 * + destination lock + spend + credited-unlock into a single authenticated
 * RPC (public.unlock_destination_with_credit) that uses auth.uid() internally.
 * The RPC concurrency guarantees make repeated or racing calls idempotent —
 * one credit spent, one destination marked credited, `already` short-circuit
 * for later calls.
 *
 * The RPC also enforces the payments_enabled() flag server-side; a disabled
 * flag surfaces as a 'payments_disabled' error before any credit is spent.
 */
export const unlockTripWithCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { destinationId: string }) => d)
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = context.supabase.rpc as unknown as (fn: string, args: unknown) => Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;
    const { data: result, error } = await rpc("unlock_destination_with_credit", {
      _dest: data.destinationId,
    });
    if (error) throw new Error(error.message);
    const parsed = (result ?? {}) as { status?: string; already?: boolean };
    return {
      ok: true,
      alreadyUnlocked: parsed.already === true,
      status: parsed.status ?? "credited",
    };
  });

export type CreditsSummary = {
  total: number;
  loyaltyRemaining: number;
  referralRemaining: number;
  promoRemaining: number;
  paidTripCount: number;
  loyaltyProgress: number;
  loyaltyTarget: 8;
};

export const getMyCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CreditsSummary> => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("user_credits")
      .select("source, remaining")
      .eq("user_id", userId);
    const bySource = (src: string) =>
      (rows ?? []).filter((r) => r.source === src).reduce((s, r) => s + (r.remaining ?? 0), 0);
    const total = (rows ?? []).reduce((s, r) => s + (r.remaining ?? 0), 0);

    const { data: profile } = await supabase
      .from("profiles")
      .select("paid_trip_count")
      .eq("id", userId)
      .maybeSingle();
    const paid = profile?.paid_trip_count ?? 0;
    return {
      total,
      loyaltyRemaining: bySource("loyalty"),
      referralRemaining: bySource("referral"),
      promoRemaining: bySource("promo"),
      paidTripCount: paid,
      loyaltyProgress: paid % 8,
      loyaltyTarget: 8,
    };
  });
