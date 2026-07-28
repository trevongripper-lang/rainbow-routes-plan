/**
 * Cache-safe OAuth-return marker.
 *
 * Purpose: when the user leaves Tribe for a provider (Google) and returns
 * to `/auth`, we need to know we're mid-OAuth so the login shell is NOT
 * rendered while the SDK is still reconciling tokens → session.
 *
 * Storage: sessionStorage only. Contains no PII, no tokens, no OAuth
 * codes, no full URLs — just provider, correlation id, origin category,
 * browser mode, and start timestamp. Expires after MAX_AGE_MS.
 */

const KEY = "tribe.oauth.pending.v1";
const MAX_AGE_MS = 120_000; // 2 minutes

export type OAuthOriginCategory = "apex" | "www" | "preview" | "sandbox" | "other";
export type BrowserMode = "browser" | "standalone_pwa";

export type OAuthPending = {
  provider: "google" | "apple" | "microsoft" | "lovable";
  cid: string;
  origin: string; // full origin string kept in-memory; not logged in diagnostics
  originCategory: OAuthOriginCategory;
  mode: BrowserMode;
  startedAt: number;
};

function safeSession(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function classifyOrigin(origin: string): OAuthOriginCategory {
  try {
    const host = new URL(origin).hostname;
    if (host === "jointribetrips.com") return "apex";
    if (host === "www.jointribetrips.com") return "www";
    if (/^id-preview--.*\.lovable\.app$/i.test(host)) return "preview";
    if (/(lovableproject\.com|lovable\.app)$/i.test(host)) return "sandbox";
    return "other";
  } catch {
    return "other";
  }
}

export function detectBrowserMode(): BrowserMode {
  if (typeof window === "undefined") return "browser";
  try {
    // iOS Safari
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window.navigator as any).standalone === true) return "standalone_pwa";
    if (window.matchMedia?.("(display-mode: standalone)").matches) return "standalone_pwa";
  } catch {
    /* ignore */
  }
  return "browser";
}

export function markOAuthPending(provider: OAuthPending["provider"], cid: string): OAuthPending {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const entry: OAuthPending = {
    provider,
    cid,
    origin,
    originCategory: classifyOrigin(origin),
    mode: detectBrowserMode(),
    startedAt: Date.now(),
  };
  try {
    safeSession()?.setItem(KEY, JSON.stringify(entry));
  } catch {
    /* ignore quota / private mode */
  }
  return entry;
}

export function readOAuthPending(): OAuthPending | null {
  const s = safeSession();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OAuthPending;
    if (!parsed?.startedAt || Date.now() - parsed.startedAt > MAX_AGE_MS) {
      s.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearOAuthPending(): void {
  try {
    safeSession()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function isOAuthPending(): boolean {
  return readOAuthPending() !== null;
}

/** True iff sessionStorage AND localStorage can both round-trip a value. */
export function isBrowserStorageUsable(): boolean {
  try {
    const ls = window.localStorage;
    const ss = window.sessionStorage;
    const k = "__tribe_storage_probe__";
    ls.setItem(k, "1");
    ls.removeItem(k);
    ss.setItem(k, "1");
    ss.removeItem(k);
    return true;
  } catch {
    return false;
  }
}


/**
 * Standardized public error codes surfaced on the recovery screen and in
 * telemetry. Internal codes from `establishOAuthSession` and the poll loop
 * collapse into this small taxonomy so support can act on them without
 * seeing raw provider strings.
 */
export type OAuthPublicErrorCode =
  | "oauth_token_delivery_missing"
  | "oauth_set_session_failed"
  | "oauth_session_not_persisted"
  | "oauth_origin_mismatch"
  | "oauth_return_poll_timeout"
  | "oauth_storage_unavailable"
  | "oauth_provider_failed";

export function toPublicOAuthErrorCode(internal: string | undefined | null): OAuthPublicErrorCode {
  const code = (internal ?? "").toLowerCase();
  if (!code) return "oauth_provider_failed";
  if (code === "invalid_token_shape") return "oauth_token_delivery_missing";
  if (
    code === "set_session_threw" ||
    code === "set_session_rejected" ||
    code.startsWith("http_") ||
    code === "invalid_grant" ||
    code === "invalid_request"
  ) {
    return "oauth_set_session_failed";
  }
  if (code === "set_session_missing" || code === "session_readback_missing") {
    return "oauth_session_not_persisted";
  }
  if (code === "origin_mismatch") return "oauth_origin_mismatch";
  if (code === "storage_unavailable") return "oauth_storage_unavailable";
  if (code === "oauth_return_poll" || code === "oauth_return_poll_timeout") {
    return "oauth_return_poll_timeout";
  }
  return "oauth_provider_failed";
}

