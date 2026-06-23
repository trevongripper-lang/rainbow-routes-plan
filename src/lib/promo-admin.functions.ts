import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PromoCodeRow = {
  id: string;
  code: string;
  credits: number;
  validity_days: number;
  max_redemptions: number | null;
  redemptions_count: number;
  active: boolean;
  code_expires_at: string | null;
  note: string | null;
  created_at: string;
};

async function assertAdmin(ctx: { supabase: typeof import("@/integrations/supabase/client").supabase; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const checkIsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: Boolean(data) };
  });

export const listPromoCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoCodeRow[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("promo_codes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PromoCodeRow[];
  });

type PromoInput = {
  code: string;
  credits: number;
  validity_days: number;
  max_redemptions: number | null;
  code_expires_at: string | null;
  note: string | null;
};

function validate(input: PromoInput): PromoInput {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code))
    throw new Error("Code must be 3–32 chars (A–Z, 0–9, _ or -)");
  const credits = Number(input.credits);
  if (!Number.isInteger(credits) || credits < 1 || credits > 50)
    throw new Error("Credits must be 1–50");
  const validity_days = Number(input.validity_days);
  if (!Number.isInteger(validity_days) || validity_days < 1 || validity_days > 365)
    throw new Error("Validity must be 1–365 days");
  const max_redemptions =
    input.max_redemptions === null || input.max_redemptions === undefined
      ? null
      : Number(input.max_redemptions);
  if (max_redemptions !== null && (!Number.isInteger(max_redemptions) || max_redemptions < 1))
    throw new Error("Max redemptions must be a positive integer or empty");
  return {
    code,
    credits,
    validity_days,
    max_redemptions,
    code_expires_at: input.code_expires_at || null,
    note: input.note?.trim() || null,
  };
}

export const createPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PromoInput) => validate(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("promo_codes")
      .insert({ ...data, active: true })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as PromoCodeRow;
  });

export const updatePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PromoInput & { id: string }) => ({ id: d.id, ...validate(d) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("promo_codes")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as PromoCodeRow;
  });

export const setPromoCodeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; active: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("promo_codes")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
