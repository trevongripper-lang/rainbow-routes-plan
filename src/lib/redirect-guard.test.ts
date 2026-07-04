import { describe, it, expect } from "vitest";
import { sanitizeRedirectPath } from "./redirect-guard";

describe("sanitizeRedirectPath", () => {
  it("returns fallback for undefined/empty/non-string", () => {
    expect(sanitizeRedirectPath(undefined)).toBe("/trips");
    expect(sanitizeRedirectPath("")).toBe("/trips");
    expect(sanitizeRedirectPath("   ")).toBe("/trips");
    expect(sanitizeRedirectPath(42)).toBe("/trips");
    expect(sanitizeRedirectPath(null)).toBe("/trips");
  });

  it("rejects cross-origin and protocol-relative", () => {
    expect(sanitizeRedirectPath("https://evil.com/x")).toBe("/trips");
    expect(sanitizeRedirectPath("//evil.com/x")).toBe("/trips");
    expect(sanitizeRedirectPath("javascript:alert(1)")).toBe("/trips");
    expect(sanitizeRedirectPath("/foo\\bar")).toBe("/trips");
  });

  it("rejects redirect loops back to auth/consent/recover", () => {
    expect(sanitizeRedirectPath("/auth")).toBe("/trips");
    expect(sanitizeRedirectPath("/auth?x=1")).toBe("/trips");
    expect(sanitizeRedirectPath("/beta-consent")).toBe("/trips");
    expect(sanitizeRedirectPath("/recover")).toBe("/trips");
  });

  it("accepts same-origin absolute paths", () => {
    expect(sanitizeRedirectPath("/trips")).toBe("/trips");
    expect(sanitizeRedirectPath("/join/abc123")).toBe("/join/abc123");
    expect(sanitizeRedirectPath("/trips/xyz?tab=chatter")).toBe("/trips/xyz?tab=chatter");
  });

  it("honors custom fallback", () => {
    expect(sanitizeRedirectPath(undefined, { fallback: "/me" })).toBe("/me");
    expect(sanitizeRedirectPath("//x", { fallback: "/me" })).toBe("/me");
  });
});
