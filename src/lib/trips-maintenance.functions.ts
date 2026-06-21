import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const closeExpiredTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("auto_close_trips");
    if (error) return { ok: false, closed: 0 };
    return { ok: true, closed: typeof data === "number" ? data : 0 };
  });
