import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Share, X, Plus, MoreVertical, MonitorDown } from "lucide-react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const SNOOZE_KEY = "tribe.install.snoozed_until";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// --- platform detection -----------------------------------------------------

type Platform =
  | "ios-safari" // iPhone/iPad in Safari (Add to Home Screen)
  | "ios-other" // iOS Chrome/Firefox (must open in Safari to install)
  | "android-chromium" // Android Chrome/Edge/Samsung (beforeinstallprompt)
  | "android-firefox" // Android Firefox (manual install via menu)
  | "desktop-chromium" // Desktop Chrome/Edge (beforeinstallprompt)
  | "desktop-other" // Desktop Safari/Firefox (limited/no install)
  | "unknown";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const isIPad =
    /ipad/i.test(ua) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1);
  const isIOS = /iphone|ipod/i.test(ua) || isIPad;
  const isAndroid = /android/i.test(ua);
  const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
  const isChromium = /chrome|crios|edg|edgios|samsungbrowser/i.test(ua);
  const isFirefox = /firefox|fxios/i.test(ua);

  if (isIOS) return isSafari ? "ios-safari" : "ios-other";
  if (isAndroid) {
    if (isFirefox) return "android-firefox";
    if (isChromium) return "android-chromium";
    return "unknown";
  }
  if (isChromium) return "desktop-chromium";
  if (isSafari || isFirefox) return "desktop-other";
  return "unknown";
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// --- hook -------------------------------------------------------------------

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setInstalled(isStandalone());
    setPlatform(detectPlatform());
    setReady(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const canNativePrompt = !!deferred;

  // Whether install is achievable at all (native or guided).
  const canInstall = useMemo(() => {
    if (installed) return false;
    if (canNativePrompt) return true;
    return (
      platform === "ios-safari" ||
      platform === "ios-other" ||
      platform === "android-chromium" ||
      platform === "android-firefox" ||
      platform === "desktop-chromium"
    );
  }, [installed, canNativePrompt, platform]);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "guided"> => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      if (choice.outcome === "accepted") setInstalled(true);
      return choice.outcome;
    }
    return "guided";
  }, [deferred]);

  return { ready, installed, platform, canInstall, canNativePrompt, promptInstall };
}

// --- shared instructions modal ---------------------------------------------

function InstructionsModal({ platform, onClose }: { platform: Platform; onClose: () => void }) {
  const { title, steps, hint } = getInstructions(platform);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      style={{
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        paddingTop: "max(1rem, env(safe-area-inset-top))",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-5 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-base">{title}</h3>
          <button onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <ol className="mt-3 space-y-2 text-muted-foreground">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-foreground/70">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {hint && <p className="mt-3 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function getInstructions(platform: Platform): {
  title: string;
  steps: React.ReactNode[];
  hint?: string;
} {
  switch (platform) {
    case "ios-safari":
      return {
        title: "Install on iPhone / iPad",
        steps: [
          <>
            Tap the <Share className="inline size-3.5" /> Share button in Safari's toolbar.
          </>,
          <>
            Scroll and choose <strong className="text-foreground">Add to Home Screen</strong>.
          </>,
          <>
            Tap <strong className="text-foreground">Add</strong> — Tribe Trips will appear on your
            home screen.
          </>,
        ],
      };
    case "ios-other":
      return {
        title: "Open in Safari to install",
        steps: [
          <>Copy this page's URL.</>,
          <>Open it in Safari (Chrome and Firefox on iOS can't install web apps).</>,
          <>
            Tap <Share className="inline size-3.5" /> Share →{" "}
            <strong className="text-foreground">Add to Home Screen</strong>.
          </>,
        ],
        hint: "Apple only allows Safari to install web apps on iOS.",
      };
    case "android-chromium":
      return {
        title: "Install on Android",
        steps: [
          <>
            Tap the <MoreVertical className="inline size-3.5" /> menu in Chrome's toolbar.
          </>,
          <>
            Choose <strong className="text-foreground">Install app</strong> or{" "}
            <strong className="text-foreground">Add to Home screen</strong>.
          </>,
          <>Confirm — Tribe Trips will launch like a native app.</>,
        ],
        hint: "If you see a prompt at the bottom of the screen, tap Install.",
      };
    case "android-firefox":
      return {
        title: "Install on Firefox",
        steps: [
          <>
            Tap the <MoreVertical className="inline size-3.5" /> menu.
          </>,
          <>
            Choose <strong className="text-foreground">Install</strong> or{" "}
            <strong className="text-foreground">Add to Home screen</strong>.
          </>,
        ],
      };
    case "desktop-chromium":
      return {
        title: "Install on your computer",
        steps: [
          <>
            Look for the <MonitorDown className="inline size-3.5" /> install icon in the address
            bar.
          </>,
          <>
            Or open the browser menu and choose{" "}
            <strong className="text-foreground">Install Tribe Trips…</strong>
          </>,
          <>Confirm — Tribe Trips will open in its own window.</>,
        ],
      };
    case "desktop-other":
      return {
        title: "Install isn't supported here",
        steps: [
          <>Desktop Safari and Firefox don't support installing web apps.</>,
          <>Open Tribe Trips in Chrome, Edge, or Brave to install it.</>,
        ],
      };
    default:
      return {
        title: "Install Tribe Trips",
        steps: [
          <>Open your browser's menu.</>,
          <>
            Look for <strong className="text-foreground">Install</strong> or{" "}
            <strong className="text-foreground">Add to Home Screen</strong>.
          </>,
        ],
      };
  }
}

// --- opportunistic banner --------------------------------------------------

export function InstallAppBanner() {
  const { ready, installed, platform, canInstall, canNativePrompt, promptInstall } =
    useInstallPrompt();
  const [snoozed, setSnoozed] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    setSnoozed(Date.now() < until);
  }, []);

  if (!ready || installed || snoozed || !canInstall) return null;

  const handleInstall = async () => {
    if (canNativePrompt) {
      const outcome = await promptInstall();
      if (outcome === "dismissed") snooze();
      return;
    }
    setShowModal(true);
  };

  const snooze = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setSnoozed(true);
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
          onClick={snooze}
          aria-label="Remind me later"
          title="Remind me later"
          className="rounded-full p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      {showModal && <InstructionsModal platform={platform} onClose={() => setShowModal(false)} />}
    </>
  );
}

// --- persistent action (Settings, menus) -----------------------------------

export function InstallAppButton({
  className,
  label = "Install app",
}: {
  className?: string;
  label?: string;
}) {
  const { ready, installed, platform, canNativePrompt, promptInstall } = useInstallPrompt();
  const [showModal, setShowModal] = useState(false);

  if (!ready) return null;

  const onClick = async () => {
    if (installed) return;
    if (canNativePrompt) {
      const outcome = await promptInstall();
      if (outcome === "guided") setShowModal(true);
      return;
    }
    setShowModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={installed}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 text-sm hover:border-primary/50 hover:text-primary disabled:opacity-60"
        }
      >
        <Plus className="size-4" />
        {installed ? "Installed" : label}
      </button>
      {showModal && <InstructionsModal platform={platform} onClose={() => setShowModal(false)} />}
    </>
  );
}
