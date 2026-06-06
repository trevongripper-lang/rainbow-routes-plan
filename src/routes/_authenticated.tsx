import { createFileRoute, redirect, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getTripTabLinkProps } from "@/lib/trip-tab-link";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Compass, CalendarDays, User2, LogOut, Map as MapIcon, X, MessageSquare, BedDouble, Ticket, Wallet, Star, ChevronRight, List, Plane, type LucideIcon } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AppShell,
});

function AppShell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const navItems = [
    { to: "/events", label: "Events", icon: CalendarDays },
    { to: "/map", label: "Map", icon: MapIcon },
    { to: "/me", label: "Mine", icon: User2 },
  ] as const;

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  /* Trip-detail contextual nav */
  const tripMatch = pathname.match(/^\/trips\/([^/]+)$/);
  const tripId = tripMatch?.[1];

  const tabItems: TabItem[] = [
    { key: "overview", label: "Chatter", icon: MessageSquare },
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
      <div className="min-h-screen w-full bg-background">
        <AppSidebar
          navItems={navItems}
          isActive={isActive}
          tripId={tripId}
          currentTab={currentTab}
          tabItems={tabItems}
          tripsActive={tripsActive}
        />

        <SidebarInset>
          <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
            <div className="flex h-14 items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-muted-foreground hover:bg-card hover:text-foreground" />
                <Link to="/trips" className="flex items-center gap-2 font-display text-lg">
                  <span className="inline-block size-2.5 rounded-full bg-primary" />
                  Tribe Trips
                </Link>
              </div>

              <button onClick={signOut} className="rounded-full p-2 text-muted-foreground hover:text-foreground" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </div>
          </header>

          <main className="px-4 py-6">
            <div className="mx-auto max-w-5xl md:px-6">
              <Outlet />
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

type NavItem = {
  to: "/events" | "/map" | "/me";
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
          <Link to="/trips" onClick={closeMobile} className="flex items-center gap-2 font-display text-lg text-sidebar-foreground">
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
              <Collapsible open={tripsOpen} onOpenChange={setTripsOpen} className="group/collapsible">
                <SidebarMenuItem>
                  <div className="flex items-center">
                    <SidebarMenuButton asChild isActive={tripsActive} tooltip="Trips" className="flex-1">
                      <Link to="/trips" onClick={closeMobile} className="flex items-center gap-2">
                        <Compass className="size-4" />
                        <span>Trips</span>
                      </Link>
                    </SidebarMenuButton>
                    <CollapsibleTrigger
                      aria-label="Toggle trip menu"
                      className="ml-1 rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                      <ChevronRight className={`size-4 transition-transform ${tripsOpen ? "rotate-90" : ""}`} />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={pathname === "/trips"}>
                          <Link to="/trips" onClick={closeMobile} className="flex items-center gap-2">
                            <List className="size-4" />
                            <span>My Trips</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      {tabItems.map((tab) => {
                        const linkProps = getTripTabLinkProps(tripId, tab.key);
                        return (
                          <SidebarMenuSubItem key={tab.key}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={linkProps.hasTrip && currentTab === tab.key}
                            >
                              {linkProps.hasTrip ? (
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
                              ) : (
                                <Link
                                  to={linkProps.to}
                                  onClick={closeMobile}
                                  className="flex items-center gap-2 opacity-70"
                                  title={linkProps.title}
                                >
                                  <tab.icon className="size-4" />
                                  <span>{tab.label}</span>
                                </Link>
                              )}
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}

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

      <SidebarFooter>
        <SidebarSeparator />
        <p className="px-2 py-1 text-xs text-sidebar-foreground/70">
          Open a trip to plan stays, tickets &amp; costs together.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
