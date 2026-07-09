import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the supabase client BEFORE importing auth-state
const getSessionMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import {
  refreshAuthState,
  resetAuthState,
  SESSION_HYDRATION_ERROR_MESSAGE,
} from "./auth-state";

describe("auth-state hydration timeout", () => {
  beforeEach(() => {
    resetAuthState();
    getSessionMock.mockReset();
  });

  it("returns a timed-out state within 6s when getSession hangs", async () => {
    // Simulate a permanently hanging getSession (Safari/mobile bug).
    getSessionMock.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const start = Date.now();
    const state = await refreshAuthState(5_000);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(6_000);
    expect(state.ready).toBe(true);
    expect(state.timedOut).toBe(true);
    expect(state.session).toBeNull();
    expect(state.error).toBe(SESSION_HYDRATION_ERROR_MESSAGE);
  }, 8_000);

  it("returns an errored ready state when getSession rejects", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("network down"));

    const state = await refreshAuthState(5_000);

    expect(state.ready).toBe(true);
    expect(state.timedOut).toBe(false);
    expect(state.session).toBeNull();
    expect(state.error).toBe(SESSION_HYDRATION_ERROR_MESSAGE);
  });

  it("returns a null-session ready state when getSession resolves with no session", async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });

    const state = await refreshAuthState(5_000);

    expect(state.ready).toBe(true);
    expect(state.timedOut).toBe(false);
    expect(state.session).toBeNull();
    expect(state.error).toBeNull();
  });

  it("returns a hydrated session when getSession resolves quickly", async () => {
    const fakeSession = {
      access_token: "t",
      refresh_token: "r",
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "user-1", email: "u@example.com" },
    };
    getSessionMock.mockResolvedValueOnce({ data: { session: fakeSession } });

    const state = await refreshAuthState(5_000);

    expect(state.ready).toBe(true);
    expect(state.timedOut).toBe(false);
    expect(state.session).toBe(fakeSession);
    expect(state.user?.id).toBe("user-1");
    expect(state.error).toBeNull();
  });
});
