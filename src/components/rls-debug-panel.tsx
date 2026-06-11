import { useEffect, useState, useSyncExternalStore } from "react";
import { Bug, X, Trash2 } from "lucide-react";

type RlsEvent = {
  id: number;
  time: number;
  method: string;
  table: string | null;
  url: string;
  status: number;
  code: string | null;
  message: string;
  hint: string | null;
  details: string | null;
  blockedBy: string | null; // function or policy name parsed from message
  kind: "rls" | "permission" | "auth" | "other";
};

let counter = 0;
const events: RlsEvent[] = [];
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
const store = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  get: () => events,
  push(e: Omit<RlsEvent, "id" | "time">) {
    events.unshift({ ...e, id: ++counter, time: Date.now() });
    if (events.length > 100) events.pop();
    emit();
  },
  clear() {
    events.length = 0;
    emit();
  },
};

let installed = false;
function installFetchInterceptor() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await orig(input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : (input as URL).toString();
      const isRest = url.includes("/rest/v1/") || url.includes("/auth/v1/");
      if (!isRest) return res;
      if (res.ok) return res;
      // peek body without consuming
      const clone = res.clone();
      const text = await clone.text();
      let parsed: { code?: string; message?: string; hint?: string; details?: string; error?: string; error_description?: string } | null = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      const method = (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
      const tableMatch = url.match(/\/rest\/v1\/([^?]+)/);
      const table = tableMatch ? tableMatch[1] : null;
      const code = parsed?.code ?? null;
      const message = parsed?.message ?? parsed?.error_description ?? parsed?.error ?? `HTTP ${res.status}`;
      const hint = parsed?.hint ?? null;
      const details = parsed?.details ?? null;

      // classify
      let kind: RlsEvent["kind"] = "other";
      let blockedBy: string | null = null;
      if (res.status === 401) kind = "auth";
      if (code === "42501" || /permission denied/i.test(message)) {
        kind = "permission";
        const fn = message.match(/permission denied for function ([\w.]+)/i);
        const rel = message.match(/permission denied for (?:table|relation) ([\w.]+)/i);
        blockedBy = fn?.[1] ?? rel?.[1] ?? null;
      }
      if (
        code === "42501" && /row-level security/i.test(message) ||
        /violates row-level security policy/i.test(message) ||
        /new row violates row-level security/i.test(message)
      ) {
        kind = "rls";
        const pol = message.match(/policy "([^"]+)"/);
        blockedBy = pol?.[1] ?? blockedBy;
      }
      // 403 on REST with no clear code is usually RLS filtering
      if (res.status === 403 && kind === "other") kind = "rls";

      store.push({ method, table, url, status: res.status, code, message, hint, details, blockedBy, kind });
    } catch {
      // swallow — debug panel must never break the app
    }
    return res;
  };
}

function useEvents() {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

const KIND_STYLE: Record<RlsEvent["kind"], string> = {
  rls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  permission: "bg-red-500/15 text-red-300 border-red-500/30",
  auth: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

export function RlsDebugPanel() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const events = useEvents();

  useEffect(() => { installFetchInterceptor(); }, []);

  const unseenCount = events.length;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-2 text-xs shadow-lg backdrop-blur hover:border-primary/50"
        title="RLS / auth debug panel"
      >
        <Bug className="size-4" />
        <span className="font-mono">RLS</span>
        {unseenCount > 0 && (
          <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unseenCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-16 right-4 z-[60] flex max-h-[70vh] w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Bug className="size-4 text-primary" />
              <span className="font-semibold">RLS / Auth debug</span>
              <span className="text-xs text-muted-foreground">{events.length} captured</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => store.clear()} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Clear">
                <Trash2 className="size-4" />
              </button>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Close">
                <X className="size-4" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            {events.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No RLS, permission, or auth failures captured yet. Try an action that should be blocked.
              </div>
            )}
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="px-3 py-2 text-xs">
                  <button onClick={() => setExpanded(expanded === e.id ? null : e.id)} className="flex w-full items-start gap-2 text-left">
                    <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${KIND_STYLE[e.kind]}`}>
                      {e.kind}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{e.method}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{e.status}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-foreground">{e.table ?? "(non-rest)"}</span>
                      {e.blockedBy && (
                        <span className="ml-2 text-muted-foreground">
                          blocked by <span className="font-mono text-amber-300">{e.blockedBy}</span>
                        </span>
                      )}
                      <span className="mt-0.5 block truncate text-muted-foreground">{e.message}</span>
                    </span>
                  </button>
                  {expanded === e.id && (
                    <div className="mt-2 space-y-1 rounded bg-muted/40 p-2 font-mono text-[11px]">
                      <div><span className="text-muted-foreground">time:</span> {new Date(e.time).toLocaleTimeString()}</div>
                      <div className="break-all"><span className="text-muted-foreground">url:</span> {e.url}</div>
                      {e.code && <div><span className="text-muted-foreground">code:</span> {e.code}</div>}
                      <div className="whitespace-pre-wrap"><span className="text-muted-foreground">message:</span> {e.message}</div>
                      {e.hint && <div className="whitespace-pre-wrap"><span className="text-muted-foreground">hint:</span> {e.hint}</div>}
                      {e.details && <div className="whitespace-pre-wrap"><span className="text-muted-foreground">details:</span> {e.details}</div>}
                      <div className="pt-1 text-muted-foreground">
                        {e.kind === "rls" && "Likely cause: SELECT/INSERT/UPDATE RLS policy filtered or rejected this row. Check policy USING / WITH CHECK."}
                        {e.kind === "permission" && "Likely cause: missing GRANT on table or EXECUTE on function for role 'authenticated' or 'anon'."}
                        {e.kind === "auth" && "Likely cause: no/expired bearer token. Sign in or refresh session."}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
