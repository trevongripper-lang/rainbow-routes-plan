import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Debug endpoint for the destinations insert flow.
 *
 * Returns:
 *  - resolved_user_id: the user id extracted from the bearer JWT by requireSupabaseAuth
 *  - claims: the verified JWT claims
 *  - rls: a summary of how the destinations insert is currently authorized
 *  - postgrest_auth_uid: what `auth.uid()` evaluates to when PostgREST runs a query
 *      with the user-scoped supabase client (this is what RLS WITH CHECK sees)
 *  - admin_auth_uid: same probe via the service-role client (should be NULL — RLS bypassed)
 *  - destinations_insert_policy: the live INSERT policy on public.destinations
 */
export const debugPitchTripAuth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;

    // What auth.uid() resolves to when the user-scoped PostgREST client runs SQL.
    // If this is NULL while userId is set, the bearer token isn't reaching
    // PostgREST as the auth user → RLS will reject `auth.uid() = user_id`.
    let postgrest_auth_uid: string | null = null;
    let postgrest_auth_role: string | null = null;
    let postgrest_probe_error: string | null = null;
    try {
      const { data, error } = await supabase.rpc("rl_hit", {
        _key: `__debug_noop_${userId}`,
        _window_seconds: 1,
        _max: 999999,
      });
      // rl_hit doesn't return auth context, so call a tiny inline SQL via PostgREST instead.
      void data;
      if (error) postgrest_probe_error = error.message;
    } catch (e) {
      postgrest_probe_error = e instanceof Error ? e.message : String(e);
    }

    // Direct probes via the user-scoped client and the admin client.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    type AuthProbe = { auth_uid: string | null; auth_role: string | null };
    async function probe(client: typeof supabase): Promise<AuthProbe | { error: string }> {
      const { data, error } = await client
        .rpc("rl_hit", { _key: "__probe_ignore", _window_seconds: 1, _max: 999999 });
      void data;
      // Use a SELECT against a values clause through the rest endpoint via rpc isn't enough;
      // call our own function below.
      const { data: who, error: whoErr } = await client.rpc("debug_whoami");
      if (whoErr) return { error: (error?.message ?? "") + " | " + whoErr.message };
      return who as AuthProbe;
    }

    const user_client_probe = await probe(supabase);
    const admin_client_probe = await probe(supabaseAdmin as unknown as typeof supabase);

    if (user_client_probe && "auth_uid" in user_client_probe) {
      postgrest_auth_uid = user_client_probe.auth_uid;
      postgrest_auth_role = user_client_probe.auth_role;
    }

    // Read the live INSERT policy so we don't drift from what Postgres actually enforces.
    const { data: policyRows, error: policyErr } = await supabaseAdmin
      .from("pg_policies" as never)
      .select("policyname, cmd, roles, qual, with_check")
      .eq("tablename", "destinations");

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
        live_policies: policyErr ? { error: policyErr.message } : policyRows,
      },
      postgrest_probe: {
        user_client: user_client_probe,
        admin_client: admin_client_probe,
        postgrest_auth_uid,
        postgrest_auth_role,
        error: postgrest_probe_error,
      },
    };
  });
