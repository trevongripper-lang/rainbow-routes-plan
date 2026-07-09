import {
  createFileRoute,
  redirect,
  Outlet,
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getTripTabLinkProps } from "@/lib/trip-tab-link";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  Compass,
  CalendarDays,
  User2,
  LogOut,
  Map as MapIcon,
  X,
  MessageSquare,
  BedDouble,
  Ticket,
  Wallet,
  Star,
  ChevronRight,
  List,
  Plane,
  Sparkles,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { NotificationsBell } from "@/components/notifications-bell";

import { useMe } from "@/hooks/use-me";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

import { checkBetaConsent, BETA_CONSENT_VERSION, clearBetaConsentLocal } from "@/lib/beta-consent";
import { noteRedirect, clearRedirectTrace } from "@/lib/redirect-guard";
import { track } from "@/lib/analytics";
import {
  SESSION_HYDRATION_ERROR_MESSAGE,
  clearAuthSession,
  ensureAuthReady,
  getAuthState,
} from "@/lib/auth-state";
import { withTimeout } from "@/lib/utils";

// -----------------------------------------------------------------------------
// beforeLoad phase store — lets the pending component distinguish the stages
// so users never see a generic "Checking your session…" forever.
// -----------------------------------------------------------------------------
type AuthGatePhase = "checking-session" | "checking-beta-consent" | "redirecting" | "idle";
let currentPhase: AuthGatePhase = "idle";
const phaseSubscribers = new Set<() => void>();
function setPhase(next: AuthGatePhase) {
  if (currentPhase === next) return;
  currentPhase = next;
  phaseSubscribers.forEach((fn) => fn());
}
function getPhase() {
  return currentPhase;
}
function subscribePhase(fn: () => void) {
  phaseSubscribers.add(fn);
  return () => phaseSubscribers.delete(fn);
}

const AUTH_READY_TIMEOUT_MS = 4_000;
const BETA_CONSENT_TIMEOUT_MS = 5_000;

function debugLog(...args: unknown[]) {
  if (typeof window === "undefined") return;
  console.info("[auth-gate]", ...args);
}

function buildBetaConsentUrl(pathname: string, status: Awaited<ReturnType<typeof checkBetaConsent>>) {
  const params = new URLSearchParams({ next: pathname, reason: status });
  return `/beta-consent?${params.toString()}`;
}

