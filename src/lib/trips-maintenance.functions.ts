import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// `auto_close_trips` EXECUTE is restricted to service_role — any signed-in
// user could otherwise trigger a global sweep + notification fanout. We
// still gate this server fn on an authenticated session so it isn't a public
// endpoint, and we invoke the RPC through the admin client (loaded inside
// the handler to keep the server-only module out of the client bundle).
export const closeExpiredTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("auto_close_trips");
    if (error) return { ok: false, closed: 0 };
    return { ok: true, closed: typeof data === "number" ? data : 0 };
  });
