import {
  ALLOWED_CALLBACK_TYPES,
  AUTH_EMAIL_CALLBACK_PATH,
  AUTH_EMAIL_LINK_STRATEGY,
  AUTH_EMAIL_ROOT_DOMAIN,
  AUTH_EMAIL_TOTP_STRATEGY,
  AUTH_TYPE_MAP,
  FORBIDDEN_LINK_ARTIFACTS,
  LINK_AUTH_ACTIONS,
  isSafeRelativePath,
  type AuthActionType,
} from "@/lib/auth-email-contract";

const EXPECTED_CALLBACK_URL_PREFIX = `https://${AUTH_EMAIL_ROOT_DOMAIN}${AUTH_EMAIL_CALLBACK_PATH}`;
const TOKEN_RELATED_FIELD_NAMES = [
  "token_hash",
  "tokenHash",
  "hashed_token",
  "hashedToken",
  "token",
  "url",
  "confirmation_url",
] as const;

export type TokenExtractionDiagnostics = {
  token_related_fields_present: string[];
  provider_url_present: boolean;
  provider_url_origin_matches?: boolean;
  provider_url_path_matches?: boolean;
  provider_url_has_token?: boolean;
  provider_url_token_pkce_prefix?: boolean;
  provider_url_type_matches_action?: boolean;
};

export type TokenExtractionResult =
  | {
      ok: true;
      source: "explicit_token_hash" | "provider_verify_url_token";
      tokenHash: string;
      diagnostics: TokenExtractionDiagnostics;
    }
  | {
      ok: false;
      reason:
        | "unsupported_action_type"
        | "invalid_token_hash"
        | "missing_token_hash"
        | "invalid_provider_url"
        | "provider_url_origin_mismatch"
        | "provider_url_path_mismatch"
        | "provider_url_missing_token"
        | "provider_url_invalid_token"
        | "provider_url_type_mismatch";
      diagnostics: TokenExtractionDiagnostics;
    };

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function configuredAuthOrigin(configuredUrl: string | undefined | null): string | null {
  if (!configuredUrl) return null;
  try {
    return new URL(configuredUrl).origin;
  } catch {
    return null;
  }
}

export function tokenRelatedFieldNames(data: Record<string, unknown>): string[] {
  return TOKEN_RELATED_FIELD_NAMES.filter((field) => data[field] !== undefined);
}

export function isValidTokenHash(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 8 || value.length > 2048) return false;
  if (/\s|[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (FORBIDDEN_LINK_ARTIFACTS.some((re) => re.test(value))) return false;
  return /^[A-Za-z0-9._~-]+$/.test(value);
}

export function extractAuthEmailTokenHash(
  data: Record<string, unknown>,
  actionType: string,
  expectedProviderOrigin: string | null,
): TokenExtractionResult {
  const diagnostics: TokenExtractionDiagnostics = {
    token_related_fields_present: tokenRelatedFieldNames(data),
    provider_url_present: typeof data.url === "string" || typeof data.confirmation_url === "string",
  };

  const callbackType = AUTH_TYPE_MAP[actionType as keyof typeof AUTH_TYPE_MAP];
  if (!callbackType || !ALLOWED_CALLBACK_TYPES.has(callbackType)) {
    return { ok: false, reason: "unsupported_action_type", diagnostics };
  }

  const direct = firstString(data.token_hash, data.tokenHash, data.hashed_token, data.hashedToken);
  if (direct) {
    if (!isValidTokenHash(direct)) {
      return { ok: false, reason: "invalid_token_hash", diagnostics };
    }
    return { ok: true, source: "explicit_token_hash", tokenHash: direct, diagnostics };
  }

  const rawUrl = firstString(data.url, data.confirmation_url);
  if (!rawUrl) return { ok: false, reason: "missing_token_hash", diagnostics };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_provider_url", diagnostics };
  }

  diagnostics.provider_url_origin_matches = Boolean(
    expectedProviderOrigin && parsed.origin === expectedProviderOrigin,
  );
  if (!diagnostics.provider_url_origin_matches) {
    return { ok: false, reason: "provider_url_origin_mismatch", diagnostics };
  }

  diagnostics.provider_url_path_matches = parsed.pathname === "/auth/v1/verify";
  if (!diagnostics.provider_url_path_matches) {
    return { ok: false, reason: "provider_url_path_mismatch", diagnostics };
  }

  const urlType = parsed.searchParams.get("type");
  diagnostics.provider_url_type_matches_action = !urlType || urlType === actionType;
  if (!diagnostics.provider_url_type_matches_action) {
    return { ok: false, reason: "provider_url_type_mismatch", diagnostics };
  }

  const token = parsed.searchParams.get("token");
  diagnostics.provider_url_has_token = Boolean(token);
  diagnostics.provider_url_token_pkce_prefix = Boolean(token?.startsWith("pkce_"));
  if (!token) return { ok: false, reason: "provider_url_missing_token", diagnostics };
  if (!isValidTokenHash(token)) {
    return { ok: false, reason: "provider_url_invalid_token", diagnostics };
  }

  return { ok: true, source: "provider_verify_url_token", tokenHash: token, diagnostics };
}

