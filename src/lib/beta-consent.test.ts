import { describe, it, expect, beforeEach, vi } from "vitest";

const maybeSingleMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => maybeSingleMock(),
    insert: () => Promise.resolve({ error: null }),
  };
  return {
    supabase: {
      from: () => chain,
    },
  };
});

import {
  checkBetaConsent,
  hasBetaConsentLocal,
  cacheBetaConsentLocal,
  betaConsentCacheKey,
  BETA_CONSENT_VERSION,
} from "@/lib/beta-consent";

const UID_A = "user-a";
const UID_B = "user-b";

beforeEach(() => {
  window.localStorage.clear();
  maybeSingleMock.mockReset();
});

describe("beta consent gate", () => {
  it("new confirmed user with no consent row resolves to 'missing'", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("missing");
  });

  it("user with current-version row resolves to 'current'", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "row-1" }, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("current");
  });

  it("DB lookup error resolves to 'error' (fail-closed for the gate)", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await checkBetaConsent(UID_A)).toBe("error");
  });

  it("thrown lookup also resolves to 'error', never silently 'current'", async () => {
    maybeSingleMock.mockRejectedValueOnce(new Error("network"));
    expect(await checkBetaConsent(UID_A)).toBe("error");
  });

  it("a previous tester's localStorage flag never satisfies another user", () => {
    // User B accepted earlier on this browser.
    cacheBetaConsentLocal(UID_B);
    // User A now signs in on the same browser. Their per-user cache is empty,
    // so the local check must be false — the gate will then hit the DB.
    expect(hasBetaConsentLocal(UID_A)).toBe(false);
    expect(hasBetaConsentLocal(UID_B)).toBe(true);
  });

  it("a stale-version cache entry does not satisfy the current-version check", () => {
    window.localStorage.setItem(
      `tt:beta-consent:old-version:${UID_A}`,
      JSON.stringify({ v: "old-version", uid: UID_A, at: new Date().toISOString() }),
    );
    expect(hasBetaConsentLocal(UID_A)).toBe(false);
  });

  it("checkBetaConsent clears a stale per-user cache when DB says 'missing'", async () => {
    cacheBetaConsentLocal(UID_A);
    expect(window.localStorage.getItem(betaConsentCacheKey(UID_A))).not.toBeNull();
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("missing");
    expect(window.localStorage.getItem(betaConsentCacheKey(UID_A))).toBeNull();
  });

  it("checkBetaConsent caches per-user after a successful DB hit", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "row-1" }, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("current");
    expect(hasBetaConsentLocal(UID_A)).toBe(true);
  });

  it("BETA_CONSENT_VERSION is a non-empty string", () => {
    expect(typeof BETA_CONSENT_VERSION).toBe("string");
    expect(BETA_CONSENT_VERSION.length).toBeGreaterThan(0);
  });
});
