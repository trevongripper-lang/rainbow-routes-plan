import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  Loader2,
  Check,
  X,
  BedDouble,
  Ticket,
  Wallet,
  Plane,
  MessageSquare,
  Link as LinkIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { enrichUrl, classifySmartAdd, type EnrichedUrl } from "@/lib/smart-add.functions";

type Kind = "stay" | "ticket" | "cost" | "flight" | "note";

type Draft = {
  kind: Kind;
  title: string;
  description: string;
  amount: string;
  currency: string;
  enriched: EnrichedUrl | null;
  source_text: string;
};

const KIND_META: Record<
  Kind,
  { label: string; icon: typeof BedDouble; tab: string; color: string }
> = {
  stay: { label: "Where to stay", icon: BedDouble, tab: "stays", color: "text-sky-500" },
  ticket: { label: "Ticket / activity", icon: Ticket, tab: "tickets", color: "text-fuchsia-500" },
  cost: { label: "Cost", icon: Wallet, tab: "costs", color: "text-amber-500" },
  flight: { label: "Flight", icon: Plane, tab: "flights", color: "text-emerald-500" },
  note: {
    label: "Note to the tribe",
    icon: MessageSquare,
    tab: "overview",
    color: "text-violet-500",
  },
};

function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/);
  return m ? m[0] : null;
}

