import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyCredits } from "@/lib/unlock.functions";
import { Sparkles, Award } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PromoCodeRedeem } from "@/components/promo-code-redeem";

export function CreditsPanel() {
  const fn = useServerFn(getMyCredits);
  const { data } = useQuery({ queryKey: ["my-credits"], queryFn: () => fn({ data: {} as never }) });
  if (!data) return null;
  const { total, loyaltyRemaining, paidTripCount, loyaltyProgress, loyaltyTarget } = data;
  const pct = Math.round((loyaltyProgress / loyaltyTarget) * 100);

  return (
    <section className="rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">Your unlock credits</h2>
        <Link to="/pricing" className="text-xs text-muted-foreground hover:text-primary">How credits work →</Link>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-primary"><Sparkles className="size-4" /><span className="text-xs uppercase tracking-wide">Available</span></div>
          <p className="mt-1 font-display text-3xl">{total}</p>
          <p className="text-xs text-muted-foreground">credits ready to spend</p>
        </div>
        <div className="rounded-xl border border-border/60 p-4">
          <div className="flex items-center gap-2 text-muted-foreground"><Award className="size-4" /><span className="text-xs uppercase tracking-wide">Loyalty</span></div>
          <p className="mt-1 font-display text-3xl">{loyaltyRemaining}</p>
          <p className="text-xs text-muted-foreground">from paid trips</p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">
            Loyalty progress · <strong>{loyaltyProgress}/{loyaltyTarget}</strong> paid trips toward next 2 free
          </span>
          <span className="text-muted-foreground tabular-nums">{paidTripCount} paid total</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <PromoCodeRedeem />
    </section>
  );
}
