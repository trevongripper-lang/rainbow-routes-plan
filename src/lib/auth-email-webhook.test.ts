import { describe, expect, it } from "vitest";

import { AUTH_EMAIL_LINK_STRATEGY } from "./auth-email-contract";
import {
  auditAuthEmailPayloadForSend,
  buildTribeAuthCallbackUrl,
  extractAuthEmailTokenHash,
  extractSafeRedirectPath,
} from "./auth-email-webhook";

const PROVIDER_ORIGIN = "https://example.supabase.co";

describe("auth email webhook token extraction", () => {
  it("extracts the usable token hash from the provider /auth/v1/verify token parameter", () => {
    const productionWebhookPayload = {
      version: "1",
      run_id: "run_signup_prod_shape",
      data: {
        action_type: "signup",
        email: "new-user@example.com",
        url: `${PROVIDER_ORIGIN}/auth/v1/verify?token=pkce_abc123DEF456&type=signup&redirect_to=https%3A%2F%2Fjointribetrips.com%2Fauth%2Fcallback`,
      },
    };

    const result = extractAuthEmailTokenHash(
      productionWebhookPayload.data,
      productionWebhookPayload.data.action_type,
      PROVIDER_ORIGIN,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("provider_verify_url_token");
    expect(result.tokenHash).toBe("pkce_abc123DEF456");
    expect(result.diagnostics.provider_url_path_matches).toBe(true);
    expect(result.diagnostics.provider_url_token_pkce_prefix).toBe(true);
  });

  it("builds a new Tribe callback URL and never reuses the incoming provider URL", () => {
    const callbackUrl = buildTribeAuthCallbackUrl("pkce_abc123DEF456", "signup", "/app");

    expect(callbackUrl).toBe(
      "https://jointribetrips.com/auth/callback?token_hash=pkce_abc123DEF456&type=signup&next=%2Fapp",
    );
    expect(callbackUrl).not.toContain("/auth/v1/verify");
    expect(callbackUrl).not.toContain("supabase.co");
  });

  it("preserves only safe same-site redirect paths from the provider URL", () => {
    expect(
      extractSafeRedirectPath({
        url: `${PROVIDER_ORIGIN}/auth/v1/verify?token=pkce_abc123DEF456&type=signup&redirect_to=https%3A%2F%2Fjointribetrips.com%2Fapp%3Ftab%3Dtrips`,
      }),
    ).toBe("/app?tab=trips");

    expect(
      extractSafeRedirectPath({
        url: `${PROVIDER_ORIGIN}/auth/v1/verify?token=pkce_abc123DEF456&type=signup&redirect_to=https%3A%2F%2Fevil.example%2Fapp`,
      }),
    ).toBeUndefined();
  });

  it("rejects sending rendered auth emails that still contain legacy provider verification URLs", () => {
    const reason = auditAuthEmailPayloadForSend("auth_emails", {
      label: "signup",
      link_strategy: AUTH_EMAIL_LINK_STRATEGY,
      html: `<a href="${PROVIDER_ORIGIN}/auth/v1/verify?token=pkce_abc123DEF456&type=signup">Confirm</a>`,
      text: `${PROVIDER_ORIGIN}/auth/v1/verify?token=pkce_abc123DEF456&type=signup`,
    });

    expect(reason).toBe("legacy_verify_url_detected");
  });

  it("accepts versioned rendered auth emails with the Tribe token-hash interstitial URL", () => {
    const callbackUrl = buildTribeAuthCallbackUrl("pkce_abc123DEF456", "signup");
    const reason = auditAuthEmailPayloadForSend("auth_emails", {
      label: "signup",
      link_strategy: AUTH_EMAIL_LINK_STRATEGY,
      html: `<a href="${callbackUrl.replace(/&/g, "&amp;")}">Confirm</a>`,
      text: callbackUrl,
    });

    expect(reason).toBeNull();
  });
});