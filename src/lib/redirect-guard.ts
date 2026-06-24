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
