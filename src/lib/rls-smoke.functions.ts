import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Tables exposed via the Data API + the helper RPCs RLS depends on.
// If a migration revokes GRANTs (table) or EXECUTE (function), the
// matching row turns red here BEFORE users feel it.
const TABLES = [
  "destinations",
  "trip_members",
  "trip_invites",
  "trip_stays",
  "trip_tickets",
  "trip_flights",
  "trip_costs",
  "trip_events",
  "trip_polls",
  "trip_poll_options",
  "trip_poll_votes",
  "trip_ratings",
  "comments",
  "votes",
  "notifications",
  "events",
  "profiles",
] as const;

const RPCS: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: "is_trip_member", args: { _dest: "00000000-0000-0000-0000-000000000000", _user: "00000000-0000-0000-0000-000000000000" } },
  { name: "is_trip_owner", args: { _dest: "00000000-0000-0000-0000-000000000000", _user: "00000000-0000-0000-0000-000000000000" } },
  { name: "preview_trip_invite", args: { _token: "__smoke__" } },
];

export type SmokeCheck = {
  kind: "table" | "rpc";
  name: string;
  ok: boolean;
  status: number | null;
  code: string | null;
  message: string | null;
  hint: string | null;
  ms: number;
};

export const runRlsSmokeTests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ checks: SmokeCheck[]; ran_at: string; user_id: string }> => {
    const { supabase, userId } = context;

    const tableChecks = await Promise.all(
      TABLES.map<Promise<SmokeCheck>>(async (name) => {
        const start = Date.now();
        // HEAD + count=exact is the cheapest read that still exercises RLS + GRANTs.
        const { error, status } = await supabase
          .from(name)
          .select("*", { count: "exact", head: true })
          .limit(1);
        return {
          kind: "table",
          name,
          ok: !error,
          status: status ?? null,
          code: (error as { code?: string } | null)?.code ?? null,
          message: error?.message ?? null,
          hint: (error as { hint?: string } | null)?.hint ?? null,
          ms: Date.now() - start,
        };
      }),
    );

    const rpcChecks = await Promise.all(
      RPCS.map<Promise<SmokeCheck>>(async ({ name, args }) => {
        const start = Date.now();
        const { error, status } = await supabase.rpc(name as never, args as never);
        // RPC may legitimately return "no rows" / false; only EXECUTE/permission
        // errors are real failures. 42501 = permission denied.
        const code = (error as { code?: string } | null)?.code ?? null;
        const permissionDenied = code === "42501" || /permission denied/i.test(error?.message ?? "");
        return {
          kind: "rpc",
          name,
          ok: !permissionDenied,
          status: status ?? null,
          code,
          message: permissionDenied ? error?.message ?? null : null,
          hint: (error as { hint?: string } | null)?.hint ?? null,
          ms: Date.now() - start,
        };
      }),
    );

    return {
      checks: [...tableChecks, ...rpcChecks],
      ran_at: new Date().toISOString(),
      user_id: userId,
    };
  });
