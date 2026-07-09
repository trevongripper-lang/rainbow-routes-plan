import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, Mail, Link as LinkIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Member = {
  user_id: string;
  role: string | null;
  profile?: { id: string; display_name: string | null; avatar_url: string | null };
};

type Invite = {
  id: string;
  email: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  created_at: string;
};

function roleLabel(role: string | null | undefined) {
  if (role === "owner") return "Organizer";
  if (role === "co_organizer") return "Co-organizer";
  return "Member";
}

export function AttendeesCard({
  destinationId,
  onOpen,
}: {
  destinationId: string;
  /** Optional external handler; if provided, the built-in modal is disabled. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);

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
      return (rows ?? []).map<Member>((r) => ({ ...r, profile: pmap.get(r.user_id) }));
    },
  });

  const { data: invites = [] } = useQuery({
    queryKey: ["trip-invites", destinationId],
    queryFn: async (): Promise<Invite[]> => {
      const { data } = await supabase
        .from("trip_invites")
        .select("id, email, accepted_at, expires_at, created_at")
        .eq("destination_id", destinationId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: open,
  });

  if (!members.length) return null;
  const display = members.slice(0, 5);
  const overflow = members.length - display.length;
  const pendingInvites = invites.filter(
    (i) => !i.accepted_at && (!i.expires_at || new Date(i.expires_at) > new Date()),
  );

  const handleClick = () => {
    if (onOpen) onOpen();
    else setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-2.5 py-1.5 text-xs hover:border-primary/50"
        aria-label={`${members.length} on this trip — view crew`}
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

      {!onOpen && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>On this trip</DialogTitle>
              <DialogDescription>
                Everyone in the crew, plus outstanding invite links.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Crew ({members.length})
                </p>
                <ul className="space-y-1.5">
                  {members.map((m) => (
                    <li key={m.user_id} className="flex items-center gap-2 text-sm">
                      <div className="grid size-7 place-items-center rounded-full bg-primary/20 text-xs font-medium text-primary">
                        {(m.profile?.display_name ?? "?").slice(0, 1).toUpperCase()}
                      </div>
                      <span className="flex-1 truncate">
                        {m.profile?.display_name ?? "Member"}
                      </span>
                      <span className="rounded-full bg-accent/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-foreground">
                        {roleLabel(m.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {pendingInvites.length > 0 && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    Pending invites ({pendingInvites.length})
                  </p>
                  <ul className="space-y-1.5">
                    {pendingInvites.map((i) => (
                      <li
                        key={i.id}
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                      >
                        {i.email ? (
                          <>
                            <Mail className="size-4" />
                            <span className="flex-1 truncate">{i.email}</span>
                          </>
                        ) : (
                          <>
                            <LinkIcon className="size-4" />
                            <span className="flex-1 truncate">Shareable invite link</span>
                          </>
                        )}
                        <span className="text-[11px]">
                          {new Date(i.created_at).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
