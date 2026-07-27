/**
 * Sanitize a same-origin return path for use as a post-auth `redirect`
 * search param. Callers must never pass raw `location.href` into a redirect
 * — that leaks arbitrary origins/hosts/hashes into the auth flow.
 *
 * Accepts only a leading-slash pathname (+ optional search). Anything else
 * (absolute URLs, scheme-relative `//host`, `javascript:`, missing slash,
 * traversal) collapses to the app default.
 */
export const DEFAULT_RETURN_PATH = "/trips";

const SAFE_PATH_RE = /^\/[A-Za-z0-9._~\-/%?&=@:+,;!$'()*]*$/;

export function sanitizeReturnPath(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_RETURN_PATH;
  let value = input.trim();
  if (value.length === 0) return DEFAULT_RETURN_PATH;

  // Reject scheme-relative and protocol URLs outright.
  if (value.startsWith("//")) return DEFAULT_RETURN_PATH;
  if (/^[a-z][a-z0-9+.\-]*:/i.test(value)) return DEFAULT_RETURN_PATH;

  // Must be a rooted path.
  if (!value.startsWith("/")) return DEFAULT_RETURN_PATH;

  // Strip any hash — never round-trip fragments through auth.
  const hashIdx = value.indexOf("#");
  if (hashIdx >= 0) value = value.slice(0, hashIdx);

  // Only permit pathname + search characters.
  if (!SAFE_PATH_RE.test(value)) return DEFAULT_RETURN_PATH;

  // Reject path traversal.
  const pathnameOnly = value.split("?")[0] ?? "";
  if (pathnameOnly.split("/").some((seg) => seg === "..")) return DEFAULT_RETURN_PATH;

  // Never send the user back to an auth-related route (avoids loops).
  if (
    pathnameOnly === "/auth" ||
    pathnameOnly.startsWith("/auth/") ||
    pathnameOnly === "/reset-password" ||
    pathnameOnly === "/beta-consent"
  ) {
    return DEFAULT_RETURN_PATH;
  }

  return value;
}

/** Convenience: sanitize `pathname + search` from a router location. */
export function sanitizeRouterLocation(loc: { pathname?: string; search?: string } | null | undefined): string {
  if (!loc) return DEFAULT_RETURN_PATH;
  const p = loc.pathname ?? "";
  const s = loc.search ?? "";
  return sanitizeReturnPath(`${p}${s}`);
}
