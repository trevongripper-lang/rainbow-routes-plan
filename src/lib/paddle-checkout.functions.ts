import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PaddleCheckoutConfig = {
  clientToken: string;
  environment: "sandbox" | "production";
  priceId: string;
  priceCents: number;
  tier: "tier1" | "tier2" | "tier3";
  customerEmail: string | null;
  customData: { destinationId: string; userId: string };
};

/**
 * Returns everything the client needs to open a Paddle overlay checkout
 * for unlocking a trip. All sensitive config (client token, price IDs)
 * lives in env vars — never hardcoded on the client.
 *
 * Required secrets (Lovable Cloud):
 *   - PADDLE_CLIENT_TOKEN        (sandbox client-side token, "test_..." prefix)
 *   - PADDLE_ENVIRONMENT         "sandbox" | "production" (defaults to "sandbox")
 *   - PADDLE_PRICE_TIER1         price id for 6–10 people  ($4.99)
 *   - PADDLE_PRICE_TIER2         price id for 11–20 people ($9.99)
 *   - PADDLE_PRICE_TIER3         price id for 21+ people   ($19.99)
 */
export const startPaddleCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { destinationId: string }) => d)
  .handler(async ({ data, context }): Promise<PaddleCheckoutConfig> => {
    const { supabase, userId, claims } = context;

    const clientToken = process.env.PADDLE_CLIENT_TOKEN;
    if (!clientToken) throw new Error("Paddle is not configured (missing PADDLE_CLIENT_TOKEN).");
    const environment = (process.env.PADDLE_ENVIRONMENT ?? "sandbox") as
      | "sandbox"
      | "production";

    // Re-quote on the server to determine tier + price authoritatively.
    const { data: dest, error: derr } = await supabase
      .from("destinations")
      .select("id, user_id, headcount, unlock_status")
      .eq("id", data.destinationId)
      .maybeSingle();
    if (derr) throw new Error(derr.message);
    if (!dest) throw new Error("Trip not found");
    if (dest.user_id !== userId) throw new Error("Only the trip owner can unlock");
    if (dest.unlock_status !== "free") throw new Error("This trip is already unlocked");

    const { count: memberCount } = await supabase
      .from("trip_members")
      .select("user_id", { count: "exact", head: true })
      .eq("destination_id", data.destinationId);
    const effective = Math.max(memberCount ?? 0, dest.headcount ?? 0);

    const { data: tierRow } = await supabase.rpc("required_unlock_tier", {
      _members: effective,
    });
    const row = (tierRow as { tier: string | null; cents: number }[] | null)?.[0];
    const tier = row?.tier as "tier1" | "tier2" | "tier3" | null;
    const cents = row?.cents ?? 0;
    if (!tier) throw new Error("This trip is on the free tier — no unlock needed.");

    const priceMap: Record<string, string | undefined> = {
      tier1: process.env.PADDLE_PRICE_TIER1,
      tier2: process.env.PADDLE_PRICE_TIER2,
      tier3: process.env.PADDLE_PRICE_TIER3,
    };
    const priceId = priceMap[tier];
    if (!priceId)
      throw new Error(
        `Paddle price ID for ${tier} is not configured (set PADDLE_PRICE_${tier.toUpperCase()}).`,
      );

    const customerEmail = (claims?.email as string | undefined) ?? null;

    return {
      clientToken,
      environment,
      priceId,
      priceCents: cents,
      tier,
      customerEmail,
      customData: { destinationId: data.destinationId, userId },
    };
  });
