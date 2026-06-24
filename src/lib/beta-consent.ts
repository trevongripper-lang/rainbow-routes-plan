export const BETA_CONSENT_KEY = "tt:beta-consent:v1";
export const BETA_CONSENT_VERSION = 1;

export function hasBetaConsent(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(BETA_CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { v?: number } | null;
    return parsed?.v === BETA_CONSENT_VERSION;
  } catch {
    return false;
  }
}
