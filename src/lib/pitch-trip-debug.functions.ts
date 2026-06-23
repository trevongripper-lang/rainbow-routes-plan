import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Debug endpoint for the destinations insert flow.
 *
 * Returns:
 *  - resolved_user_id: user id extracted from the bearer JWT by requireSupabaseAuth
 *  - claims: verified JWT claims
 *  - sub_matches_user_id: should always be true
 *  - rls: how the destinations insert is currently authorized
 *  - postgrest_probe.user_client: what `auth.uid()` / `auth.role()` look like
 *      when PostgREST runs SQL via the user-scoped supabase client. This is
 *      what an RLS `WITH CHECK (auth.uid() = user_id)` policy actually sees.
 *  - postgrest_probe.admin_client: same probe via the service-role client
 *      (auth.uid() should be NULL — RLS is bypassed).
 *  - destinations_policies: the live policies on public.destinations.
 */

type AuthProbe = {
  auth_uid: string | null;
  auth_role: string | null;
  current_db_user: string | null;
};

export const debugPitchTripAuth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    async function probe(client: {
      rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    }): Promise<AuthProbe | { error: string }> {
      const { data, error } = await client.rpc("debug_whoami");
      if (error) return { error: error.message };
      const rows = data as AuthProbe[] | null;
      const row = Array.isArray(rows) ? rows[0] : null;
      return row ?? { error: "no row returned" };
    }

    const user_client_probe = await probe(
      supabase as unknown as {
        rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
      },
    );
    const admin_client_probe = await probe(
      supabaseAdmin as unknown as {
        rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
      },
    );

    return {
      resolved_user_id: userId,
      claims: {
        sub: claims?.sub,
        email: (claims as { email?: string })?.email,
        role: (claims as { role?: string })?.role,
        aud: (claims as { aud?: string })?.aud,
        iss: (claims as { iss?: string })?.iss,
        exp: (claims as { exp?: number })?.exp,
      },
      sub_matches_user_id: claims?.sub === userId,
      rls: {
        table: "destinations",
        operation: "INSERT",
        active_client: "supabaseAdmin (service_role — RLS bypassed)",
        trusted_user_id_source: "verified JWT (context.userId)",
        policy_when_rls_applies: "auth.uid() = user_id",
      },
      postgrest_probe: {
        user_client: user_client_probe,
        admin_client: admin_client_probe,
        diagnosis:
          "user_client should show auth_uid == resolved_user_id and auth_role='authenticated'. " +
          "If auth_uid is NULL there, the bearer isn't reaching PostgREST as the user — that's why " +
          "an RLS-respecting insert was failing and we switched to the service-role client.",
      },
    };
  });
