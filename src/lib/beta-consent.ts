import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/utils";

export const BETA_CONSENT_VERSION = "2026-06-beta-v1";
export const BETA_CONSENT_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Per-user cache key. Tying the key to userId prevents cross-user
 * bypass on shared/recycled browsers — a previous tester's "accepted"
 * flag must never satisfy a different signed-in user's gate.
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

/**
 * Authoritative consent check. Always consults the DB for the current
 * BETA_CONSENT_VERSION — local cache is never a bypass, only a hint we
 * confirm against persisted state. Returns "error" on lookup failure so
 * the gate can fail closed.
 */
export async function checkBetaConsent(userId: string): Promise<BetaConsentStatus> {
  if (!userId) return "missing";
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("beta_consents")
        .select("id")
        .eq("user_id", userId)
        .eq("version", BETA_CONSENT_VERSION)
        .maybeSingle(),
      BETA_CONSENT_LOOKUP_TIMEOUT_MS,
      "Beta consent lookup",
    );
    if (error) return "error";
    if (data) {
      cacheBetaConsentLocal(userId);
      return "current";
    }
    // No row for this user/version — could be brand-new user OR a stale
    // version after a bump. Either way: require consent.
    clearBetaConsentLocal(userId);
    return "missing";
  } catch {
    return "error";
  }
}

/** @deprecated use {@link checkBetaConsent}. Kept for callers that only need a boolean. */
export async function hasBetaConsentRemote(userId: string): Promise<boolean> {
  return (await checkBetaConsent(userId)) === "current";
}

export async function recordBetaConsent(userId: string): Promise<void> {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null;
  const { error } = await supabase
    .from("beta_consents")
    .insert({ user_id: userId, version: BETA_CONSENT_VERSION, user_agent: userAgent });
  if (error) throw error;
  cacheBetaConsentLocal(userId);
}
