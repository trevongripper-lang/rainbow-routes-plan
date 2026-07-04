import { track } from "@/lib/analytics";

/**
 * Detects redirect ping-pong between auth gates (/auth ↔ /beta-consent ↔ /trips).
 * Uses sessionStorage so the counter resets per tab. If the same path is hit
 * more than `LIMIT` times in `WINDOW_MS`, returns true so the gate can break
 * the loop and route to /recover.
 */
const KEY = "tt:redirect-trace";
const LIMIT = 8;
const WINDOW_MS = 4_000;

type Hit = { path: string; at: number };

export function noteRedirect(from: string, to: string) {
  if (typeof window === "undefined") return false;
  try {
    const now = Date.now();
    const raw = window.sessionStorage.getItem(KEY);
    const hits: Hit[] = raw ? (JSON.parse(raw) as Hit[]) : [];
    const recent = hits.filter((h) => now - h.at < WINDOW_MS);
    recent.push({ path: `${from}->${to}`, at: now });
    window.sessionStorage.setItem(KEY, JSON.stringify(recent.slice(-20)));
    if (recent.length > LIMIT) {
      track("consent_redirect_loop_detected", {
        count: recent.length,
        recent: recent.slice(-6).map((h) => h.path),
      });
      window.sessionStorage.removeItem(KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function clearRedirectTrace() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/**
 * Validate a candidate post-auth redirect path. Only allows same-origin
 * absolute paths and rejects known-unsafe targets (external URLs, auth
 * pages, consent gate). Returns the fallback when the input is unsafe.
 */
export function sanitizeRedirectPath(input: unknown, opts: { fallback?: string } = {}): string {
  const fallback = opts.fallback ?? "/trips";
  if (typeof input !== "string") return fallback;
  const s = input.trim();
  if (!s) return fallback;
  // must be a same-origin absolute path
  if (!s.startsWith("/")) return fallback;
  // protocol-relative "//host/…" would be cross-origin
  if (s.startsWith("//")) return fallback;
  // backslash tricks
  if (s.includes("\\")) return fallback;
  // never bounce back to auth/consent — that creates loops
  if (s === "/auth" || s.startsWith("/auth/") || s.startsWith("/auth?")) return fallback;
  if (s === "/beta-consent" || s.startsWith("/beta-consent?")) return fallback;
  if (s === "/recover" || s.startsWith("/recover?")) return fallback;
  return s;
}

/** Session-storage key for a redirect the auth page should honor after sign-in. */
export const PENDING_REDIRECT_KEY = "tt.pendingRedirect";

export function stashPendingRedirect(path: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_REDIRECT_KEY, path);
  } catch {
    /* noop */
  }
}

export function consumePendingRedirect(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(PENDING_REDIRECT_KEY);
    if (v) window.sessionStorage.removeItem(PENDING_REDIRECT_KEY);
    return v;
  } catch {
    return null;
  }
}
