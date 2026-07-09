import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { quoteUnlock } from "@/lib/unlock.functions";
import { startPaddleCheckout } from "@/lib/paddle-checkout.functions";
import { validatePaddleConfig, type PaddleConfigIssue } from "@/lib/paddle-config.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Lock, CheckCircle2, AlertTriangle } from "lucide-react";
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

export function UnlockTripButton({
  destinationId,
  isOwner,
}: {
  destinationId: string;
  isOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const quote = useServerFn(quoteUnlock);
  const startCheckout = useServerFn(startPaddleCheckout);
  const validateConfig = useServerFn(validatePaddleConfig);
  const [paying, setPaying] = useState(false);
  const [configIssues, setConfigIssues] = useState<PaddleConfigIssue[] | null>(null);

  async function handlePay() {
    try {
      setPaying(true);
      setConfigIssues(null);

      const cfg = await startCheckout({ data: { destinationId } });
      const paddle = await loadPaddle({
        clientToken: cfg.clientToken,
        environment: cfg.environment,
        onComplete: () => {
          toast.success("Payment received — unlocking your trip…");
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
      try {
        const report = await validateConfig({});
        if (!report.ok) {
          setConfigIssues(report.issues);
          toast.error(
            `Paddle is misconfigured (${report.issues.length} issue${report.issues.length === 1 ? "" : "s"})`,
          );
        } else {
          toast.error(e instanceof Error ? e.message : "Could not start checkout");
        }
      } catch {
        toast.error(e instanceof Error ? e.message : "Could not start checkout");
      }
    } finally {
      setPaying(false);
    }
  }

  const q = useQuery({
    queryKey: ["unlock-quote", destinationId],
    queryFn: () => quote({ data: { destinationId } }),
    enabled: isOwner,
  });

  if (!isOwner || !q.data) return null;
  const { status, tier, priceCents } = q.data;

  if (status !== "free") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
        <CheckCircle2 className="size-3.5" />
        Unlocked
      </span>
    );
  }

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

          {configIssues && configIssues.length > 0 && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="size-4" />
                Paddle configuration problems
              </div>
              <ul className="mt-2 space-y-2">
                {configIssues.map((i) => (
                  <li
                    key={i.secret}
                    className="rounded-lg border border-destructive/30 bg-background/40 p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs font-semibold">{i.secret}</code>
                      <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
                        {i.problem.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{i.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button className="w-full" onClick={handlePay} disabled={paying}>
            {paying ? "Opening checkout…" : `Pay ${fmt(priceCents)} with card / Apple Pay`}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Secure checkout by Paddle · sandbox mode
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
