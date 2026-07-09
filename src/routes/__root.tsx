import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster, toast } from "sonner";
import { RlsDebugPanel } from "@/components/rls-debug-panel";
import { InstallAppBanner } from "@/components/install-app-banner";
import {
  AuthProvider,
  startAuthStateListener,
  useAuthSnapshot,
  type AppAuthState,
} from "@/lib/auth-state";
import { startBuildVersionCheck } from "@/lib/build-version-check";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display">404</h1>
        <p className="mt-3 text-muted-foreground">This destination doesn't exist yet.</p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-display">Something went sideways</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try again or head home.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <a href="/" className="rounded-md border border-input px-4 py-2 text-sm font-medium">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  auth: AppAuthState;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { httpEquiv: "Cache-Control", content: "no-cache, no-store, must-revalidate" },
      { httpEquiv: "Pragma", content: "no-cache" },
      { httpEquiv: "Expires", content: "0" },
      { name: "theme-color", content: "#0b0b14" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Tribe Trips" },
      { title: "Tribe Trips — Plan gay vacations with your crew" },
      {
        name: "description",
        content:
          "Pitch destinations, upvote together, chatter about plans, and discover regional queer events.",
      },
      { property: "og:title", content: "Tribe Trips — Plan gay vacations with your crew" },
      {
        property: "og:description",
        content:
          "Pitch destinations, upvote together, chatter about plans, and discover regional queer events.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Tribe Trips — Plan gay vacations with your crew" },
      {
        name: "twitter:description",
        content:
          "Pitch destinations, upvote together, chatter about plans, and discover regional queer events.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/fc2c7643-f6eb-448a-832a-3c3ad272c237/id-preview-c58854ee--938ee2e4-e28c-4f9a-80fb-c8ac6ff9fb0b.lovable.app-1781065518657.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/fc2c7643-f6eb-448a-832a-3c3ad272c237/id-preview-c58854ee--938ee2e4-e28c-4f9a-80fb-c8ac6ff9fb0b.lovable.app-1781065518657.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const auth = useAuthSnapshot();

  useEffect(() => {
    router.update({
      ...router.options,
      context: {
        ...router.options.context,
        auth,
      },
    });
  }, [router, auth]);

  useEffect(() => {
    const stop = startAuthStateListener((event, nextAuth) => {
      router.update({
        ...router.options,
        context: {
          ...router.options.context,
          auth: nextAuth,
        },
      });

      if (
        event !== "INITIAL_SESSION" &&
        event !== "SIGNED_IN" &&
        event !== "TOKEN_REFRESHED" &&
        event !== "USER_UPDATED" &&
        event !== "SIGNED_OUT"
      ) {
        return;
      }

      window.setTimeout(() => {
        void router.invalidate();
        if (event !== "SIGNED_OUT" && nextAuth.session) void queryClient.invalidateQueries();
      }, 0);
    });
    return () => stop();
  }, [router, queryClient]);

  // Build version cache-busting check
  useEffect(() => {
    const stop = startBuildVersionCheck();
    return () => stop();
  }, []);

  // Page-load timing for tracked routes + offline toast
  useEffect(() => {
    const TRACKED = new Set([
      "/auth",
      "/beta-consent",
      "/trips",
      "/events",
      "/map",
      "/me",
      "/settings",
    ]);
    const SLOW_MS = 2500;
    let startedAt = performance.now();
    let startedPath = router.state.location.pathname;

    const unsub = router.subscribe("onResolved", () => {
      const path = router.state.location.pathname;
      const tracked =
        TRACKED.has(startedPath) ||
        startedPath.startsWith("/trips/") ||
        TRACKED.has(path) ||
        path.startsWith("/trips/");
      if (tracked) {
        const ms = Math.round(performance.now() - startedAt);
        const normalized = path.startsWith("/trips/") ? "/trips/:id" : path;
        void import("@/lib/analytics").then(({ track }) =>
          track("page_loaded", { route: normalized, ms, slow: ms > SLOW_MS }),
        );
      }
      startedAt = performance.now();
      startedPath = path;
    });

    const onOffline = () =>
      toast.warning("You're offline. Some actions may not save until you reconnect.");
    const onOnline = () => toast.success("Back online.");
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      unsub();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [router]);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <InstallAppBanner />
        <Toaster theme="dark" position="top-center" richColors />
        {import.meta.env.DEV && <RlsDebugPanel />}
      </QueryClientProvider>
    </AuthProvider>
  );
}
