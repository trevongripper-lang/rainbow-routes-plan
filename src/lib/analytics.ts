import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget client-side analytics. Inserts into `analytics_events`.
 *
 * Ownership is assigned server-side by a BEFORE INSERT trigger from
 * `auth.uid()`. The browser must NEVER assert ownership because the local
 * session snapshot can lag behind the request JWT during login / logout /
 * token refresh — that race caused 401/42501 noise. Rules:
 *
 *  - If there is no session, skip entirely (authenticated events require a
 *    valid JWT; anonymous-carve-out events also require an anon session).
 *  - Never send `user_id` in the payload. The trigger fills it from the JWT.
 *  - All failures are swallowed so analytics can never break the UI.
 */
export function track(
  event: string,
  props: Record<string, unknown> = {},
  destinationId?: string | null,
) {
  try {
    void supabase.auth.getSession().then(({ data }) => {
      // Skip when there is no valid session — the trigger would reject it
      // anyway, and doing so avoids a noisy failed request during
      // login/logout/session-replacement windows.
      if (!data.session) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase.from("analytics_events" as any) as any)
        .insert({
          destination_id: destinationId ?? null,
          event,
          props,
        })
        .then(() => {})
        // Never surface analytics failures. In particular, do NOT
        // re-throw during the auth flow — telemetry must not interrupt
        // sign-in / sign-out.
        .catch(() => {});
    }).catch(() => {});
  } catch {
    /* noop */
  }
}
