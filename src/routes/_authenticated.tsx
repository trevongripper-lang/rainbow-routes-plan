import { createFileRoute, redirect, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Compass, CalendarDays, User2, LogOut, Map as MapIcon, Menu, X } from "lucide-react";

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
  const [open, setOpen] = useState(false);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const navItems = [
    { to: "/trips", label: "Trips", icon: Compass },
    { to: "/events", label: "Events", icon: CalendarDays },
    { to: "/map", label: "Map", icon: MapIcon },
    { to: "/me", label: "Mine", icon: User2 },
  ] as const;

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar with hamburger */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3 md:pl-72">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              className="rounded-md p-2 text-muted-foreground hover:bg-card hover:text-foreground md:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>
            <Link to="/trips" className="flex items-center gap-2 font-display text-lg md:hidden">
              <span className="inline-block size-2.5 rounded-full bg-primary" />
              Tribe Trips
            </Link>
          </div>
          <button onClick={signOut} className="rounded-full p-2 text-muted-foreground hover:text-foreground" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {/* Sidebar — fixed on md+, drawer on mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-border/60 bg-card/95 backdrop-blur transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <Link to="/trips" onClick={() => setOpen(false)} className="flex items-center gap-2 font-display text-lg">
            <span className="inline-block size-2.5 rounded-full bg-primary" />
            Tribe Trips
          </Link>
          <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground md:hidden" aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((n) => {
            const active = isActive(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground"
                }`}
              >
                <n.icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-border/60 p-3">
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            Open a trip to plan stays, tickets &amp; costs together.
          </p>
        </div>
      </aside>

      {/* Backdrop for mobile drawer */}
      {open && (
        <button
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm md:hidden"
          aria-label="Close menu backdrop"
        />
      )}

      <main className="px-4 py-6 md:pl-72">
        <div className="mx-auto max-w-5xl md:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
