import { createFileRoute, redirect, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Compass, CalendarDays, User2, LogOut, Map as MapIcon } from "lucide-react";

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

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/trips" className="flex items-center gap-2 font-display text-lg">
            <span className="inline-block size-2.5 rounded-full bg-primary" />
            Tribe Trips
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((n) => {
              const active = pathname.startsWith(n.to);
              return (
                <Link key={n.to} to={n.to} className={`rounded-full px-4 py-1.5 text-sm transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {n.label}
                </Link>
              );
            })}
            <button onClick={signOut} className="ml-2 rounded-full p-2 text-muted-foreground hover:text-foreground" title="Sign out">
              <LogOut className="size-4" />
            </button>
          </nav>
          <button onClick={signOut} className="rounded-full p-2 text-muted-foreground hover:text-foreground md:hidden" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-border/60 bg-background/95 backdrop-blur md:hidden">
        {navItems.map((n) => {
          const active = pathname.startsWith(n.to);
          return (
            <Link key={n.to} to={n.to} className={`flex flex-col items-center gap-1 py-3 text-xs ${active ? "text-primary" : "text-muted-foreground"}`}>
              <n.icon className="size-5" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
