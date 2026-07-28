import type { Session } from "@supabase/supabase-js";

export type OAuthSessionStage =
  | "token_shape_checked"
  | "set_session_failed"
  | "set_session_created"
  | "session_persistence_verified"
  | "session_persistence_exhausted";

export type OAuthSessionTrace = (entry: {
  stage: OAuthSessionStage;
  ok: boolean;
  code: string;
  durationMs: number;
}) => void;

type AuthClient = {
  setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<{
    data: { session: Session | null };
    error: { code?: string; status?: number } | null;
  }>;
  getSession: () => Promise<{ data: { session: Session | null }; error?: unknown }>;
};

export type OAuthSessionResult =
  | { ok: true; session: Session }
  | { ok: false; error: Error; code: string };

const DEFAULT_RETRY_DELAYS_MS = [0, 150, 350, 650, 1_000, 1_500];

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function safeAuthErrorCode(error: { code?: string; status?: number } | null): string {
  if (error?.code && /^[a-z0-9_]{1,64}$/i.test(error.code)) return error.code;
  if (error?.status && Number.isInteger(error.status)) return `http_${error.status}`;
  return "set_session_rejected";
}

function safeError(message: string, code: string): OAuthSessionResult {
  return { ok: false, code, error: new Error(message) };
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => window.setTimeout(resolve, ms)) : Promise.resolve();
}

export async function establishOAuthSession(
  auth: AuthClient,
  tokens: unknown,
  options: { retryDelaysMs?: number[]; trace?: OAuthSessionTrace } = {},
): Promise<OAuthSessionResult> {
  const startedAt = Date.now();
  const candidate = tokens as { access_token?: unknown; refresh_token?: unknown } | null;
  const hasAccessToken = typeof candidate?.access_token === "string" && candidate.access_token.length > 0;
  const hasRefreshToken =
    typeof candidate?.refresh_token === "string" && candidate.refresh_token.length > 0;
  options.trace?.({
    stage: "token_shape_checked",
    ok: hasAccessToken && hasRefreshToken,
    code: `access_${hasAccessToken ? "present" : "missing"}_refresh_${hasRefreshToken ? "present" : "missing"}`,
    durationMs: elapsed(startedAt),
  });
  if (!hasAccessToken || !hasRefreshToken || !candidate) {
    return safeError("Google sign-in returned an invalid session response.", "invalid_token_shape");
  }

  let setup: Awaited<ReturnType<AuthClient["setSession"]>>;
  try {
    setup = await auth.setSession({
      access_token: candidate.access_token as string,
      refresh_token: candidate.refresh_token as string,
    });
  } catch {
    options.trace?.({
      stage: "set_session_failed",
      ok: false,
      code: "set_session_threw",
      durationMs: elapsed(startedAt),
    });
    return safeError("Google session setup failed. Please retry.", "set_session_threw");
  }

  if (setup.error) {
    const code = safeAuthErrorCode(setup.error);
    options.trace?.({
      stage: "set_session_failed",
      ok: false,
      code,
      durationMs: elapsed(startedAt),
    });
    return safeError(`Google session setup failed: ${code}`, code);
  }
  if (!setup.data.session) {
    options.trace?.({
      stage: "set_session_failed",
      ok: false,
      code: "set_session_missing",
      durationMs: elapsed(startedAt),
    });
    return safeError(
      "Google returned successfully, but no session was created.",
      "set_session_missing",
    );
  }
  options.trace?.({
    stage: "set_session_created",
    ok: true,
    code: "session_present",
    durationMs: elapsed(startedAt),
  });

  for (const delayMs of options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS) {
    await wait(delayMs);
    try {
      const readBack = await auth.getSession();
      if (readBack.data.session) {
        options.trace?.({
          stage: "session_persistence_verified",
          ok: true,
          code: "session_readable",
          durationMs: elapsed(startedAt),
        });
        return { ok: true, session: readBack.data.session };
      }
    } catch {
      // A transient storage read can fail on Safari/PWA; retry within the same budget.
    }
  }

  options.trace?.({
    stage: "session_persistence_exhausted",
    ok: false,
    code: "session_readback_missing",
    durationMs: elapsed(startedAt),
  });
  return safeError(
    "Google sign-in completed, but this browser could not confirm the session.",
    "session_readback_missing",
  );
}