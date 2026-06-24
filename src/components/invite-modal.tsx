import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Copy, Link as LinkIcon, Share2, UserPlus, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function InviteModal({
  destinationId,
  isOwner = false,
}: {
  destinationId: string;
  isOwner?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const { data: members = [] } = useQuery({
    queryKey: ["trip-members", destinationId],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("trip_members")
        .select("user_id, role, joined_at")
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
    enabled: open,
    refetchOnWindowFocus: true,
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw new Error("Sign in required");
      const { data, error } = await supabase
        .from("trip_invites")
        .insert({ destination_id: destinationId, invited_by: s.session.user.id, email: null })
        .select("token")
        .single();
      if (error) throw error;
      return data.token as string;
    },
  });

  const inviteLinkFor = (token: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/join/${token}`;

  const ensureLink = async () => {
    if (lastUrl) return lastUrl;
    const token = await createInvite.mutateAsync();
    const url = inviteLinkFor(token);
    setLastUrl(url);
    return url;
  };

  const onCopyLink = async () => {
    try {
      const url = await ensureLink();
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied — paste it into your group chat");
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't copy link");
    }
  };

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const onNativeShare = async () => {
    try {
      const url = await ensureLink();
      await navigator.share({
        title: "Join my trip on Tribe Trips",
        text: "I'm planning a trip on Tribe Trips — join me!",
        url,
      });
    } catch (e) {
      // user-cancelled share throws AbortError; ignore
      if (e instanceof Error && e.name !== "AbortError") {
        toast.error(e.message);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setLastUrl(null); }}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-1.5">
          <UserPlus className="size-4" /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to this trip</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-md border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
            Copy this invite link and send it to your friends by text, email, WhatsApp, or group
            chat. Tribe Trips does not email trip invites automatically yet.
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Shareable invite link</Label>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can join after signing in or creating an account.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={onCopyLink}
                disabled={createInvite.isPending}
                variant="outline"
                className="flex-1 justify-start gap-2"
              >
                {copied ? (
                  <Check className="size-4 text-emerald-400" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied!" : lastUrl ? "Copy link again" : "Create & copy invite link"}
              </Button>
              {canShare && (
                <Button
                  onClick={onNativeShare}
                  disabled={createInvite.isPending}
                  variant="outline"
                  size="icon"
                  aria-label="Share invite link"
                >
                  <Share2 className="size-4" />
                </Button>
              )}
            </div>
            {lastUrl && (
              <p className="break-all rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                {lastUrl}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">Current crew ({members.length})</Label>
            <ul className="mt-2 space-y-1.5">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-2 text-sm">
                  <div className="grid size-7 place-items-center rounded-full bg-primary/20 text-xs font-medium text-primary">
                    {(m.profile?.display_name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                  <span className="flex-1 truncate">{m.profile?.display_name ?? "Member"}</span>
                  {m.role === "owner" && (
                    <span className="rounded-full bg-accent/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-foreground">
                      Owner
                    </span>
                  )}
                  {isOwner && m.role !== "owner" && (
                    <button
                      onClick={async () => {
                        if (
                          !confirm(
                            `Remove ${m.profile?.display_name ?? "this member"} from the trip?`,
                          )
                        )
                          return;
                        const { error } = await supabase
                          .from("trip_members")
                          .delete()
                          .eq("destination_id", destinationId)
                          .eq("user_id", m.user_id);
                        if (error) toast.error(error.message);
                        else {
                          toast.success("Removed");
                          qc.invalidateQueries({ queryKey: ["trip-members", destinationId] });
                        }
                      }}
                      aria-label="Remove member"
                      className="rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
            <LinkIcon className="mr-1 inline size-3" />
            Free plan trips are capped at 5 people total.{" "}
            <a href="/pricing" className="text-primary hover:underline">
              Upgrade to Pro
            </a>{" "}
            for unlimited crews.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
