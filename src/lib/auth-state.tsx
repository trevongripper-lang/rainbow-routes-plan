import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppAuthState = {
  ready: boolean;
  session: Session | null;
  user: User | null;
};

export const defaultAuthState: AppAuthState = {
  ready: false,
  session: null,
  user: null,
};

let currentAuthState: AppAuthState = defaultAuthState;
let initPromise: Promise<AppAuthState> | null = null;
let listenerStarted = false;
let stopListener: (() => void) | null = null;

const subscribers = new Set<() => void>();

function publishAuthState(next: AppAuthState) {
  currentAuthState = next;
  subscribers.forEach((subscriber) => subscriber());
  return next;
}

export function authStateFromSession(session: Session | null): AppAuthState {
  return {
    ready: true,
    session,
    user: session?.user ?? null,
  };
}

export function getAuthState() {
  return currentAuthState;
}

export function subscribeAuthState(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function setAuthSession(session: Session | null) {
  return publishAuthState(authStateFromSession(session));
}

export async function refreshAuthState() {
  const { data } = await supabase.auth.getSession();
  return setAuthSession(data.session ?? null);
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
    const next = setAuthSession(session ?? null);
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
  return useSyncExternalStore(subscribeAuthState, getAuthState, getAuthState);
}

const AuthContext = createContext<AppAuthState>(defaultAuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthSnapshot();

  useEffect(() => {
    void ensureAuthReady();
  }, []);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}