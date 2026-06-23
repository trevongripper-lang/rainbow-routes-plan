import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";

export function AttendeesCard({
  destinationId,
  onOpen,
}: {
  destinationId: string;
  onOpen?: () => void;
}) {
  const { data: members = [] } = useQuery({
    queryKey: ["trip-members", destinationId],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("trip_members")
        .select("user_id, role")
        .eq("destination_id", destinationId);
      const ids = (rows ?? []).map((r) => r.user_id);
      let profs: { id: string; display_name: string | null; avatar_url: string | null }[] = [];
      if (ids.length) {
        const { data } = await supabase.rpc("get_public_profiles", { _ids: ids });
        profs = data ?? [];
      }
      const pmap = new Map(profs.map((p) => [p.id, p]));
      return (rows ?? []).map((r) => ({ ...r, profile: pmap.get(r.user_id) }));
    },
  });

  if (!members.length) return null;
  const display = members.slice(0, 5);
  const overflow = members.length - display.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-2.5 py-1.5 text-xs hover:border-primary/50"
      aria-label={`${members.length} on this trip — manage`}
    >
      <Users className="size-3.5 text-muted-foreground" />
      <div className="flex -space-x-1.5">
        {display.map((m) => (
          <div
            key={m.user_id}
            title={m.profile?.display_name ?? "Member"}
            className="grid size-6 place-items-center rounded-full border border-card bg-primary/20 text-[10px] font-semibold text-primary"
          >
            {(m.profile?.display_name ?? "?").slice(0, 1).toUpperCase()}
          </div>
        ))}
        {overflow > 0 && (
          <div className="grid size-6 place-items-center rounded-full border border-card bg-muted text-[10px] font-medium text-muted-foreground">
            +{overflow}
          </div>
        )}
      </div>
      <span className="text-muted-foreground">{members.length} on this trip</span>
    </button>
  );
}
