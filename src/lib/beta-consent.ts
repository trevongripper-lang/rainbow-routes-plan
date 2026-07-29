import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/utils";

/**
 * Client-side cache-key version. Bumped when we intentionally invalidate
 * every browser cache for the consent status. The *authoritative* version
 * lives in `public.app_config.beta_consent_version`; the RPC
 * `my_consent_status()` compares that server-side, so the client never
 * hard-codes the DB version. This constant is only used to salt the
 * localStorage cache key so a rollout can force re-consent without
 * mutating any DB rows.
 */
export const BETA_CONSENT_VERSION = "2026-06-beta-v1";
export const BETA_CONSENT_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Per-user cache key. Tying the key to userId prevents cross-user bypass
 * on shared/recycled browsers — a previous tester's "accepted" flag must
 * never satisfy a different signed-in user's gate.
 */
export function betaConsentCacheKey(userId: string): string {
  return `tt:beta-consent:${BETA_CONSENT_VERSION}:${userId}`;
}

type CachedConsent = { v: string; uid: string; at: string };

export function hasBetaConsentLocal(userId: string): boolean {
  if (typeof window === "undefined" || !userId) return false;
  try {
    const raw = window.localStorage.getItem(betaConsentCacheKey(userId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as CachedConsent | null;
    return parsed?.v === BETA_CONSENT_VERSION && parsed?.uid === userId;
  } catch {
    return false;
  }
}

export function cacheBetaConsentLocal(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(
      betaConsentCacheKey(userId),
      JSON.stringify({
        v: BETA_CONSENT_VERSION,
        uid: userId,
        at: new Date().toISOString(),
      } satisfies CachedConsent),
    );
  } catch {
    /* ignore */
  }
}

export function clearBetaConsentLocal(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.removeItem(betaConsentCacheKey(userId));
  } catch {
    /* ignore */
  }
}

export type BetaConsentStatus = "current" | "missing" | "error";

function betaConsentDebug(message: string, details: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.info("[beta-consent]", message, details);
}

/**
 * Authoritative consent check.
 *
 * Uses the security-definer RPC `public.my_consent_status()`, which
 * compares the caller's most recent `beta_consents` row against
 * `app_config.beta_consent_version` server-side. This means the client
 * cannot bypass a consent-version bump by holding a stale cache, and it
 * doesn't need to know the DB-side version string at all.
 *
 * FAIL-CLOSED: on any RPC error (network, RLS, timeout) we return
 * `"error"` so the protected gate refuses to grant access.
 */
export async function checkBetaConsent(userId: string): Promise<BetaConsentStatus> {
  if (!userId) return "missing";
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () =>
    Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);

  try {
    betaConsentDebug("rpc:my_consent_status started");
    const { data, error } = await withTimeout(
      supabase.rpc("my_consent_status"),
      BETA_CONSENT_LOOKUP_TIMEOUT_MS,
      "Beta consent lookup",
    );

    if (error) {
      betaConsentDebug("rpc:my_consent_status error", {
        elapsedMs: elapsed(),
        message: error.message,
        code: error.code,
      });
      // Local cache is a hint only — never a bypass on RPC failure.
      clearBetaConsentLocal(userId);
      return "error";
    }

    if (data === true) {
      cacheBetaConsentLocal(userId);
      betaConsentDebug("rpc:my_consent_status current", { elapsedMs: elapsed() });
      return "current";
    }

    // data === false OR null → no current-version row for this user.
    clearBetaConsentLocal(userId);
    betaConsentDebug("rpc:my_consent_status missing", { elapsedMs: elapsed() });
    return "missing";
  } catch (error) {
    betaConsentDebug("rpc:my_consent_status threw", {
      elapsedMs: elapsed(),
      message: error instanceof Error ? error.message : String(error),
    });
    // Fail-closed. Do not consult the local cache on exception.
    clearBetaConsentLocal(userId);
    return "error";
  }
}

/** @deprecated use {@link checkBetaConsent}. Kept for callers that only need a boolean. */
export async function hasBetaConsentRemote(userId: string): Promise<boolean> {
  return (await checkBetaConsent(userId)) === "current";
}

/**
 * Record beta consent for the current user against the server-authoritative
 * version. We read the version from `app_config` right before insert so a
 * simultaneous rollout doesn't create a row against a soon-to-be-stale
 * version string.
 */
export async function recordBetaConsent(userId: string): Promise<void> {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null;

  // Fetch the server-authoritative version via security-definer helper so
  // clients don't have to hard-code it and rollouts stay atomic.
  const { data: versionRaw, error: versionErr } = await supabase.rpc(
    "current_consent_version",
  );
  if (versionErr) throw versionErr;
  const version = typeof versionRaw === "string" && versionRaw.length > 0 ? versionRaw : null;
  if (!version) throw new Error("Consent version is not configured.");

  const { error } = await supabase
    .from("beta_consents")
    .insert({ user_id: userId, version, user_agent: userAgent });
  if (error) throw error;
  cacheBetaConsentLocal(userId);
}
