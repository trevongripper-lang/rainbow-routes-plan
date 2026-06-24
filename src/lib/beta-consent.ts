import { supabase } from "@/integrations/supabase/client";

export const BETA_CONSENT_VERSION = "2026-06-beta-v1";
export const BETA_CONSENT_KEY = `tt:beta-consent:${BETA_CONSENT_VERSION}`;

type CachedConsent = { v: string; at: string };

export function hasBetaConsentLocal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(BETA_CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as CachedConsent | null;
    return parsed?.v === BETA_CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function cacheBetaConsentLocal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      BETA_CONSENT_KEY,
      JSON.stringify({ v: BETA_CONSENT_VERSION, at: new Date().toISOString() }),
    );
  } catch {
    /* ignore */
  }
}

/** Check DB for current-version consent. Caches result in localStorage when found. */
export async function hasBetaConsentRemote(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("beta_consents")
    .select("id")
    .eq("user_id", userId)
    .eq("version", BETA_CONSENT_VERSION)
    .maybeSingle();
  if (error) return false;
  if (data) {
    cacheBetaConsentLocal();
    return true;
  }
  return false;
}

export async function recordBetaConsent(userId: string): Promise<void> {
  const userAgent =
    typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null;
  await supabase
    .from("beta_consents")
    .insert({ user_id: userId, version: BETA_CONSENT_VERSION, user_agent: userAgent });
  cacheBetaConsentLocal();
}
