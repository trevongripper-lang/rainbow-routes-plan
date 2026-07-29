/**
 * Single source of truth for the Tribe auth-email link contract.
 *
 * Server (email webhook) and client (auth callback) both import this so the
 * verify-otp `type`, allowed action types, and template/link-strategy
 * versions stay in lockstep. If a value here changes, both sides pick it up
 * on the next build.
 */

export const AUTH_EMAIL_ROOT_DOMAIN = "jointribetrips.com";
export const AUTH_EMAIL_CALLBACK_PATH = "/auth/callback";

/** Bump when webhook link generation or the templates change materially. */
export const AUTH_EMAIL_TEMPLATE_VERSION = "2026-07-29.3";
/** Every link-based auth email is a token-hash URL to the Tribe interstitial. */
export const AUTH_EMAIL_LINK_STRATEGY = "tribe_token_hash_interstitial" as const;
/** Reauthentication emails carry a numeric TOTP, no link. */
export const AUTH_EMAIL_TOTP_STRATEGY = "totp_code" as const;

export type AuthActionType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "reauthentication";

/** Action types that must produce a link-based email. */
export const LINK_AUTH_ACTIONS: ReadonlySet<AuthActionType> = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

/**
 * Server action_type → callback `type` query param → verifyOtp `type`.
 * These MUST agree; the callback trusts this map, never the URL value.
 */
export const AUTH_TYPE_MAP: Record<
  Exclude<AuthActionType, "reauthentication">,
  "signup" | "invite" | "magiclink" | "recovery" | "email_change"
> = {
  signup: "signup",
  invite: "invite",
  magiclink: "magiclink",
  recovery: "recovery",
  email_change: "email_change",
};

/** Accepted `type` query values on `/auth/callback`. Anything else falls back to `email`. */
export const ALLOWED_CALLBACK_TYPES = new Set<string>(Object.values(AUTH_TYPE_MAP));

/** Strings that must never appear in a delivered auth email link. */
export const FORBIDDEN_LINK_ARTIFACTS: readonly RegExp[] = [
  /\/auth\/v1\/verify/i,
  /supabase\.co\/auth\/v1\//i,
];

export function isSafeRelativePath(value: string | null | undefined): value is string {
  if (!value) return false;
  return value.startsWith("/") && !value.startsWith("//");
}
