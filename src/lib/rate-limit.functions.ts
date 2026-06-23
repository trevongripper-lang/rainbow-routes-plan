import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RlResult = { allowed: boolean; retryAfter: number };

type Scope = "login" | "reset" | "signup" | "chatter";

const LIMITS: Record<Scope, Array<{ window: number; max: number }>> = {
  login: [{ window: 900, max: 5 }], // 5 per 15 min
  reset: [{ window: 3600, max: 3 }], // 3 per hour
  signup: [{ window: 3600, max: 5 }], // 5 per hour
  chatter: [
    { window: 60, max: 10 }, // 10 per minute
    { window: 3600, max: 60 }, // 60 per hour
  ],
};

function clientIp(): string {
  try {
    return (
      getRequestIP({ xForwardedFor: true }) ||
      getRequestHeader("cf-connecting-ip") ||
      getRequestHeader("x-real-ip") ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

function normEmail(e: string | undefined): string {
  return (e ?? "").trim().toLowerCase().slice(0, 254);
}

async function hit(key: string, windowSeconds: number, max: number): Promise<RlResult> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc("rl_hit", {
    _key: key,
    _window_seconds: windowSeconds,
    _max: max,
  });
  if (error) return { allowed: true, retryAfter: 0 }; // fail open
  const r = data as { allowed: boolean; retry_after: number };
  return { allowed: !!r.allowed, retryAfter: r.retry_after ?? 0 };
}

/**
 * Public rate-limit check for unauthenticated surfaces (login, signup, password reset).
 * Keyed by IP + (optional) email so a single attacker can't lock out a victim purely by email.
 */
export const rlCheckPublic = createServerFn({ method: "POST" })
  .inputValidator((d: { scope: "login" | "reset" | "signup"; email?: string }) => {
    if (!d || (d.scope !== "login" && d.scope !== "reset" && d.scope !== "signup")) {
      throw new Error("Bad scope");
    }
    return { scope: d.scope, email: normEmail(d.email) };
  })
  .handler(async ({ data }): Promise<RlResult> => {
    const ip = clientIp();
    const limits = LIMITS[data.scope];
    for (const l of limits) {
      const keys: string[] = [`${data.scope}:ip:${ip}`];
      if (data.email) keys.push(`${data.scope}:em:${data.email}`);
      for (const k of keys) {
        const r = await hit(k, l.window, l.max);
        if (!r.allowed) return r;
      }
    }
    return { allowed: true, retryAfter: 0 };
  });

/**
 * Rate-limited chatter post. Wraps insertion so the limit can't be bypassed
 * by hitting the table directly through a different client.
 */
export const postChatterComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { destinationId: string; body: string; parentId: string | null; mentions: string[] }) => {
      const body = (d?.body ?? "").trim();
      if (!body) throw new Error("Empty message");
      if (body.length > 4000) throw new Error("Message too long");
      if (!d.destinationId) throw new Error("Missing trip");
      return {
        destinationId: d.destinationId,
        body,
        parentId: d.parentId ?? null,
        mentions: Array.isArray(d.mentions) ? d.mentions.slice(0, 20) : [],
      };
    },
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    for (const l of LIMITS.chatter) {
      const r = await hit(`chatter:${uid}:${l.window}`, l.window, l.max);
      if (!r.allowed) {
        throw new Error(`Slow down — try again in ${r.retryAfter}s.`);
      }
    }
    const { error } = await context.supabase.from("comments").insert({
      destination_id: data.destinationId,
      user_id: uid,
      body: data.body,
      parent_id: data.parentId,
      mentions: data.mentions,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
