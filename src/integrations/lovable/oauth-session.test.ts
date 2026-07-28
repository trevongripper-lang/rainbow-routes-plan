import { beforeEach, describe, expect, it, vi } from "vitest";
import { establishOAuthSession, type OAuthSessionTrace } from "./oauth-session";

const tokens = { access_token: "secret-access-token", refresh_token: "secret-refresh-token" };
const session = { access_token: "a", refresh_token: "r", user: { id: "u1" } };

function auth(setup: unknown, reads: unknown[]) {
  return {
    setSession: vi.fn().mockImplementation(async () => setup),
    getSession: vi.fn().mockImplementation(async () => reads.shift() ?? { data: { session: null } }),
  };
}

describe("inline OAuth session establishment", () => {
  beforeEach(() => vi.useRealTimers());

  it("handles setSession returning an error without throwing", async () => {
    const client = auth({ data: { session: null }, error: { code: "invalid_grant" } }, []);
    const result = await establishOAuthSession(client as never, tokens, { retryDelaysMs: [] });
    expect(result).toMatchObject({ ok: false, code: "invalid_grant" });
  });

  it("handles setSession throwing without exposing its message", async () => {
    const client = auth(null, []);
    client.setSession.mockRejectedValueOnce(new Error(`provider leaked ${tokens.access_token}`));
    const result = await establishOAuthSession(client as never, tokens, { retryDelaysMs: [] });
    expect(result).toMatchObject({ ok: false, code: "set_session_threw" });
    expect(result.ok ? "" : result.error.message).not.toContain(tokens.access_token);
  });

  it("succeeds when the session is immediately readable", async () => {
    const client = auth({ data: { session }, error: null }, [{ data: { session } }]);
    const result = await establishOAuthSession(client as never, tokens, { retryDelaysMs: [0] });
    expect(result).toMatchObject({ ok: true, session });
  });

  it("retries until session persistence becomes readable", async () => {
    const client = auth(
      { data: { session }, error: null },
      [{ data: { session: null } }, { data: { session } }],
    );
    const result = await establishOAuthSession(client as never, tokens, { retryDelaysMs: [0, 1] });
    expect(result.ok).toBe(true);
    expect(client.getSession).toHaveBeenCalledTimes(2);
  });

  it("rejects a successful response with no created session", async () => {
    const client = auth({ data: { session: null }, error: null }, []);
    const result = await establishOAuthSession(client as never, tokens, { retryDelaysMs: [0] });
    expect(result).toMatchObject({ ok: false, code: "set_session_missing" });
    expect(client.getSession).not.toHaveBeenCalled();
  });

  it("returns a recovery failure after bounded retry exhaustion", async () => {
    const client = auth({ data: { session }, error: null }, []);
    const result = await establishOAuthSession(client as never, tokens, { retryDelaysMs: [0, 0, 0] });
    expect(result).toMatchObject({ ok: false, code: "session_readback_missing" });
    expect(client.getSession).toHaveBeenCalledTimes(3);
  });

  it("does not permit navigation before persistence is verified", async () => {
    const navigate = vi.fn();
    const client = auth({ data: { session }, error: null }, []);
    const result = await establishOAuthSession(client as never, tokens, { retryDelaysMs: [0] });
    if (result.ok) navigate();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("never includes sensitive token values in diagnostics", async () => {
    const trace = vi.fn<OAuthSessionTrace>();
    const client = auth({ data: { session: null }, error: { code: "invalid_grant" } }, []);
    await establishOAuthSession(client as never, tokens, { retryDelaysMs: [], trace });
    const serialized = JSON.stringify(trace.mock.calls);
    expect(serialized).not.toContain(tokens.access_token);
    expect(serialized).not.toContain(tokens.refresh_token);
    expect(serialized).toContain("access_present_refresh_present");
  });
});