import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Link as LinkIcon, Mail, UserPlus, Check } from "lucide-react";
import { toast } from "sonner";

export function InviteModal({ destinationId }: { destinationId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

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
  });

  const createInvite = useMutation({
    mutationFn: async (forEmail: string | null) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sign in required");
      const { data, error } = await supabase
        .from("trip_invites")
        .insert({ destination_id: destinationId, invited_by: u.user.id, email: forEmail })
        .select("token")
        .single();
      if (error) throw error;
      return data.token as string;
    },
  });

  const inviteLinkFor = (token: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/join/${token}`;

  const onCopyLink = async () => {
    const token = await createInvite.mutateAsync(null);
    const url = inviteLinkFor(token);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Invite link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const onEmailInvite = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      toast.error("Enter a valid email");
      return;
    }
    const token = await createInvite.mutateAsync(trimmed);
    const url = inviteLinkFor(token);
    await navigator.clipboard.writeText(url);
    setEmail("");
    qc.invalidateQueries({ queryKey: ["trip-members", destinationId] });
    toast.success(`Invite for ${trimmed} created — link copied. Email sending will activate once your email domain is verified.`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <div>
            <p className="text-sm text-foreground/90">
              Get your tribe out of the text thread and off to the next adventure.
            </p>
            <Label className="mt-3 block text-xs">Shareable link</Label>
            <p className="mt-1 text-xs text-muted-foreground">Anyone signed in with this link can join.</p>
            <Button onClick={onCopyLink} disabled={createInvite.isPending} variant="outline" className="mt-2 w-full justify-start gap-2">
              {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
              {copied ? "Copied!" : "Create & copy invite link"}
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5"><Mail className="size-3" /> Invite by email</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@example.com"
                onKeyDown={(e) => { if (e.key === "Enter") onEmailInvite(); }}
              />
              <Button onClick={onEmailInvite} disabled={createInvite.isPending || !email.includes("@")}>Send</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Creates an invite link and copies it. Email delivery activates once a verified sender domain is configured.
            </p>
          </div>

          <div>
            <Label className="text-xs">Current crew ({members.length})</Label>
            <ul className="mt-2 space-y-1.5">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-2 text-sm">
                  <div className="grid size-7 place-items-center rounded-full bg-primary/20 text-xs font-medium text-primary">
                    {(m.profile?.display_name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                  <span className="truncate">{m.profile?.display_name ?? "Member"}</span>
                  {m.role === "owner" && <span className="rounded-full bg-accent/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-foreground">Owner</span>}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
            <LinkIcon className="mr-1 inline size-3" />
            Free plan trips are capped at 5 people total. <a href="/pricing" className="text-primary hover:underline">Upgrade to Pro</a> for unlimited crews.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
