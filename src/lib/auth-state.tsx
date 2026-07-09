import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppAuthStatus = "loading" | "authenticated" | "unauthenticated";

export type AppAuthState = {
  status: AppAuthStatus;
  ready: boolean;
  session: Session | null;
  user: User | null;
  error: string | null;
  timedOut: boolean;
};

export const SESSION_HYDRATION_TIMEOUT_MS = 3_000;
export const SESSION_HYDRATION_ERROR_MESSAGE =
  "We had trouble restoring your session. Please sign in again.";

export const defaultAuthState: AppAuthState = {
  status: "loading",
  ready: false,
  session: null,
  user: null,
  error: null,
  timedOut: false,
};

let currentAuthState: AppAuthState = defaultAuthState;
let initPromise: Promise<AppAuthState> | null = null;
let listenerStarted = false;
let stopListener: (() => void) | null = null;
let authCheckVersion = 0;

const subscribers = new Set<() => void>();

function publishAuthState(next: AppAuthState) {
  currentAuthState = next;
  subscribers.forEach((subscriber) => subscriber());
  return next;
}

export function authStateFromSession(session: Session | null): AppAuthState {
  return {
    status: session ? "authenticated" : "unauthenticated",
    ready: true,
    session,
    user: session?.user ?? null,
    error: null,
    timedOut: false,
  };
}

function authFailureState(timedOut: boolean): AppAuthState {
  return {
    status: "unauthenticated",
    ready: true,
    session: null,
    user: null,
    error: SESSION_HYDRATION_ERROR_MESSAGE,
    timedOut,
  };
}

function logHydrationFailure(message: string, error?: unknown) {
  if (!import.meta.env.DEV) return;
  if (error) {
    console.error(`[auth] ${message}`, error);
  } else {
    console.error(`[auth] ${message}`);
  }
}

export function getAuthState() {
  return currentAuthState;
}

export function subscribeAuthState(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function setAuthSession(session: Session | null) {
  if (session) authCheckVersion += 1;
  return publishAuthState(authStateFromSession(session));
}

export function clearAuthSession() {
  authCheckVersion += 1;
  return publishAuthState(authStateFromSession(null));
}

export function resetAuthState() {
  authCheckVersion += 1;
  return publishAuthState(authStateFromSession(null));
}

type SessionCheckResult =
  | { status: "success"; session: Session | null }
  | { status: "error"; error: unknown }
  | { status: "timeout" };

export async function refreshAuthState(timeoutMs = SESSION_HYDRATION_TIMEOUT_MS) {
  const requestVersion = authCheckVersion + 1;
  authCheckVersion = requestVersion;

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const sessionPromise: Promise<SessionCheckResult> = Promise.resolve()
    .then(() => supabase.auth.getSession())
    .then(({ data }) => ({ status: "success", session: data.session ?? null }) as const)
    .catch((error) => ({ status: "error", error }) as const);

  const timeoutPromise = new Promise<SessionCheckResult>((resolve) => {
    timeoutId = globalThis.setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });

  const result = await Promise.race([sessionPromise, timeoutPromise]);
  if (timeoutId) globalThis.clearTimeout(timeoutId);

  if (requestVersion !== authCheckVersion) return currentAuthState;

  if (result.status === "timeout") {
    logHydrationFailure(`Session hydration timed out after ${timeoutMs}ms.`);
    void sessionPromise.then((lateResult) => {
      if (requestVersion !== authCheckVersion) return;
      if (lateResult.status === "success" && lateResult.session) {
        publishAuthState(authStateFromSession(lateResult.session));
      } else if (lateResult.status === "error") {
        logHydrationFailure("Session hydration failed after timing out.", lateResult.error);
      }
    });
    return publishAuthState(authFailureState(true));
  }

  if (result.status === "error") {
    logHydrationFailure("Session hydration failed.", result.error);
    return publishAuthState(authFailureState(false));
  }

  return publishAuthState(authStateFromSession(result.session));
}

export async function ensureAuthReady() {
  if (currentAuthState.ready) return currentAuthState;
  if (!initPromise) {
    initPromise = refreshAuthState().finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export function startAuthStateListener(
  onEvent?: (event: AuthChangeEvent, auth: AppAuthState) => void,
) {
  if (listenerStarted) return () => {};
  listenerStarted = true;

  void ensureAuthReady();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" && !session && !currentAuthState.ready) {
      onEvent?.(event, currentAuthState);
      return;
    }
    const next = event === "SIGNED_OUT" ? clearAuthSession() : setAuthSession(session ?? null);
    onEvent?.(event, next);
  });

  stopListener = () => {
    subscription.unsubscribe();
    listenerStarted = false;
    stopListener = null;
  };

  return stopListener;
}

export function useAuthSnapshot() {
  return useSyncExternalStore(subscribeAuthState, getAuthState, () => defaultAuthState);
}

const AuthContext = createContext<AppAuthState>(defaultAuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthSnapshot();

  useEffect(() => {
    void ensureAuthReady();

    const fallbackId = window.setTimeout(() => {
      if (!getAuthState().ready) void refreshAuthState(SESSION_HYDRATION_TIMEOUT_MS);
    }, SESSION_HYDRATION_TIMEOUT_MS);

    // Safari bfcache: when the page is restored from the back-forward cache
    // its JS state is frozen and won't reflect a session that changed in
    // another tab or during a full-page OAuth round-trip. Force a real reload
    // so the app re-hydrates from Supabase. Skip while mid-auth (on /auth,
    // /reset-password, or an OAuth callback with tokens in the URL) to avoid
    // interrupting the sign-in handshake.
    const isMidAuthFlow = () => {
      if (typeof window === "undefined") return false;
      const p = window.location.pathname;
      if (p.startsWith("/auth") || p.startsWith("/reset-password")) return true;
      const hash = window.location.hash || "";
      if (hash.includes("access_token=") || hash.includes("type=recovery")) return true;
      return false;
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && !isMidAuthFlow()) {
        window.location.reload();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (isMidAuthFlow()) return;
      void refreshAuthState();
    };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(fallbackId);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthLoadingScreen() {
  return (
    <div
      className="safe-top safe-bottom grid min-h-screen place-items-center px-6 py-12"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div role="status" aria-live="polite" className="flex items-center gap-3 text-sm text-muted-foreground">
        <span
          aria-hidden="true"
          className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        Loading Tribe Trips…
      </div>
    </div>
  );
}