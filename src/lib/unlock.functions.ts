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


export const unlockTripWithCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { destinationId: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // verify owner via authed client (RLS-safe)
    const { data: dest, error: derr } = await context.supabase
      .from("destinations")
      .select("id, user_id, unlock_status")
      .eq("id", data.destinationId)
      .maybeSingle();
    if (derr) throw new Error(derr.message);
    if (!dest) throw new Error("Trip not found");
    if (dest.user_id !== userId) throw new Error("Only the trip owner can unlock");
    if (dest.unlock_status !== "free") return { ok: true, alreadyUnlocked: true };

    // privileged unlock via service role (function EXECUTE is service_role only)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("unlock_destination", {
      _dest: data.destinationId,
      _use_credit: true,
      _paid_cents: 0,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
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
    const nowIso = new Date().toISOString();
    const [{ data: credits }, { data: prof }] = await Promise.all([
      supabase
        .from("user_credits")
        .select("source, remaining, expires_at")
        .eq("user_id", userId)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      supabase.from("profiles").select("paid_trip_count").eq("id", userId).maybeSingle(),
    ]);
    const sumBy = (s: string) =>
      (credits ?? []).filter((c) => c.source === s).reduce((acc, c) => acc + (c.remaining ?? 0), 0);
    const loyalty = sumBy("loyalty");
    const referral = sumBy("referral");
    const promo = sumBy("promo");
    const paid = prof?.paid_trip_count ?? 0;
    return {
      total: loyalty + referral + promo,
      loyaltyRemaining: loyalty,
      referralRemaining: referral,
      promoRemaining: promo,
      paidTripCount: paid,
      loyaltyProgress: paid % 8,
      loyaltyTarget: 8,
    };
  });
