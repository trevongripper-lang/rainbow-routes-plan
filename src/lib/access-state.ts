/**
 * Access-state derivation for the frictionless-signup rework.
 *
 * The app now has four user tiers, keyed off Supabase Auth flags:
 *
 *   - `signed_out`                       — no session at all.
 *   - `exploring_anonymously`            — anonymous Supabase user (session
 *                                          exists, `is_anonymous = true`).
 *   - `confirmed_permanent_without_consent`
 *                                        — permanent account (`is_anonymous
 *                                          = false`), email confirmed, but
 *                                          missing the current beta consent.
 *   - `confirmed_permanent_with_current_consent`
 *                                        — fully cleared: permanent, email
 *                                          confirmed, current beta consent.
 *
 * We derive this from a Supabase `Session` (or null) plus the app's beta-
 * consent status. Anything that gates behavior on tier — the protected route
 * guard, the pitch-trip flow, invite acceptance, checkout — should read this
 * tier rather than re-deriving it from `session.user` fields directly.
 */
import type { Session, User } from "@supabase/supabase-js";
import type { AppBetaConsentStatus } from "@/lib/auth-state";

export type AccessTier =
  | "signed_out"
  | "exploring_anonymously"
  | "confirmed_permanent_without_consent"
  | "confirmed_permanent_with_current_consent";

export type AccessState = {
  tier: AccessTier;
  /** Anonymous Supabase user — freshly minted or resumed. */
  isAnonymous: boolean;
  /** Email confirmation timestamp on the auth user, if any. */
  emailConfirmedAt: string | null;
  /** True when the user has a permanent account with a confirmed email. */
  isConfirmedPermanent: boolean;
};

/**
 * Pull the anonymous flag off a Supabase user. Supabase exposes this as
 * `is_anonymous` on the user object; some older SDK typings omit it, so we
 * read it defensively without widening the public surface.
 */
export function readIsAnonymous(user: User | null | undefined): boolean {
  if (!user) return false;
  const raw = (user as unknown as { is_anonymous?: unknown }).is_anonymous;
  return raw === true;
}

/**
 * Confirmation timestamp from the user record, if present.
 * `email_confirmed_at` is the authoritative field on Supabase Auth v2.
 */
export function readEmailConfirmedAt(user: User | null | undefined): string | null {
  if (!user) return null;
  const raw = (user as unknown as { email_confirmed_at?: unknown }).email_confirmed_at;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function deriveAccessState(
  session: Session | null | undefined,
  betaConsent: AppBetaConsentStatus,
): AccessState {
  const user = session?.user ?? null;

  if (!session || !user) {
    return {
      tier: "signed_out",
      isAnonymous: false,
      emailConfirmedAt: null,
      isConfirmedPermanent: false,
    };
  }

  const isAnonymous = readIsAnonymous(user);
  const emailConfirmedAt = readEmailConfirmedAt(user);
  const isConfirmedPermanent = !isAnonymous && emailConfirmedAt !== null;

  if (isAnonymous) {
    return {
      tier: "exploring_anonymously",
      isAnonymous: true,
      emailConfirmedAt,
      isConfirmedPermanent: false,
    };
  }

  if (!isConfirmedPermanent) {
    // Permanent account whose email hasn't been confirmed yet. Treat as
    // signed-out for gating; the app should push them through confirmation.
    return {
      tier: "signed_out",
      isAnonymous: false,
      emailConfirmedAt,
      isConfirmedPermanent: false,
    };
  }

  return {
    tier:
      betaConsent === "current"
        ? "confirmed_permanent_with_current_consent"
        : "confirmed_permanent_without_consent",
    isAnonymous: false,
    emailConfirmedAt,
    isConfirmedPermanent: true,
  };
}

/**
 * Compact predicates for gate call-sites — keeps `beforeLoad` readable.
 */
export const canReachProtectedApp = (s: AccessState) =>
  s.tier === "confirmed_permanent_with_current_consent";

export const needsBetaConsent = (s: AccessState) =>
  s.tier === "confirmed_permanent_without_consent";

export const isExploring = (s: AccessState) => s.tier === "exploring_anonymously";
