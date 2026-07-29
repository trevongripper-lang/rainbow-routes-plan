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
const FORBIDDEN_PROP_KEYS = new Set([
  "token_hash",
  "tokenHash",
  "code",
  "access_token",
  "refresh_token",
  "password",
]);

function stripSensitiveProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_PROP_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function track(
  event: string,
  props: Record<string, unknown> = {},
  destinationId?: string | null,
) {
  try {
    const safeProps = stripSensitiveProps(props);
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase.from("analytics_events" as any) as any)
        .insert({
          destination_id: destinationId ?? null,
          event,
          props: safeProps,
        })
        .then(() => {})
        .catch(() => {});
    }).catch(() => {});
  } catch {
    /* noop */
  }
}

