import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { quoteUnlock, unlockTripWithCredit } from "@/lib/unlock.functions";
import { startPaddleCheckout } from "@/lib/paddle-checkout.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Lock, Sparkles, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { loadPaddle } from "@/lib/paddle-client";

const TIER_LABEL: Record<string, string> = {
  tier1: "6–10 people",
  tier2: "11–20 people",
  tier3: "21+ people",
};

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function UnlockTripButton({ destinationId, isOwner }: { destinationId: string; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const quote = useServerFn(quoteUnlock);
  const spend = useServerFn(unlockTripWithCredit);
  const startCheckout = useServerFn(startPaddleCheckout);
  const [paying, setPaying] = useState(false);

  async function handlePay() {
    try {
      setPaying(true);
      const cfg = await startCheckout({ data: { destinationId } });
      const paddle = await loadPaddle({
        clientToken: cfg.clientToken,
        environment: cfg.environment,
        onComplete: () => {
          toast.success("Payment received — unlocking your trip…");
          // Webhook unlocks server-side; refetch shortly after.
          setTimeout(() => {
            qc.invalidateQueries({ queryKey: ["trip", destinationId] });
            qc.invalidateQueries({ queryKey: ["unlock-quote", destinationId] });
          }, 1500);
          setOpen(false);
        },
      });
      if (!paddle) throw new Error("Failed to load Paddle");
      paddle.Checkout.open({
        items: [{ priceId: cfg.priceId, quantity: 1 }],
        customer: cfg.customerEmail ? { email: cfg.customerEmail } : undefined,
        customData: cfg.customData,
        settings: { displayMode: "overlay", theme: "dark", allowLogout: false },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout");
    } finally {
      setPaying(false);
    }
  }

  const q = useQuery({
    queryKey: ["unlock-quote", destinationId],
    queryFn: () => quote({ data: { destinationId } }),
    enabled: isOwner,
  });

  const useCredit = useMutation({
    mutationFn: () => spend({ data: { destinationId } }),
    onSuccess: () => {
      toast.success("Trip unlocked with a free credit ✨");
      qc.invalidateQueries({ queryKey: ["trip", destinationId] });
      qc.invalidateQueries({ queryKey: ["unlock-quote", destinationId] });
      qc.invalidateQueries({ queryKey: ["my-credits"] });
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not unlock"),
  });

  if (!isOwner || !q.data) return null;
  const { status, tier, priceCents, creditsAvailable, dueCents } = q.data;

  // Already unlocked → tiny badge
  if (status !== "free") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
        <CheckCircle2 className="size-3.5" />
        {status === "paid" ? "Unlocked" : "Unlocked (credit)"}
      </span>
    );
  }

  // Free tier → no unlock needed
  if (tier === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
        Free tier · up to 5 people
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="gap-1.5">
          <Lock className="size-3.5" /> Unlock trip — {fmt(priceCents)}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Unlock this trip</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tier</p>
                <p className="font-display text-lg">{TIER_LABEL[tier!]}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Price</p>
                <p className="font-display text-2xl">{fmt(priceCents)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Organizer pays once. Unlocks for everyone on the trip, forever.
            </p>
          </div>

          {creditsAvailable > 0 && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="size-4 text-primary" />
                You have <strong>{creditsAvailable}</strong> free credit{creditsAvailable === 1 ? "" : "s"}.
                Use 1 to unlock this trip at no cost.
              </div>
              <Button
                className="mt-3 w-full"
                onClick={() => useCredit.mutate()}
                disabled={useCredit.isPending}
              >
                {useCredit.isPending ? "Unlocking…" : `Use 1 free credit — ${fmt(0)} due`}
              </Button>
            </div>
          )}

          <Button
            variant={creditsAvailable > 0 ? "outline" : "default"}
            className="w-full"
            disabled
            title="Checkout coming online soon"
          >
            Pay {fmt(dueCents || priceCents)} (checkout coming online soon)
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Hosted checkout will be wired up once payments are enabled for this project.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
