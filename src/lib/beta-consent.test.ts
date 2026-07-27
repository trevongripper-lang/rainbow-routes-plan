import { describe, it, expect, beforeEach, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    insert: () => Promise.resolve({ error: null }),
  };
  return {
    supabase: {
      // checkBetaConsent now uses the my_consent_status RPC.
      // recordBetaConsent still uses .from().insert() + current_consent_version RPC.
      rpc: (name: string) => {
        if (name === "current_consent_version") {
          return Promise.resolve({ data: "2026-06-beta-v1", error: null });
        }
        return rpcMock();
      },
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
  rpcMock.mockReset();
});

describe("beta consent gate", () => {
  it("new confirmed user with no consent row resolves to 'missing'", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("missing");
  });

  it("user with current-version row resolves to 'current'", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("current");
  });

  it("RPC error resolves to 'error' (fail-closed for the gate)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await checkBetaConsent(UID_A)).toBe("error");
  });

  it("thrown lookup also resolves to 'error', never silently 'current'", async () => {
    rpcMock.mockRejectedValueOnce(new Error("network"));
    expect(await checkBetaConsent(UID_A)).toBe("error");
  });

  it("null RPC data resolves to 'missing', never silently 'current'", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("missing");
  });

  it("a previous tester's localStorage flag never satisfies another user", () => {
    cacheBetaConsentLocal(UID_B);
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

  it("checkBetaConsent clears a stale per-user cache when RPC says 'missing'", async () => {
    cacheBetaConsentLocal(UID_A);
    expect(window.localStorage.getItem(betaConsentCacheKey(UID_A))).not.toBeNull();
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("missing");
    expect(window.localStorage.getItem(betaConsentCacheKey(UID_A))).toBeNull();
  });

  it("checkBetaConsent clears a per-user cache on RPC error (fail-closed)", async () => {
    cacheBetaConsentLocal(UID_A);
    expect(window.localStorage.getItem(betaConsentCacheKey(UID_A))).not.toBeNull();
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await checkBetaConsent(UID_A)).toBe("error");
    expect(window.localStorage.getItem(betaConsentCacheKey(UID_A))).toBeNull();
  });

  it("checkBetaConsent caches per-user after a successful RPC hit", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    expect(await checkBetaConsent(UID_A)).toBe("current");
    expect(hasBetaConsentLocal(UID_A)).toBe(true);
  });

  it("BETA_CONSENT_VERSION is a non-empty string", () => {
    expect(typeof BETA_CONSENT_VERSION).toBe("string");
    expect(BETA_CONSENT_VERSION.length).toBeGreaterThan(0);
  });
});
