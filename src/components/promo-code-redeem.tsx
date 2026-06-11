import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ticket, Loader2 } from "lucide-react";
import { redeemPromoCode } from "@/lib/promo.functions";

export function PromoCodeRedeem() {
  const qc = useQueryClient();
  const fn = useServerFn(redeemPromoCode);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const mut = useMutation({
    mutationFn: (c: string) => fn({ data: { code: c } }),
    onSuccess: (res) => {
      const days = Math.max(1, Math.round((new Date(res.expiresAt).getTime() - Date.now()) / 86400000));
      setMsg({ kind: "ok", text: `🎉 ${res.credits} credit${res.credits === 1 ? "" : "s"} added · expire in ${days} days` });
      setCode("");
      qc.invalidateQueries({ queryKey: ["my-credits"] });
    },
    onError: (e: Error) => setMsg({ kind: "err", text: e.message }),
  });

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border/60 bg-background/40 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Ticket className="size-4" />
        <span className="text-xs uppercase tracking-wide">Have a promo code?</span>
      </div>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          if (code.trim()) mut.mutate(code.trim());
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ENTER CODE"
          maxLength={64}
          className="flex-1 min-w-[12rem] rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-mono tracking-wider outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={mut.isPending || !code.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {mut.isPending && <Loader2 className="size-3.5 animate-spin" />} Redeem
        </button>
      </form>
      {msg && (
        <p className={`mt-2 text-xs ${msg.kind === "ok" ? "text-primary" : "text-destructive"}`}>{msg.text}</p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Credits expire 90 days after redemption (or as set by the code).</p>
    </div>
  );
}
