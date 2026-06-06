import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BedDouble, ExternalLink, Ticket, Wallet, Trash2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Pie, PieChart, Cell, BarChart, Bar, XAxis, YAxis } from "recharts";

/* -------------------------- WHERE TO STAY -------------------------- */

export function StaysTab({ destinationId, me, title, country }: { destinationId: string; me: string; title: string; country: string | null }) {
  const qc = useQueryClient();
  const { data: stays = [] } = useQuery({
    queryKey: ["stays", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("trip_stays").select("*").eq("destination_id", destinationId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [form, setForm] = useState({ title: "", url: "", description: "" });
  const add = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Title required");
      const { error } = await supabase.from("trip_stays").insert({
        destination_id: destinationId,
        user_id: me,
        title: form.title.trim(),
        url: form.url.trim() || null,
        description: form.description.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { setForm({ title: "", url: "", description: "" }); qc.invalidateQueries({ queryKey: ["stays", destinationId] }); toast.success("Added"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("trip_stays").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stays", destinationId] }),
  });

  const q = encodeURIComponent([title, country].filter(Boolean).join(", "));
  const quick = [
    { name: "misterb&b", url: `https://www.misterbandb.com/s?query=${q}`, tag: "Gay-friendly" },
    { name: "Airbnb", url: `https://www.airbnb.com/s/${q}/homes`, tag: "Homes & rooms" },
    { name: "Vrbo", url: `https://www.vrbo.com/search?q=${q}`, tag: "Rentals" },
  ];

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-2">
          <BedDouble className="size-5 text-primary" /><h2 className="font-display text-2xl">Quick search</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Pre-filled searches on third-party sites.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {quick.map((l) => (
            <a key={l.name} href={l.url} target="_blank" rel="noreferrer noopener" className="group flex items-center justify-between rounded-2xl border border-border/60 bg-card p-4 transition hover:border-primary/50">
              <div><div className="font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.tag}</div></div>
              <ExternalLink className="size-4 text-muted-foreground transition group-hover:text-primary" />
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <h3 className="font-display text-lg">Add a place</h3>
        <p className="text-xs text-muted-foreground">Drop the link + why it's <em>the</em> place to stay.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-1"><Label className="text-xs">Name</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Casa Cupula" maxLength={120} /></div>
          <div className="sm:col-span-1"><Label className="text-xs">Link</Label><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." maxLength={500} /></div>
          <div className="sm:col-span-2"><Label className="text-xs">Why it's the place</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} maxLength={500} placeholder="Rooftop pool, walk to Zona Romántica..." /></div>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={() => add.mutate()} disabled={add.isPending || !form.title.trim()}><Plus className="mr-1 size-4" />Add stay</Button></div>
      </section>

      <ul className="space-y-3">
        {stays.length === 0 && <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No group picks yet.</li>}
        {stays.map((s) => (
          <li key={s.id} className="rounded-xl border border-border/60 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="truncate font-medium">{s.title}</h4>
                  {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-primary"><ExternalLink className="size-4" /></a>}
                </div>
                {s.description && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{s.description}</p>}
              </div>
              {s.user_id === me && (
                <button onClick={() => del.mutate(s.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------- TICKETS -------------------------- */

export function TicketsTab({ destinationId, me }: { destinationId: string; me: string }) {
  const qc = useQueryClient();
  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("trip_tickets").select("*").eq("destination_id", destinationId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [form, setForm] = useState({ name: "", url: "", price: "", currency: "USD", notes: "" });
  const add = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name required");
      const cents = form.price ? Math.round(parseFloat(form.price) * 100) : null;
      const { error } = await supabase.from("trip_tickets").insert({
        destination_id: destinationId, user_id: me,
        name: form.name.trim(), url: form.url.trim() || null,
        price_cents: cents, currency: form.currency, notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { setForm({ name: "", url: "", price: "", currency: "USD", notes: "" }); qc.invalidateQueries({ queryKey: ["tickets", destinationId] }); toast.success("Added"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("trip_tickets").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets", destinationId] }),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2"><Ticket className="size-5 text-primary" /><h3 className="font-display text-lg">Add a ticket / event link</h3></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label className="text-xs">Event name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="XLSIOR opening party" maxLength={150} /></div>
          <div><Label className="text-xs">Link</Label><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." maxLength={500} /></div>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div><Label className="text-xs">Price</Label><Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" /></div>
            <div><Label className="text-xs">Cur.</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })} maxLength={3} /></div>
          </div>
          <div className="sm:col-span-2"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={300} placeholder="Sold out fast last year" /></div>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={() => add.mutate()} disabled={add.isPending || !form.name.trim()}><Plus className="mr-1 size-4" />Add ticket</Button></div>
      </section>

      <ul className="space-y-3">
        {tickets.length === 0 && <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No tickets shared yet.</li>}
        {tickets.map((t) => (
          <li key={t.id} className="rounded-xl border border-border/60 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="truncate font-medium">{t.name}</h4>
                  {t.url && <a href={t.url} target="_blank" rel="noreferrer noopener" className="text-primary"><ExternalLink className="size-4" /></a>}
                  {t.price_cents != null && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                      {(t.price_cents / 100).toFixed(2)} {t.currency}
                    </span>
                  )}
                </div>
                {t.notes && <p className="mt-1 text-sm text-muted-foreground">{t.notes}</p>}
              </div>
              {t.user_id === me && (
                <button onClick={() => del.mutate(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------- COSTS -------------------------- */

const CATEGORIES = ["Flights", "Lodging", "Food & drink", "Tickets & events", "Transport", "Other"] as const;

export function CostsTab({ destinationId, me, headcount: initialHeadcount, isOwner }: { destinationId: string; me: string; headcount: number; isOwner: boolean }) {
  const qc = useQueryClient();
  const [headcount, setHeadcount] = useState(initialHeadcount);
  useEffect(() => setHeadcount(initialHeadcount), [initialHeadcount]);

  const { data: costs = [] } = useQuery({
    queryKey: ["costs", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("trip_costs").select("*").eq("destination_id", destinationId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveHeadcount = useMutation({
    mutationFn: async (n: number) => { const { error } = await supabase.from("destinations").update({ headcount: n }).eq("id", destinationId); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trip", destinationId] }); toast.success("Group size updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [form, setForm] = useState({ category: CATEGORIES[0] as string, label: "", amount: "", currency: "USD", is_shared: true, note: "" });
  const add = useMutation({
    mutationFn: async () => {
      if (!form.label.trim() || !form.amount) throw new Error("Label & amount required");
      const cents = Math.round(parseFloat(form.amount) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error("Invalid amount");
      const { error } = await supabase.from("trip_costs").insert({
        destination_id: destinationId, user_id: me, category: form.category,
        label: form.label.trim(), amount_cents: cents, currency: form.currency,
        is_shared: form.is_shared, note: form.note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { setForm({ ...form, label: "", amount: "", note: "" }); qc.invalidateQueries({ queryKey: ["costs", destinationId] }); toast.success("Added"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("trip_costs").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["costs", destinationId] }),
  });

  const summary = useMemo(() => {
    const n = Math.max(1, headcount);
    const byCat = new Map<string, { shared: number; perPerson: number; currency: string }>();
    let totalPerPerson = 0;
    const currency = costs[0]?.currency ?? "USD";
    for (const c of costs) {
      const k = c.category;
      const entry = byCat.get(k) ?? { shared: 0, perPerson: 0, currency: c.currency };
      if (c.is_shared) entry.shared += c.amount_cents;
      else entry.perPerson += c.amount_cents;
      byCat.set(k, entry);
    }
    const rows = Array.from(byCat.entries()).map(([cat, v]) => {
      const pp = v.shared / n + v.perPerson;
      totalPerPerson += pp;
      return { category: cat, sharedCents: v.shared, perPersonCents: v.perPerson, perPersonShareCents: pp, currency: v.currency };
    });
    return { rows, totalPerPerson, currency };
  }, [costs, headcount]);

  const fmt = (cents: number, cur: string) => `${(cents / 100).toFixed(2)} ${cur}`;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><Wallet className="size-5 text-primary" /><h3 className="font-display text-lg">Per-person estimate</h3></div>
            <p className="text-xs text-muted-foreground">Shared costs split by group size; per-person costs counted once.</p>
          </div>
          <div className="text-right">
            <div className="font-display text-3xl text-primary">{summary.totalPerPerson ? fmt(summary.totalPerPerson, summary.currency) : "—"}</div>
            <div className="text-xs text-muted-foreground">per person · {headcount} {headcount === 1 ? "person" : "people"}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Users className="size-4 text-muted-foreground" />
          <Label className="text-xs">Group size</Label>
          <Input type="number" min={1} max={50} value={headcount} onChange={(e) => setHeadcount(Math.max(1, parseInt(e.target.value || "1", 10)))} className="w-20" disabled={!isOwner} />
          {isOwner && headcount !== initialHeadcount && (
            <Button size="sm" variant="secondary" onClick={() => saveHeadcount.mutate(headcount)} disabled={saveHeadcount.isPending}>Save</Button>
          )}
        </div>
        {summary.rows.length > 0 && (
          <ul className="mt-4 divide-y divide-border/60 rounded-xl border border-border/60">
            {summary.rows.map((r) => (
              <li key={r.category} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-muted-foreground">{r.category}</span>
                <span className="font-medium tabular-nums">{fmt(r.perPersonShareCents, r.currency)}<span className="text-xs text-muted-foreground"> /person</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <h3 className="font-display text-lg">Log a cost</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Category</Label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><Label className="text-xs">What</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Airbnb 5 nights" maxLength={120} /></div>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div><Label className="text-xs">Amount</Label><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></div>
            <div><Label className="text-xs">Cur.</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })} maxLength={3} /></div>
          </div>
          <div className="flex items-end gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
            <Switch id="shared" checked={form.is_shared} onCheckedChange={(v) => setForm({ ...form, is_shared: v })} />
            <Label htmlFor="shared" className="text-xs">
              {form.is_shared ? "Shared (split across group)" : "Per-person (counted once each)"}
            </Label>
          </div>
          <div className="sm:col-span-2"><Label className="text-xs">Note</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} /></div>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={() => add.mutate()} disabled={add.isPending}><Plus className="mr-1 size-4" />Add cost</Button></div>
      </section>

      <ul className="space-y-2">
        {costs.length === 0 && <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No costs logged yet.</li>}
        {costs.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-3 text-sm">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{c.category}</span>
                <span className="font-medium">{c.label}</span>
                <span className={`text-[10px] ${c.is_shared ? "text-primary" : "text-muted-foreground"}`}>
                  {c.is_shared ? "shared" : "per-person"}
                </span>
              </div>
              {c.note && <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p>}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-medium tabular-nums">{fmt(c.amount_cents, c.currency)}</span>
              {c.user_id === me && (
                <button onClick={() => del.mutate(c.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
