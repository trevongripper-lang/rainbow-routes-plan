/**
 * Canonical production origin for links baked into emails (signup
 * confirmation, password reset, resend). The user might trigger these
 * from a Lovable sandbox/preview host (e.g. `<id>.lovableproject.com`
 * or `id-preview--<id>.lovable.app`) — those hosts sleep, and once they
 * do, clicking the emailed link lands on Lovable's "project not found"
 * page. Rewriting to the production domain avoids that dead-link trap.
 *
 * OAuth `redirect_uri` must stay same-origin, so this helper is only
 * used for email confirmation callbacks.
 */
export const CANONICAL_ORIGIN = "https://jointribetrips.com";

const PREVIEW_HOST_RE = /(lovableproject\.com|lovable\.app)$/i;

export function canonicalEmailOrigin(): string {
  if (typeof window === "undefined") return CANONICAL_ORIGIN;
  try {
    const host = window.location.hostname;
    // Keep the current origin on the production domains (root + www);
    // rewrite anything else that looks like a Lovable sandbox/preview.
    if (host === "jointribetrips.com" || host === "www.jointribetrips.com") {
      return window.location.origin;
    }
    if (PREVIEW_HOST_RE.test(host)) return CANONICAL_ORIGIN;
    return window.location.origin;
  } catch {
    return CANONICAL_ORIGIN;
  }
}
