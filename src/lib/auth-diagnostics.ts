/**
 * Sanitized client-stage diagnostics for the Google/OAuth sign-in flow.
 *
 * Retention: kept in-memory (sessionStorage) for one browser session only.
 * Purpose: give a user reporting a broken sign-in a copy-pasteable trace we
 * can correlate with server-side auth logs by timestamp + correlation id.
 *
 * SAFE to log: stage name, correlation id, boolean flags, string codes/
 * enum values, short sanitized error messages (truncated to 140 chars),
 * pathname (no query, no hash).
 *
 * NEVER log: tokens, OAuth codes, cookies, emails, names, avatars,
 * provider payloads, full URLs (may contain code/state), refresh tokens.
 */

const STORAGE_KEY = "tribe.auth.diag.v1";
const MAX_ENTRIES = 40;

export type AuthStage =
  | "oauth_start"
  | "oauth_redirect_initiated"
  | "oauth_inline_tokens_received"
  | "oauth_session_setup"
  | "oauth_return_detected"
  | "callback_reached"
  | "callback_error_param"
  | "code_exchange_ok"
  | "code_exchange_failed"
  | "session_hydrated"
  | "session_hydration_timeout"
  | "consent_primed"
  | "consent_route_missing"
  | "consent_route_current"
  | "final_navigate";

export type AuthDiagEntry = {
  t: string; // ISO timestamp
  cid: string; // correlation id
  stage: AuthStage;
  ok?: boolean;
  code?: string;
  msg?: string; // sanitized, truncated
  path?: string; // pathname only
  durationMs?: number;
};

function safeSession(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function read(): AuthDiagEntry[] {
  const s = safeSession();
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthDiagEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: AuthDiagEntry[]): void {
  const s = safeSession();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* quota / privacy mode — ignore */
  }
}

export function newCorrelationId(): string {
  // 8-byte hex, no PII. Not cryptographic; just correlation.
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const CID_KEY = "tribe.auth.diag.cid.v1";

export function currentCorrelationId(): string {
  const s = safeSession();
  if (!s) return newCorrelationId();
  try {
    const existing = s.getItem(CID_KEY);
    if (existing) return existing;
    const cid = newCorrelationId();
    s.setItem(CID_KEY, cid);
    return cid;
  } catch {
    return newCorrelationId();
  }
}

export function beginAuthCorrelation(): string {
  const s = safeSession();
  const cid = newCorrelationId();
  try {
    s?.setItem(CID_KEY, cid);
  } catch {
    /* ignore */
  }
  return cid;
}

function sanitizeMsg(input: unknown): string | undefined {
  if (input == null) return undefined;
  const raw = input instanceof Error ? input.message : String(input);
  // Strip obvious secrets/URLs from message defensively. Belt-and-braces
  // against any caller who accidentally passes a URL or token payload.
  const stripped = raw
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[jwt]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/code=[^\s&]+/g, "code=[redacted]")
    .replace(/token_hash=[^\s&]+/gi, "token_hash=[redacted]")
    .replace(/access_token=[^\s&]+/gi, "access_token=[redacted]")
    .replace(/refresh_token=[^\s&]+/gi, "refresh_token=[redacted]")
    .replace(/token=[^\s&]+/g, "token=[redacted]");
  return stripped.slice(0, 140);
}


export function logAuthStage(
  stage: AuthStage,
  opts: { ok?: boolean; code?: string; msg?: unknown; durationMs?: number } = {},
): void {
  try {
    const entry: AuthDiagEntry = {
      t: new Date().toISOString(),
      cid: currentCorrelationId(),
      stage,
      ok: opts.ok,
      code: opts.code,
      msg: sanitizeMsg(opts.msg),
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
      durationMs:
        typeof opts.durationMs === "number" && Number.isFinite(opts.durationMs)
          ? Math.max(0, Math.round(opts.durationMs))
          : undefined,
    };
    const entries = read();
    entries.push(entry);
    write(entries);
    // Console breadcrumb for live triage — same sanitized payload.
    // eslint-disable-next-line no-console
    console.info("[auth:diag]", entry);
  } catch {
    /* diagnostics must never break sign-in */
  }
}

export function getAuthDiagnostics(): AuthDiagEntry[] {
  return read();
}

export function formatAuthDiagnosticsForSupport(): string {
  const entries = read();
  if (entries.length === 0) return "(no auth diagnostics recorded this session)";
  return entries
    .map((e) => {
      const parts = [e.t, e.cid, e.stage];
      if (e.ok !== undefined) parts.push(e.ok ? "ok" : "fail");
      if (e.code) parts.push(`code=${e.code}`);
      if (e.path) parts.push(`path=${e.path}`);
      if (e.msg) parts.push(`msg=${e.msg}`);
      if (e.durationMs !== undefined) parts.push(`durationMs=${e.durationMs}`);
      return parts.join(" | ");
    })
    .join("\n");
}

export function clearAuthDiagnostics(): void {
  const s = safeSession();
  try {
    s?.removeItem(STORAGE_KEY);
    s?.removeItem(CID_KEY);
  } catch {
    /* ignore */
  }
}
