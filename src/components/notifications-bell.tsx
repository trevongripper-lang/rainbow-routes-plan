import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bell } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";

type Notif = {
  id: string;
  destination_id: string | null;
  kind: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

const KIND_LABEL: Record<string, string> = {
  cost_added: "new cost",
  chatter_message: "new message",
  chatter_reply: "new reply",
  chatter_mention: "mentioned you",
  member_joined: "new member",
  event_added: "new event",
  trip_closed: "trip closed — rate it",
  settlement_recorded: "settlement recorded",
  welcome: "welcome",
};

const KIND_TAB: Record<string, string> = {
  cost_added: "costs",
  settlement_recorded: "costs",
  chatter_message: "overview",
  chatter_reply: "overview",
  chatter_mention: "overview",
  member_joined: "overview",
  event_added: "itinerary",
  trip_closed: "ratings",
};

export function NotificationsBell() {
  const qc = useQueryClient();

  const { data: meId } = useQuery({
    queryKey: ["me-id"],
    queryFn: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
    staleTime: Infinity,
  });

  const { data: notifs = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: async (): Promise<Notif[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, destination_id, kind, payload, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as Notif[]) ?? [];
    },
    enabled: !!meId,
  });

  const tripIds = useMemo(
    () =>
      Array.from(
        new Set(notifs.map((n) => n.destination_id).filter((id): id is string => id !== null)),
      ),
    [notifs],
  );
  const { data: trips = [] } = useQuery({
    queryKey: ["notif-trips", tripIds.join(",")],
    queryFn: async () => {
      if (tripIds.length === 0) return [];
      const { data } = await supabase
        .from("destinations")
        .select("id, title, region")
        .in("id", tripIds);
      return data ?? [];
    },
    enabled: tripIds.length > 0,
  });
  const tripMap = new Map(trips.map((t) => [t.id, t]));

  // Realtime
  useEffect(() => {
    if (!meId) return;
    const ch = supabase
      .channel(`notif-${meId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${meId}` },
        () => qc.invalidateQueries({ queryKey: ["notifications"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [meId, qc]);

  const markRead = useMutation({
    mutationFn: async (destinationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("destination_id", destinationId)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!meId) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", meId)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      if (!meId) return;
      const { error } = await supabase.from("notifications").delete().eq("user_id", meId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Group by trip (system notifications without a destination get their own row keyed by notif id)
  type Group = {
    key: string;
    destinationId: string | null;
    title: string;
    region: string;
    total: number;
    unread: number;
    latest: Notif;
    kinds: string[];
  };
  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Group>();
    for (const n of notifs) {
      const key = n.destination_id ?? `sys:${n.id}`;
      const t = n.destination_id ? tripMap.get(n.destination_id) : undefined;
      const fallbackTitle =
        n.kind === "welcome"
          ? ((n.payload?.title as string | undefined) ?? "Welcome to Tribe Trips 👋")
          : "Trip";
      const g = m.get(key);
      if (!g) {
        m.set(key, {
          key,
          destinationId: n.destination_id,
          title: t?.title ?? fallbackTitle,
          region: t?.region ?? "",
          total: 1,
          unread: n.read_at ? 0 : 1,
          latest: n,
          kinds: [n.kind],
        });
      } else {
        g.total += 1;
        if (!n.read_at) g.unread += 1;
        if (new Date(n.created_at) > new Date(g.latest.created_at)) g.latest = n;
        if (!g.kinds.includes(n.kind)) g.kinds.push(n.kind);
      }
    }
    return Array.from(m.values()).sort(
      (a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime(),
    );
  }, [notifs, tripMap]);

  const markNotifRead = useMutation({
    mutationFn: async (notifId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notifId)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const totalUnread = groups.reduce((s, g) => s + g.unread, 0);

  const renderBody = (g: Group) => (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{g.title}</span>
        {g.unread > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {g.unread}
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {g.latest.kind === "welcome" && g.latest.payload?.body
          ? (g.latest.payload.body as string)
          : `${KIND_LABEL[g.latest.kind] ?? g.latest.kind} · ${formatDistanceToNow(new Date(g.latest.created_at), { addSuffix: true })}`}
      </div>
      {g.kinds.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {g.kinds.slice(0, 4).map((k) => (
            <span
              key={k}
              className="rounded-full bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {KIND_LABEL[k] ?? k}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const [open, setOpen] = useState(false);

  // Auto mark-all-read shortly after the user opens the panel
  useEffect(() => {
    if (!open || totalUnread === 0) return;
    const t = setTimeout(() => markAllRead.mutate(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-full p-2 text-muted-foreground hover:text-foreground"
          title="Notifications"
          aria-label={`Notifications${totalUnread ? ` (${totalUnread} unread)` : ""}`}
        >
          <Bell className="size-4" />
          {totalUnread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Notifications {totalUnread > 0 && `· ${totalUnread} unread`}</span>
          <div className="flex items-center gap-1">
            {totalUnread > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="rounded-full px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
            {groups.length > 0 && (
              <button
                type="button"
                onClick={() => clearAll.mutate()}
                disabled={clearAll.isPending}
                className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-50"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {groups.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          )}
          {groups.map((g) =>
            g.destinationId ? (
              <Link
                key={g.key}
                to="/trips/$id"
                params={{ id: g.destinationId }}
                search={{ tab: KIND_TAB[g.latest.kind] ?? "overview" }}
                onClick={() => markRead.mutate(g.destinationId!)}
                className={`flex items-start gap-3 border-b border-border/40 px-4 py-3 transition hover:bg-card/60 ${g.unread > 0 ? "bg-primary/5" : ""}`}
              >
                {renderBody(g)}
              </Link>
            ) : (
              <button
                key={g.key}
                type="button"
                onClick={() => g.unread > 0 && markNotifRead.mutate(g.latest.id)}
                className={`flex w-full items-start gap-3 border-b border-border/40 px-4 py-3 text-left transition hover:bg-card/60 ${g.unread > 0 ? "bg-primary/5" : ""}`}
              >
                {renderBody(g)}
              </button>
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
