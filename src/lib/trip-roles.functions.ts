import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TripRole = "owner" | "co_organizer" | "member";

export const setTripMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { destinationId: string; userId: string; role: "co_organizer" | "member" }) => {
      if (!data?.destinationId || !data?.userId) throw new Error("Missing arguments");
      if (data.role !== "co_organizer" && data.role !== "member") {
        throw new Error("Role must be co_organizer or member");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_trip_member_role", {
      _dest: data.destinationId,
      _user: data.userId,
      _role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
