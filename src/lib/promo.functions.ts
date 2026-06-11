import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PromoRedeemResult = {
  credits: number;
  expiresAt: string;
};

export const redeemPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string }) => {
    const code = (d?.code ?? "").trim();
    if (!code) throw new Error("Enter a promo code");
    if (code.length > 64) throw new Error("Code is too long");
    return { code };
  })
  .handler(async ({ data, context }): Promise<PromoRedeemResult> => {
    const { data: res, error } = await context.supabase.rpc("redeem_promo_code", { _code: data.code });
    if (error) throw new Error(error.message);
    const obj = res as { credits: number; expires_at: string };
    return { credits: obj.credits, expiresAt: obj.expires_at };
  });