function scheduleBrowserRedirectFallback(target: string) {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    const current = `${window.location.pathname}${window.location.search}`;
    const statusText = document.querySelector('[role="status"]')?.textContent ?? "";
    const stillShowingGate = /Checking your session|Checking beta consent|Redirecting/i.test(statusText);
    if (current !== target || stillShowingGate) {
      console.warn("[auth-gate] router redirect did not complete; using browser fallback", {
        current,
        target,
        statusText,
      });
      window.location.replace(target);
    }
  }, 1_500);
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    const t0 = performance.now();
    debugLog("entering beforeLoad", {
      path: location.pathname,
      contextAuthReady: context.auth.ready,
      contextAuthStatus: context.auth.status,
      snapshotAuthReady: getAuthState().ready,
      snapshotAuthStatus: getAuthState().status,
    });
    setPhase("checking-session");

    // ---- Session ----------------------------------------------------------
    let auth = context.auth.ready ? context.auth : getAuthState();
    if (!auth.ready) {
      const tAuth = performance.now();
      try {
        debugLog("before ensureAuthReady()", {
          timeoutMs: AUTH_READY_TIMEOUT_MS,
          contextAuthReady: context.auth.ready,
          snapshotAuthReady: getAuthState().ready,
        });
        auth = await withTimeout(ensureAuthReady(), AUTH_READY_TIMEOUT_MS, "ensureAuthReady");
        debugLog("after ensureAuthReady()", {
          elapsedMs: Math.round(performance.now() - tAuth),
          ready: auth.ready,
          status: auth.status,
          hasUser: Boolean(auth.user),
          error: auth.error,
        });
      } catch (err) {
        debugLog("ensureAuthReady() failed or timed out", {
          elapsedMs: Math.round(performance.now() - tAuth),
          message: err instanceof Error ? err.message : String(err),
        });
        setPhase("redirecting");
        scheduleBrowserRedirectFallback(`/auth?redirect=${encodeURIComponent(location.href)}`);
        throw redirect({ to: "/auth", search: { redirect: location.href } });
      }
    } else {
      debugLog("auth already ready before ensureAuthReady()", {
        source: context.auth.ready ? "router context" : "auth snapshot",
        ready: auth.ready,
        status: auth.status,
        hasUser: Boolean(auth.user),
      });
    }

    if (auth.error) {
      debugLog("auth error → redirect /auth", auth.error);
      setPhase("redirecting");
      scheduleBrowserRedirectFallback(`/auth?redirect=${encodeURIComponent(location.href)}`);
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    const user = auth.user ?? getAuthState().user;
    if (!user) {
      debugLog("no user → redirect /auth");
      setPhase("redirecting");
      if (noteRedirect(location.pathname, "/auth")) throw redirect({ to: "/recover" });
      scheduleBrowserRedirectFallback(`/auth?redirect=${encodeURIComponent(location.href)}`);
      throw redirect({
        to: "/auth",
        search: { redirect: location.href },
      });
    }

    // ---- Beta consent -----------------------------------------------------
    if (location.pathname !== "/beta-consent") {
      setPhase("checking-beta-consent");
      track("consent_check_started", {
        route: location.pathname,
        version: BETA_CONSENT_VERSION,
      });
      const tConsent = performance.now();
      // Authoritative DB check — never trust localStorage as a bypass.
      // Timeout-guarded so a hung fetch can't strand the user on the
      // loading screen; on timeout we fall through to /beta-consent with
      // reason=error so the user can recover instead of needing a refresh.
      let status: Awaited<ReturnType<typeof checkBetaConsent>>;
      try {
        debugLog("before checkBetaConsent()", {
          route: location.pathname,
          timeoutMs: BETA_CONSENT_TIMEOUT_MS,
          version: BETA_CONSENT_VERSION,
        });
        status = await withTimeout(
          checkBetaConsent(user.id),
          BETA_CONSENT_TIMEOUT_MS,
          "checkBetaConsent",
        );
        debugLog("after checkBetaConsent()", {
          status,
          elapsedMs: Math.round(performance.now() - tConsent),
          version: BETA_CONSENT_VERSION,
        });
      } catch (err) {
        debugLog("checkBetaConsent() failed or timed out", {
          elapsedMs: Math.round(performance.now() - tConsent),
          message: err instanceof Error ? err.message : String(err),
        });
        status = "error";
      }

      if (status === "current") {
        track("consent_current", { route: location.pathname, version: BETA_CONSENT_VERSION });
      } else {
        if (status === "missing") {
          track("consent_missing", {
            route: location.pathname,
            version: BETA_CONSENT_VERSION,
          });
        } else {
          track("consent_check_failed", {
            route: location.pathname,
            version: BETA_CONSENT_VERSION,
          });
        }
        track("consent_redirect_to_beta_consent", {
          route: location.pathname,
          status,
          version: BETA_CONSENT_VERSION,
        });
        setPhase("redirecting");
        const target = buildBetaConsentUrl(location.pathname, status);
        debugLog("redirect → /beta-consent", { status, target });
        if (noteRedirect(location.pathname, "/beta-consent")) throw redirect({ to: "/recover" });
        scheduleBrowserRedirectFallback(target);
        throw redirect({
          to: "/beta-consent",
          search: { next: location.pathname, reason: status },
        });
      }
    }

    clearRedirectTrace();
    setPhase("idle");
    debugLog(`beforeLoad done in ${(performance.now() - t0).toFixed(0)}ms`);
    return { user };
  },
  pendingComponent: GatePendingIndicator,
  errorComponent: () => (
    <div className="grid min-h-[50vh] place-items-center px-6 text-center text-sm text-muted-foreground">
      {SESSION_HYDRATION_ERROR_MESSAGE}
    </div>
  ),
  component: AppShell,
});

function GatePendingIndicator() {
  const phase = useSyncExternalStore(subscribePhase, getPhase, getPhase);
  const message =
    phase === "checking-beta-consent"
      ? "Checking beta consent…"
      : phase === "redirecting"
        ? "Redirecting…"
        : phase === "idle"
          ? "Opening Tribe Trips…"
          : "Checking your session…";
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-[50vh] place-items-center gap-3 text-sm text-muted-foreground"
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        {message}
      </span>
    </div>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    track("signout_succeeded");
    clearRedirectTrace();
    navigate({ to: "/auth", replace: true });
  }

  const navItems = [
    { to: "/events", label: "Events", icon: CalendarDays },
    { to: "/map", label: "Map", icon: MapIcon },
    { to: "/me", label: "Profile", icon: User2 },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ] as const;

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  /* Trip-detail contextual nav */
  const tripMatch = pathname.match(/^\/trips\/([^/]+)$/);
  const tripId = tripMatch?.[1];

  const tabItems: TabItem[] = [
    { key: "overview", label: "Chatter", icon: MessageSquare },
    { key: "itinerary", label: "Itinerary", icon: CalendarDays },
    { key: "flights", label: "Travel plans", icon: Plane },
    { key: "stays", label: "Where to stay", icon: BedDouble },
    { key: "tickets", label: "Tickets", icon: Ticket },
    { key: "costs", label: "Costs", icon: Wallet },
    { key: "ratings", label: "Ratings", icon: Star },
  ];

  const currentTab = typeof search.tab === "string" ? search.tab : "overview";
  const tripsActive = isActive("/trips");

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar
        navItems={navItems}
        isActive={isActive}
        tripId={tripId}
        currentTab={currentTab}
        tabItems={tabItems}
        tripsActive={tripsActive}
      />

      <SidebarInset className="min-w-0" style={{ background: "var(--gradient-hero)" }}>
        <header className="safe-top sticky top-0 z-20 border-b border-border/60 bg-background/60 backdrop-blur">
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:bg-card hover:text-foreground" />
              <Link to="/trips" className="flex items-center gap-2 font-display text-lg">
                <span className="inline-block size-2.5 rounded-full bg-primary" />
                Tribe Trips
              </Link>
            </div>

            <div className="flex items-center gap-1">
              <NotificationsBell />
              <button
                onClick={signOut}
                className="rounded-full p-2 text-muted-foreground hover:text-foreground"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <main className="safe-bottom flex-1 px-4 py-8 md:px-8 md:py-12">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

