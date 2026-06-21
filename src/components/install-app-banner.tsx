import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "tribe.install.dismissed";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
}

export function InstallAppBanner() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we hydrate

  useEffect(() => {
    if (typeof window === "undefined") return;
    setInstalled(isStandalone());
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || dismissed) return null;
  const canPrompt = !!deferred;
  if (!canPrompt && !isIOS()) return null;

  const handleInstall = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      setShowIOS(true);
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <>
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm md:mx-8">
        <Download className="size-4 shrink-0 text-primary" />
        <p className="flex-1 text-foreground/90">
          Install Tribe Trips for a faster, home-screen experience.
        </p>
        <button
          type="button"
          onClick={handleInstall}
          className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          Install
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Don't show again"
          title="Don't show again"
          className="rounded-full p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      {showIOS && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setShowIOS(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-5 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-base">Install on iPhone</h3>
              <button onClick={() => setShowIOS(false)} aria-label="Close"><X className="size-4" /></button>
            </div>
            <ol className="mt-3 space-y-2 text-muted-foreground">
              <li>1. Tap the <Share className="inline size-3.5" /> Share button in Safari's toolbar.</li>
              <li>2. Scroll and choose <strong className="text-foreground">Add to Home Screen</strong>.</li>
              <li>3. Tap <strong className="text-foreground">Add</strong> — Tribe Trips will appear on your home screen.</li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
