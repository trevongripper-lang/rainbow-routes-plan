// Cache-busting version check.
// On app load (in production), fetch /version.json bypassing cache, compare to
// the version stored in localStorage. If it changed, clear any service-worker
// caches, unregister service workers, and force a hard reload.
//
// Skipped in dev, when offline, and during auth flows to avoid redirect loops.

const STORAGE_KEY = "tribetrips:build-version";
const SKIPPED_PATH_PREFIXES = ["/auth", "/~oauth", "/reset-password"];

let started = false;

function isAuthFlow(): boolean {
  if (typeof window === "undefined") return false;
  const { pathname, hash, search } = window.location;
  if (SKIPPED_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // OAuth/magic-link callbacks arrive with tokens in the hash or query.
  if (hash.includes("access_token") || hash.includes("refresh_token")) return true;
  if (search.includes("code=") || search.includes("token_hash=")) return true;
  return false;
}

async function clearServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined") return;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // best-effort cleanup
  }
}

async function checkOnce(): Promise<void> {
  if (isAuthFlow()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  let remote: { version?: string } | null = null;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) return;
    remote = (await res.json()) as { version?: string };
  } catch {
    return;
  }
  const remoteVersion = remote?.version;
  if (!remoteVersion) return;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY, remoteVersion);
    return;
  }
  if (stored === remoteVersion) return;

  // Version changed — clear caches/SW and hard-reload.
  localStorage.setItem(STORAGE_KEY, remoteVersion);
  await clearServiceWorkers();
  const url = new URL(window.location.href);
  url.searchParams.set("v", remoteVersion);
  window.location.replace(url.toString());
}

export function startBuildVersionCheck(): () => void {
  if (started) return () => {};
  started = true;
  if (typeof window === "undefined") return () => {};
  if (!import.meta.env.PROD) return () => {};

  void checkOnce();
  const onFocus = () => void checkOnce();
  const onVisible = () => {
    if (document.visibilityState === "visible") void checkOnce();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