export function SmartAdd({ destinationId, me }: { destinationId: string; me: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const runEnrich = useServerFn(enrichUrl);
  const runClassify = useServerFn(classifySmartAdd);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function onAnalyze() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setDraft(null);
    try {
      const url = firstUrl(t);
      let enriched: EnrichedUrl | null = null;
      if (url) {
        try {
          enriched = await runEnrich({ data: { url } });
        } catch {
          // best-effort
        }
      }
      const c = await runClassify({
        data: { destinationId, text: t, enriched: enriched ?? undefined },
      });
      setDraft({
        kind: c.kind,
        title: c.title || enriched?.title || t.slice(0, 80),
        description: c.description || enriched?.description || "",
        amount:
          c.amount && c.amount > 0
            ? String(c.amount)
            : enriched?.price
              ? String(enriched.price)
              : "",
        currency: (c.currency || enriched?.currency || "USD").toUpperCase().slice(0, 3),
        enriched,
        source_text: t,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't analyze");
    } finally {
      setBusy(false);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const url = draft.enriched?.url ?? firstUrl(draft.source_text);
      const amountNum = parseFloat(draft.amount);
      const cents = !Number.isNaN(amountNum) && amountNum > 0 ? Math.round(amountNum * 100) : null;

      if (draft.kind === "stay") {
        const { error } = await supabase.from("trip_stays").insert({
          destination_id: destinationId,
          user_id: me,
          title: draft.title || "Stay",
          url,
          description: draft.description || null,
        });
        if (error) throw error;
        return "stays";
      }
      if (draft.kind === "ticket") {
        const { error } = await supabase.from("trip_tickets").insert({
          destination_id: destinationId,
          user_id: me,
          name: draft.title || "Ticket",
          url,
          price_cents: cents,
          currency: draft.currency || "USD",
          notes: draft.description || null,
        });
        if (error) throw error;
        return "tickets";
      }
      if (draft.kind === "cost") {
        const { error } = await supabase.from("trip_costs").insert({
          destination_id: destinationId,
          user_id: me,
          category: "general",
          label: draft.title || "Cost",
          amount_cents: cents ?? 0,
          currency: draft.currency || "USD",
          is_shared: true,
          paid_by: me,
          note: draft.description || null,
        });
        if (error) throw error;
        return "costs";
      }
      if (draft.kind === "flight") {
        const { error } = await supabase.from("trip_flights").insert({
          destination_id: destinationId,
          user_id: me,
          passenger_name: null,
          airline: draft.title || null,
          notes: draft.description || draft.source_text,
        });
        if (error) throw error;
        return "flights";
      }
      const { error } = await supabase.from("comments").insert({
        destination_id: destinationId,
        user_id: me,
        body: (draft.title ? draft.title + "\n" : "") + (draft.description || draft.source_text),
        mentions: [],
      });
      if (error) throw error;
      return "overview";
    },
    onSuccess: (tab) => {
      toast.success("Added to trip");
      setText("");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["stays", destinationId] });
      qc.invalidateQueries({ queryKey: ["tickets", destinationId] });
      qc.invalidateQueries({ queryKey: ["costs", destinationId] });
      qc.invalidateQueries({ queryKey: ["flights", destinationId] });
      qc.invalidateQueries({ queryKey: ["chatter", destinationId] });
      if (tab) nav({ to: "/trips/$id", params: { id: destinationId }, search: { tab } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const KindIcon = draft ? KIND_META[draft.kind].icon : Sparkles;

  return (
    <section
      className="relative overflow-hidden rounded-3xl border-0 p-5 md:p-6"
      style={{
        background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(250 60% 45%) 100%)",
      }}
    >
      <div className="absolute -right-12 -top-12 size-44 rounded-full bg-white/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
            <Sparkles className="size-4 text-white" />
          </div>
          <div>
            <h3 className="font-display text-lg text-white">Add anything to this trip</h3>
            <p className="text-[12px] text-white/70">
              Paste a link, a confirmation, or a thought — we'll figure out the tab.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="https://www.airbnb.com/rooms/123 — looks perfect for our crew. Or: 'splitting the rental car, $240 total'"
              rows={2}
              maxLength={2000}
              className="min-h-[44px] resize-none border-0 bg-white/15 text-white placeholder:text-white/50 backdrop-blur-sm focus-visible:ring-white/40"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void onAnalyze();
                }
              }}
            />
          </div>
          <Button
            onClick={() => void onAnalyze()}
            disabled={busy || !text.trim()}
            className="h-auto bg-white px-5 text-primary hover:bg-white/90"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Analyze"}
          </Button>
        </div>

        {draft && (
          <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4 text-white backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs ${KIND_META[draft.kind].color}`}
              >
                <KindIcon className="size-3.5" />
                {KIND_META[draft.kind].label}
              </span>
              {(["stay", "ticket", "cost", "flight", "note"] as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setDraft({ ...draft, kind: k })}
                  className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-wide transition ${draft.kind === k ? "bg-white text-primary" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
              <div className="space-y-2">
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Title"
                  className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                  maxLength={120}
                />
                <Textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  rows={2}
                  placeholder="Notes (optional)"
                  className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                  maxLength={500}
                />
                {draft.enriched?.url && (
                  <div className="flex items-center gap-1.5 text-[11px] text-white/60">
                    <LinkIcon className="size-3" />
                    <span className="truncate">{draft.enriched.url}</span>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {(draft.kind === "ticket" || draft.kind === "cost") && (
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      value={draft.amount}
                      onChange={(e) =>
                        setDraft({ ...draft, amount: e.target.value.replace(/[^0-9.]/g, "") })
                      }
                      placeholder="0.00"
                      className="col-span-2 border-white/20 bg-white/10 text-white placeholder:text-white/40"
                    />
                    <Input
                      value={draft.currency}
                      onChange={(e) =>
                        setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 3) })
                      }
                      placeholder="USD"
                      className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                    />
                  </div>
                )}
                {draft.enriched?.image && (
                  
                  <img
                    src={draft.enriched.image}
                    alt=""
                    className="aspect-video w-full rounded-lg border border-white/20 object-cover"
                  />
                )}
              </div>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(null)}
                className="text-white/80 hover:bg-white/10 hover:text-white"
              >
                <X className="mr-1 size-4" /> Discard
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="bg-white text-primary hover:bg-white/90"
              >
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <Check className="mr-1 size-4" /> Save to trip
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