type NavItem = {
  to: "/events" | "/map" | "/me" | "/settings";
  label: string;
  icon: LucideIcon;
};

type TabItem = {
  key: string;
  label: string;
  icon: LucideIcon;
};

function AppSidebar({
  navItems,
  isActive,
  tripId,
  currentTab,
  tabItems,
  tripsActive,
}: {
  navItems: readonly NavItem[];
  isActive: (to: string) => boolean;
  tripId?: string;
  currentTab: string;
  tabItems: TabItem[];
  tripsActive: boolean;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [tripsOpen, setTripsOpen] = useState(tripsActive);

  useEffect(() => {
    if (tripsActive) setTripsOpen(true);
  }, [tripsActive]);

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/60">
      <SidebarHeader className="border-b border-sidebar-border/60 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/trips"
            onClick={closeMobile}
            className="flex items-center gap-2 font-display text-lg text-sidebar-foreground"
          >
            <span className="inline-block size-2.5 rounded-full bg-primary" />
            <span>Tribe Trips</span>
          </Link>

          {isMobile ? (
            <button
              onClick={() => setOpenMobile(false)}
              className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Trips group with expandable sub-menu */}
              <Collapsible
                open={tripsOpen}
                onOpenChange={setTripsOpen}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <div className="flex items-center">
                    <SidebarMenuButton
                      asChild
                      isActive={tripsActive}
                      tooltip="Trips"
                      className="flex-1"
                    >
                      <Link to="/trips" onClick={closeMobile} className="flex items-center gap-2">
                        <Compass className="size-4" />
                        <span>Trips</span>
                      </Link>
                    </SidebarMenuButton>
                    <CollapsibleTrigger
                      aria-label="Toggle trip menu"
                      className="ml-1 rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                      <ChevronRight
                        className={`size-4 transition-transform ${tripsOpen ? "rotate-90" : ""}`}
                      />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={pathname === "/trips"}>
                          <Link
                            to="/trips"
                            onClick={closeMobile}
                            className="flex items-center gap-2"
                          >
                            <List className="size-4" />
                            <span>My Trips</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      {tripId ? (
                        tabItems.map((tab) => {
                          const linkProps = getTripTabLinkProps(tripId, tab.key);
                          if (!linkProps.hasTrip) return null;
                          return (
                            <SidebarMenuSubItem key={tab.key}>
                              <SidebarMenuSubButton asChild isActive={currentTab === tab.key}>
                                <Link
                                  to={linkProps.to}
                                  params={linkProps.params}
                                  search={linkProps.search}
                                  onClick={closeMobile}
                                  className="flex items-center gap-2"
                                >
                                  <tab.icon className="size-4" />
                                  <span>{tab.label}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })
                      ) : (
                        <SidebarMenuSubItem>
                          <div className="px-2 py-1.5 text-xs text-sidebar-foreground/60">
                            Open a trip to see its sections here.
                          </div>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {navItems.map((item) => {
                const active = isActive(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link to={item.to} onClick={closeMobile} className="flex items-center gap-2">
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2">
        <SidebarSeparator />
        <ProUpsell />
      </SidebarFooter>
    </Sidebar>
  );
}

function ProUpsell() {
  const { data: me } = useMe();
  if ((me as { plus_status?: string } | null)?.plus_status === "active") {
    return (
      <Link
        to="/me"
        className="mx-1 flex items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-sidebar-foreground"
      >
        <Sparkles className="size-3.5 text-amber-400" /> Organizer Plus
      </Link>
    );
  }
  if (me?.is_pro) {
    return (
      <Link
        to="/me"
        className="mx-1 flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-sidebar-foreground"
      >
        <span className="inline-block size-1.5 rounded-full bg-primary" /> Pro · unlimited
      </Link>
    );
  }
  return (
    <Link
      to="/pricing"
      className="mx-1 flex flex-col gap-1 rounded-xl border border-border/60 bg-sidebar-accent/40 px-3 py-2.5 text-xs text-sidebar-foreground transition hover:border-primary/40 hover:bg-sidebar-accent/70"
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Sparkles className="size-3.5 text-accent" /> Pricing
      </span>
      <span className="text-sidebar-foreground/70">Free up to 5 · pay once per bigger trip</span>
    </Link>
  );
}