export function extractSafeRedirectPath(data: Record<string, unknown>): string | undefined {
  const direct = firstString(data.redirect_to, data.redirectTo);
  if (isSafeRelativePath(direct)) return direct;

  const rawUrl = firstString(data.url);
  if (!rawUrl) return undefined;
  try {
    const redirectTo = new URL(rawUrl).searchParams.get("redirect_to");
    if (!redirectTo) return undefined;
    const parsed = new URL(redirectTo);
    if (
      parsed.hostname !== AUTH_EMAIL_ROOT_DOMAIN &&
      parsed.hostname !== `www.${AUTH_EMAIL_ROOT_DOMAIN}`
    ) {
      return undefined;
    }
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return isSafeRelativePath(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

export function buildTribeAuthCallbackUrl(
  tokenHash: string,
  actionType: Exclude<AuthActionType, "reauthentication">,
  nextPath?: string,
): string {
  const callbackTypeParam = AUTH_TYPE_MAP[actionType];
  const params = new URLSearchParams({
    token_hash: tokenHash,
    type: callbackTypeParam,
  });
  if (isSafeRelativePath(nextPath)) params.set("next", nextPath);
  return `${EXPECTED_CALLBACK_URL_PREFIX}?${params.toString()}`;
}

function normalizeHtmlUrlText(value: string): string {
  return value.replace(/&amp;/g, "&");
}

function extractCallbackUrls(value: string): string[] {
  const normalized = normalizeHtmlUrlText(value);
  const escapedPrefix = EXPECTED_CALLBACK_URL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedPrefix}\\?[^\\s\"'<>)]*`, "g");
  return normalized.match(re) ?? [];
}

function auditCallbackUrl(
  rawUrl: string,
  expectedType: string,
): "invalid_callback_url" | "missing_token_hash" | "unsupported_type" | "type_mismatch" | "external_next_destination" | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "invalid_callback_url";
  }
  if (parsed.origin !== `https://${AUTH_EMAIL_ROOT_DOMAIN}`) return "invalid_callback_url";
  if (parsed.pathname !== AUTH_EMAIL_CALLBACK_PATH) return "invalid_callback_url";
  if (!isValidTokenHash(parsed.searchParams.get("token_hash"))) return "missing_token_hash";
  const type = parsed.searchParams.get("type");
  if (!type || !ALLOWED_CALLBACK_TYPES.has(type)) return "unsupported_type";
  if (type !== expectedType) return "type_mismatch";
  const next = parsed.searchParams.get("next");
  if (next && !isSafeRelativePath(next)) return "external_next_destination";
  return null;
}

export function auditAuthEmailPayloadForSend(
  queue: string,
  payload: { [key: string]: unknown } | null | undefined,
): string | null {
  if (queue !== "auth_emails") return null;
  const label = typeof payload?.label === "string" ? (payload.label as AuthActionType) : null;
  if (!label) return "missing_label";
  const html = typeof payload?.html === "string" ? payload.html : "";
  const text = typeof payload?.text === "string" ? payload.text : "";

  for (const re of FORBIDDEN_LINK_ARTIFACTS) {
    if (re.test(html) || re.test(text)) return "legacy_verify_url_detected";
  }

  if (label === "reauthentication") {
    if (payload?.link_strategy !== AUTH_EMAIL_TOTP_STRATEGY) return "unversioned_or_legacy_payload";
    return null;
  }

  if (!LINK_AUTH_ACTIONS.has(label)) return "unsupported_label";
  if (payload?.link_strategy !== AUTH_EMAIL_LINK_STRATEGY) return "unversioned_or_legacy_payload";

  const expectedType = AUTH_TYPE_MAP[label as keyof typeof AUTH_TYPE_MAP];
  if (!expectedType || !ALLOWED_CALLBACK_TYPES.has(expectedType)) return "unsupported_type";

  const htmlUrls = extractCallbackUrls(html);
  const textUrls = extractCallbackUrls(text);
  if (htmlUrls.length === 0) return "callback_url_missing_html";
  if (textUrls.length === 0) return "callback_url_missing_text";

  for (const callbackUrl of [...htmlUrls, ...textUrls]) {
    const auditReason = auditCallbackUrl(callbackUrl, expectedType);
    if (auditReason) return auditReason;
  }

  return null;
}

export function authEmailVersionMetadata(payload: {
  template_version?: unknown;
  link_strategy?: unknown;
  webhook_deployment?: unknown;
  environment?: unknown;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [
    "template_version",
    "link_strategy",
    "webhook_deployment",
    "environment",
  ] as const) {
    if (typeof payload[key] === "string") out[key] = payload[key];
  }
  return out;
}