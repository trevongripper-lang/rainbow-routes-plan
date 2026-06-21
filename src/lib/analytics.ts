import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget client-side analytics. Inserts into `analytics_events`.
 * RLS allows any signed-in user to insert their own events. Failures are
 * silently swallowed — analytics must never break the UI.
 */
export function track(
  event: string,
  props: Record<string, unknown> = {},
  destinationId?: string | null,
) {
  try {
    void supabase.auth.getUser().then(({ data }) => {
      const user_id = data.user?.id ?? null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase.from("analytics_events" as any) as any)
        .insert({
          user_id,
          destination_id: destinationId ?? null,
          event,
          props,
        })
        .then(() => {});
    });
  } catch {
    /* noop */
  }
}
