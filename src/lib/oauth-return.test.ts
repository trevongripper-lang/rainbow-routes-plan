import { describe, expect, it } from "vitest";
import { classifyOrigin, toPublicOAuthErrorCode } from "./oauth-return";

describe("classifyOrigin", () => {
  it("recognizes the apex production origin", () => {
    expect(classifyOrigin("https://jointribetrips.com")).toBe("apex");
  });
  it("recognizes the www production origin", () => {
    expect(classifyOrigin("https://www.jointribetrips.com")).toBe("www");
  });
  it("recognizes preview subdomains", () => {
    expect(classifyOrigin("https://id-preview--abc.lovable.app")).toBe("preview");
  });
  it("recognizes sandbox lovable domains", () => {
    expect(classifyOrigin("https://something.lovable.app")).toBe("sandbox");
    expect(classifyOrigin("https://x.lovableproject.com")).toBe("sandbox");
  });
  it("falls back to other for unknown origins", () => {
    expect(classifyOrigin("https://example.com")).toBe("other");
  });
  it("returns other on malformed input", () => {
    expect(classifyOrigin("not-a-url")).toBe("other");
  });
});

describe("toPublicOAuthErrorCode", () => {
  it("maps missing/invalid token shape to token delivery missing", () => {
    expect(toPublicOAuthErrorCode("invalid_token_shape")).toBe("oauth_token_delivery_missing");
  });
  it("maps setSession failures", () => {
    expect(toPublicOAuthErrorCode("set_session_threw")).toBe("oauth_set_session_failed");
    expect(toPublicOAuthErrorCode("set_session_rejected")).toBe("oauth_set_session_failed");
    expect(toPublicOAuthErrorCode("http_500")).toBe("oauth_set_session_failed");
    expect(toPublicOAuthErrorCode("invalid_grant")).toBe("oauth_set_session_failed");
  });
  it("maps persistence failures", () => {
    expect(toPublicOAuthErrorCode("set_session_missing")).toBe("oauth_session_not_persisted");
    expect(toPublicOAuthErrorCode("session_readback_missing")).toBe("oauth_session_not_persisted");
  });
  it("maps origin mismatch", () => {
    expect(toPublicOAuthErrorCode("origin_mismatch")).toBe("oauth_origin_mismatch");
  });
  it("maps storage unavailable", () => {
    expect(toPublicOAuthErrorCode("storage_unavailable")).toBe("oauth_storage_unavailable");
  });
  it("maps poll timeout", () => {
    expect(toPublicOAuthErrorCode("oauth_return_poll")).toBe("oauth_return_poll_timeout");
    expect(toPublicOAuthErrorCode("oauth_return_poll_timeout")).toBe("oauth_return_poll_timeout");
  });
  it("falls back to provider failed for unknown/empty codes", () => {
    expect(toPublicOAuthErrorCode(undefined)).toBe("oauth_provider_failed");
    expect(toPublicOAuthErrorCode("")).toBe("oauth_provider_failed");
    expect(toPublicOAuthErrorCode("something_new")).toBe("oauth_provider_failed");
  });
});
