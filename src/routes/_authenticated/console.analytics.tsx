import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/console/analytics")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw notFound();
    const { data } = await supabase.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
    if (!data) throw notFound();
  },
  component: AnalyticsPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Analytics console" }] }),
});

type Row = { id: string; event: string; props: Record<string, unknown>; created_at: string; user_id: string | null; destination_id: string | null };

function AnalyticsPage() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["analytics-events"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("analytics_events" as any) as any)
        .select("id, event, props, created_at, user_id, destination_id")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const stats = useMemo(() => {
    const byEvent = new Map<string, number>();
    const byDay = new Map<string, number>();
    const uniqueUsers = new Set<string>();
    for (const r of rows) {
      byEvent.set(r.event, (byEvent.get(r.event) ?? 0) + 1);
      const day = r.created_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      if (r.user_id) uniqueUsers.add(r.user_id);
    }
    return {
      total: rows.length,
      uniqueUsers: uniqueUsers.size,
      byEvent: Array.from(byEvent.entries()).sort((a, b) => b[1] - a[1]),
      byDay: Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [rows]);

  const maxDay = Math.max(1, ...stats.byDay.map(([, n]) => n));

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <header className="flex items-center gap-3">
        <BarChart3 className="size-6 text-primary" />
        <div>
          <h1 className="font-display text-2xl">Usage analytics</h1>
          <p className="text-sm text-muted-foreground">Last 30 days · admin only.</p>
        </div>
      </header>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Total events" value={stats.total} />
            <Stat label="Unique users" value={stats.uniqueUsers} />
            <Stat label="Event types" value={stats.byEvent.length} />
          </div>

          <section className="rounded-2xl border border-border/60 bg-card p-5">
            <h2 className="font-display text-lg">Events per day</h2>
            <div className="mt-4 flex h-40 items-end gap-1">
              {stats.byDay.length === 0 && <p className="text-sm text-muted-foreground">No data yet.</p>}
              {stats.byDay.map(([day, n]) => (
                <div key={day} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${day}: ${n}`}>
                  <div
                    className="w-full rounded-t bg-primary/70 transition group-hover:bg-primary"
                    style={{ height: `${(n / maxDay) * 100}%`, minHeight: 2 }}
                  />
                  <span className="text-[9px] text-muted-foreground">{day.slice(5)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card p-5">
            <h2 className="font-display text-lg">Top events</h2>
            <ul className="mt-3 divide-y divide-border/40 text-sm">
              {stats.byEvent.map(([event, n]) => (
                <li key={event} className="flex items-center justify-between py-2">
                  <span className="font-mono text-xs">{event}</span>
                  <span className="tabular-nums text-muted-foreground">{n}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-3xl tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
