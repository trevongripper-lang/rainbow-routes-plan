import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { Checkbox } from "@/components/ui/checkbox";
import {
  BedDouble,
  ExternalLink,
  Ticket,
  Wallet,
  Trash2,
  Plus,
  Users,
  ArrowRightLeft,
  Lock,
  MapPin,
  CalendarDays,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Pie, PieChart, Cell, BarChart, Bar, XAxis, YAxis } from "recharts";
import { differenceInCalendarDays, format, parseISO, isValid } from "date-fns";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { BulkConfirmDialog } from "@/components/bulk-confirm-dialog";
import { track } from "@/lib/analytics";

function fmtCents(cents: number, cur: string) {
  return `${(cents / 100).toFixed(2)} ${cur}`;
}
function parseDate(s: string | null | undefined) {
  if (!s) return null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
}

/* -------------------------- WHERE TO STAY -------------------------- */

export function StaysTab({
  destinationId,
  me,
  title,
  country,
  startDate,
  endDate,
}: {
  destinationId: string;
  me: string;
  title: string;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
}) {
  const qc = useQueryClient();
  const { data: stays = [] } = useQuery({
    queryKey: ["stays", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_stays")
        .select("*")
        .eq("destination_id", destinationId)
        .order("check_in", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: members = [] } = useQuery({
    queryKey: ["trip-members", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_members")
        .select("user_id, role")
        .eq("destination_id", destinationId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const memberIds = useMemo(
    () => Array.from(new Set([me, ...members.map((m) => m.user_id)])),
    [members, me],
  );
  const { data: profiles = [] } = useQuery({
    queryKey: ["stay-profiles", destinationId, memberIds.join(",")],
    queryFn: async () => {
      if (memberIds.length === 0) return [];
      const { data, error } = await supabase.rpc("get_public_profiles", { _ids: memberIds });
      if (error) throw error;
      return data ?? [];
    },
  });
  const nameOf = (id: string | null | undefined) => {
    if (!id) return "—";
    const p = profiles.find((x) => x.id === id);
    return p?.display_name ?? (id === me ? "You" : "Someone");
  };

  const blankForm = () => ({
    title: "",
    url: "",
    description: "",
    address: "",
    check_in: startDate ?? "",
    check_out: endDate ?? "",
    nightly_rate: "",
    currency: "USD",
    confirmation: "",
    booked_by: me,
  });
  const [form, setForm] = useState(blankForm());
  const [showDetails, setShowDetails] = useState(false);
  const [addToCosts, setAddToCosts] = useState(false);

  const add = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Name required");
      const rate = form.nightly_rate ? Math.round(parseFloat(form.nightly_rate) * 100) : null;
      const { data: inserted, error } = await supabase
        .from("trip_stays")
        .insert({
          destination_id: destinationId,
          user_id: me,
          title: form.title.trim(),
          url: form.url.trim() || null,
          description: form.description.trim() || null,
          address: form.address.trim() || null,
          check_in: form.check_in || null,
          check_out: form.check_out || null,
          nightly_rate_cents: rate,
          currency: form.currency || "USD",
          confirmation: form.confirmation.trim() || null,
          booked_by: form.booked_by || me,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (addToCosts && inserted?.id) {
        const { buildStayAutoCost, insertAutoCost } = await import("@/lib/auto-cost");
        const row = buildStayAutoCost({
          destinationId,
          me,
          stayId: inserted.id,
          title: form.title.trim(),
          nightlyRateCents: rate,
          currency: form.currency || "USD",
          checkIn: form.check_in || null,
          checkOut: form.check_out || null,
          bookedBy: form.booked_by || me,
        });
        if (row) {
          const r = await insertAutoCost(supabase, row);
          if (!r.ok) {
            toast.message("Saved, but we couldn't add it to Costs. You can add it manually.");
          } else {
            qc.invalidateQueries({ queryKey: ["costs", destinationId] });
          }
        }
      }
    },
    onSuccess: () => {
      setForm(blankForm());
      setShowDetails(false);
      setAddToCosts(false);
      qc.invalidateQueries({ queryKey: ["stays", destinationId] });
      toast.success("Stay added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trip_stays").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stays", destinationId] }),
  });

  const addStayCost = useMutation({
    mutationFn: async (s: (typeof stays)[number]) => {
      if (!s.nightly_rate_cents || !s.check_in || !s.check_out)
        throw new Error("Need rate and dates");
      const nights = Math.max(
        1,
        differenceInCalendarDays(parseISO(s.check_out), parseISO(s.check_in)),
      );
      const total = s.nightly_rate_cents * nights;
      const { error } = await supabase.from("trip_costs").insert({
        destination_id: destinationId,
        user_id: me,
        category: "Lodging",
        label: `${s.title} · ${nights} ${nights === 1 ? "night" : "nights"}`,
        amount_cents: total,
        currency: s.currency ?? "USD",
        is_shared: true,
        paid_by: s.booked_by ?? me,
        cost_date: s.check_in,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["costs", destinationId] });
      toast.success("Added to costs");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
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
          <BedDouble className="size-5 text-primary" />
          <h2 className="font-display text-2xl">Quick search</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Pre-filled searches on third-party sites.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {quick.map((l) => (
            <a
              key={l.name}
              href={l.url}
              target="_blank"
              rel="noreferrer noopener"
              className="group flex items-center justify-between rounded-2xl border border-border/60 bg-card p-4 transition hover:border-primary/50"
            >
              <div>
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground">{l.tag}</div>
              </div>
              <ExternalLink className="size-4 text-muted-foreground transition group-hover:text-primary" />
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <h3 className="font-display text-lg">Add a stay</h3>
        <p className="text-xs text-muted-foreground">
          Where, when, and how much — so it lands on the itinerary and split sheet.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Casa Cupula"
              maxLength={120}
            />
          </div>
          <div className="sm:col-span-1">
            <Label className="text-xs">Link</Label>
            <Input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://..."
              maxLength={500}
            />
          </div>
          <div>
            <Label className="text-xs">Check-in</Label>
            <Input
              type="date"
              value={form.check_in}
              onChange={(e) => setForm({ ...form, check_in: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Check-out</Label>
            <Input
              type="date"
              value={form.check_out}
              onChange={(e) => setForm({ ...form, check_out: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Address</Label>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Zona Romántica, Puerto Vallarta"
              maxLength={300}
            />
          </div>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div>
              <Label className="text-xs">Nightly rate</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.nightly_rate}
                onChange={(e) => setForm({ ...form, nightly_rate: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label className="text-xs">Cur.</Label>
              <Input
                value={form.currency}
                onChange={(e) =>
                  setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })
                }
                maxLength={3}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Booked by</Label>
            <select
              value={form.booked_by}
              onChange={(e) => setForm({ ...form, booked_by: e.target.value })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {memberIds.map((id) => (
                <option key={id} value={id}>
                  {id === me ? "Me" : nameOf(id)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Why it's the place</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              maxLength={500}
              placeholder="Rooftop pool, walk to everything..."
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showDetails ? "− Hide booking details" : "+ Add booking details"}
            </button>
            {showDetails && (
              <div className="mt-2">
                <Label className="text-xs">Confirmation #</Label>
                <Input
                  value={form.confirmation}
                  onChange={(e) => setForm({ ...form, confirmation: e.target.value })}
                  maxLength={120}
                />
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => add.mutate()} disabled={add.isPending || !form.title.trim()}>
            <Plus className="mr-1 size-4" />
            Add stay
          </Button>
        </div>
      </section>

      <ul className="space-y-3">
        {stays.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No group picks yet.
          </li>
        )}
        {stays.map((s) => {
          const ci = parseDate(s.check_in);
          const co = parseDate(s.check_out);
          const nights = ci && co ? Math.max(0, differenceInCalendarDays(co, ci)) : 0;
          const total = s.nightly_rate_cents && nights > 0 ? s.nightly_rate_cents * nights : null;
          return (
            <li key={s.id} className="rounded-xl border border-border/60 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate font-medium">{s.title}</h4>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    {s.booked_by && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                        Booked by {s.booked_by === me ? "you" : nameOf(s.booked_by)}
                      </span>
                    )}
                  </div>
                  {(ci || co) && (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="size-3" />
                      <span>
                        {ci ? format(ci, "MMM d") : "?"} → {co ? format(co, "MMM d") : "?"}
                        {nights > 0 ? ` · ${nights} ${nights === 1 ? "night" : "nights"}` : ""}
                      </span>
                    </div>
                  )}
                  {s.address && (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3" />
                      <span className="truncate">{s.address}</span>
                    </div>
                  )}
                  {s.description && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                  {(s.nightly_rate_cents != null || total != null) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {s.nightly_rate_cents != null && (
                        <span className="rounded-full bg-background/60 px-2 py-0.5 text-muted-foreground">
                          {fmtCents(s.nightly_rate_cents, s.currency ?? "USD")}/night
                        </span>
                      )}
                      {total != null && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">
                          Total {fmtCents(total, s.currency ?? "USD")}
                        </span>
                      )}
                      {total != null && (
                        <button
                          type="button"
                          onClick={() => addStayCost.mutate(s)}
                          disabled={addStayCost.isPending}
                          className="rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground hover:border-primary/50 hover:text-primary"
                        >
                          + Add to costs
                        </button>
                      )}
                    </div>
                  )}
                  {s.confirmation && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Conf #{s.confirmation}
                    </div>
                  )}
                </div>
                {s.user_id === me && (
                  <button
                    onClick={() => del.mutate(s.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
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
      const { data, error } = await supabase
        .from("trip_tickets")
        .select("*")
        .eq("destination_id", destinationId)
        .order("created_at", { ascending: false });
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
        destination_id: destinationId,
        user_id: me,
        name: form.name.trim(),
        url: form.url.trim() || null,
        price_cents: cents,
        currency: form.currency,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ name: "", url: "", price: "", currency: "USD", notes: "" });
      qc.invalidateQueries({ queryKey: ["tickets", destinationId] });
      toast.success("Added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trip_tickets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets", destinationId] }),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2">
          <Ticket className="size-5 text-primary" />
          <h3 className="font-display text-lg">Add a ticket / event link</h3>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Event name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="XLSIOR opening party"
              maxLength={150}
            />
          </div>
          <div>
            <Label className="text-xs">Link</Label>
            <Input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://..."
              maxLength={500}
            />
          </div>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div>
              <Label className="text-xs">Price</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label className="text-xs">Cur.</Label>
              <Input
                value={form.currency}
                onChange={(e) =>
                  setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })
                }
                maxLength={3}
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              maxLength={300}
              placeholder="Sold out fast last year"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => add.mutate()} disabled={add.isPending || !form.name.trim()}>
            <Plus className="mr-1 size-4" />
            Add ticket
          </Button>
        </div>
      </section>

      <ul className="space-y-3">
        {tickets.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No tickets shared yet.
          </li>
        )}
        {tickets.map((t) => (
          <li key={t.id} className="rounded-xl border border-border/60 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="truncate font-medium">{t.name}</h4>
                  {t.url && (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                  {t.price_cents != null && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                      {(t.price_cents / 100).toFixed(2)} {t.currency}
                    </span>
                  )}
                </div>
                {t.notes && <p className="mt-1 text-sm text-muted-foreground">{t.notes}</p>}
              </div>
              {t.user_id === me && (
                <button
                  onClick={() => del.mutate(t.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------- COSTS -------------------------- */

const CATEGORIES = [
  "Flights",
  "Lodging",
  "Food & drink",
  "Tickets & events",
  "Transport",
  "Other",
] as const;

const FREE_HEADCOUNT_MAX = 5;
const PRO_HEADCOUNT_MAX = 100;

export function CostsTab({
  destinationId,
  me,
  headcount: initialHeadcount,
  isOwner,
  defaultCurrency = "USD",
}: {
  destinationId: string;
  me: string;
  headcount: number;
  isOwner: boolean;
  defaultCurrency?: string;
}) {
  const qc = useQueryClient();

  // Fetch trip members — this is the canonical headcount source
  const { data: members = [] } = useQuery({
    queryKey: ["trip-members", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_members")
        .select("user_id, role")
        .eq("destination_id", destinationId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const memberCount = members.length || 1;

  const [headcount, setHeadcount] = useState(Math.max(initialHeadcount, memberCount));
  const [autoFromMembers, setAutoFromMembers] = useState(true);
  useEffect(() => {
    if (autoFromMembers) setHeadcount(memberCount);
  }, [memberCount, autoFromMembers]);

  // Fetch owner's pro status (cap depends on the owner)
  const { data: ownerProfile } = useQuery({
    queryKey: ["owner-profile", destinationId],
    queryFn: async () => {
      const { data: d } = await supabase
        .from("destinations")
        .select("user_id")
        .eq("id", destinationId)
        .maybeSingle();
      if (!d) return null;
      const { data: p } = await supabase.rpc("get_public_profiles", { _ids: [d.user_id] });
      const row = (p ?? [])[0] as { is_pro: boolean } | undefined;
      return row ? { is_pro: row.is_pro } : null;
    },
  });
  const isPro = !!ownerProfile?.is_pro;
  const headcountMax = isPro ? PRO_HEADCOUNT_MAX : FREE_HEADCOUNT_MAX;

  const { data: costs = [] } = useQuery({
    queryKey: ["costs", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_costs")
        .select("*")
        .eq("destination_id", destinationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Members for display = trip_members ∪ payers ∪ loggers
  const memberIds = useMemo(() => {
    const s = new Set<string>([me, ...members.map((m) => m.user_id)]);
    for (const c of costs) {
      if (c.paid_by) s.add(c.paid_by);
      if (c.user_id) s.add(c.user_id);
    }
    return Array.from(s);
  }, [costs, me, members]);

  const { data: profiles = [] } = useQuery({
    queryKey: ["cost-profiles", destinationId, memberIds.join(",")],
    queryFn: async () => {
      if (memberIds.length === 0) return [];
      const { data, error } = await supabase.rpc("get_public_profiles", { _ids: memberIds });
      if (error) throw error;
      return data ?? [];
    },
  });
  const pmap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const nameOf = (id: string | null | undefined) =>
    id ? (pmap.get(id)?.display_name ?? "Someone") : "Someone";

  const saveHeadcount = useMutation({
    mutationFn: async (n: number) => {
      if (n < 1 || n > headcountMax) {
        if (!isPro && n > FREE_HEADCOUNT_MAX) {
          throw new Error(
            `Free plan supports up to ${FREE_HEADCOUNT_MAX} people. Upgrade to Pro for larger crews.`,
          );
        }
        throw new Error(`Group size must be between 1 and ${headcountMax}.`);
      }
      const { error } = await supabase
        .from("destinations")
        .update({ headcount: n })
        .eq("id", destinationId);
      if (error) {
        const msg = error.message?.toLowerCase() ?? "";
        if (
          error.code === "23514" ||
          msg.includes("destinations_headcount_free_plan_max") ||
          msg.includes("check constraint")
        ) {
          throw new Error(
            `Free plan supports up to ${FREE_HEADCOUNT_MAX} people per trip. Upgrade for larger crews.`,
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trip", destinationId] });
      toast.success("Group size updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update group size"),
  });

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    category: CATEGORIES[0] as string,
    label: "",
    amount: "",
    currency: defaultCurrency,
    is_shared: true,
    note: "",
    paid_by: me,
    cost_date: today,
    split_mode: "equal_all" as "equal_all" | "equal_some" | "per_person",
    split_member_ids: [] as string[],
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!form.label.trim() || !form.amount) throw new Error("Label & amount required");
      const cents = Math.round(parseFloat(form.amount) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error("Invalid amount");
      const is_shared = form.split_mode !== "per_person";
      const split_ids = form.split_mode === "equal_some" ? form.split_member_ids : null;
      if (form.split_mode === "equal_some" && (!split_ids || split_ids.length === 0)) {
        throw new Error("Pick at least one person to split with");
      }
      const { error } = await supabase.from("trip_costs").insert({
        destination_id: destinationId,
        user_id: me,
        category: form.category,
        label: form.label.trim(),
        amount_cents: cents,
        currency: form.currency,
        is_shared,
        note: form.note.trim() || null,
        paid_by: form.paid_by || me,
        cost_date: form.cost_date || null,
        split_mode: form.split_mode,
        split_member_ids: split_ids,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ ...form, label: "", amount: "", note: "" });
      qc.invalidateQueries({ queryKey: ["costs", destinationId] });
      toast.success("Added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trip_costs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["costs", destinationId] }),
  });

  // ----- Bulk selection (costs) -----
  const bulk = useBulkSelection<string>();
  const orderedIds = useMemo(() => costs.map((c) => c.id), [costs]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSettle, setConfirmSettle] = useState(false);

  const deletePlan = useMemo(() => {
    const willApply: { id: string; label: string }[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];
    for (const id of bulk.ids) {
      const c = costs.find((x) => x.id === id);
      if (!c) continue;
      if (c.user_id === me || isOwner) {
        willApply.push({ id, label: `${c.label} · ${fmtCents(c.amount_cents, c.currency)}` });
      } else {
        skipped.push({ id, label: c.label, reason: "Not yours" });
      }
    }
    return { willApply, skipped };
  }, [bulk.ids, costs, me, isOwner]);

  const settlePlan = useMemo(() => {
    const willApply: {
      id: string;
      label: string;
      from: string;
      to: string;
      cents: number;
      currency: string;
    }[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];
    for (const id of bulk.ids) {
      const c = costs.find((x) => x.id === id);
      if (!c) continue;
      if (!c.is_shared) {
        skipped.push({ id, label: c.label, reason: "Per-person cost (nothing to settle)" });
        continue;
      }
      const payer = (c.paid_by ?? c.user_id) as string;
      if (payer === me) {
        skipped.push({ id, label: c.label, reason: "You paid this one" });
        continue;
      }
      const splitIds: string[] =
        Array.isArray((c as { split_member_ids?: string[] }).split_member_ids) &&
        (c as { split_member_ids?: string[] }).split_member_ids!.length > 0
          ? (c as { split_member_ids: string[] }).split_member_ids
          : memberIds;
      if (!splitIds.includes(me)) {
        skipped.push({ id, label: c.label, reason: "You're not in the split" });
        continue;
      }
      const share = Math.round(c.amount_cents / Math.max(1, splitIds.length));
      willApply.push({
        id,
        label: `${c.label} → pay ${nameOf(payer)} ${fmtCents(share, c.currency)}`,
        from: me,
        to: payer,
        cents: share,
        currency: c.currency,
      });
    }
    return { willApply, skipped };
  }, [bulk.ids, costs, me, memberIds, nameOf]);

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const ids = deletePlan.willApply.map((w) => w.id);
      if (ids.length === 0) return 0;
      const { error } = await supabase.from("trip_costs").delete().in("id", ids);
      if (error) throw error;
      track("bulk_delete", { surface: "costs", count: ids.length }, destinationId);
      return ids.length;
    },
    onSuccess: (n) => {
      setConfirmDelete(false);
      bulk.clear();
      qc.invalidateQueries({ queryKey: ["costs", destinationId] });
      qc.invalidateQueries({ queryKey: ["settlements", destinationId] });
      toast.success(`Deleted ${n} cost${n === 1 ? "" : "s"}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });

  const bulkSettle = useMutation({
    mutationFn: async () => {
      const rows = settlePlan.willApply.map((w) => ({
        destination_id: destinationId,
        from_user: w.from,
        to_user: w.to,
        amount_cents: w.cents,
        currency: w.currency,
        note: null,
        created_by: me,
      }));
      if (rows.length === 0) return 0;
      const { error } = await supabase.from("trip_settlements").insert(rows);
      if (error) throw error;
      track("bulk_settle", { count: rows.length }, destinationId);
      return rows.length;
    },
    onSuccess: (n) => {
      setConfirmSettle(false);
      bulk.clear();
      qc.invalidateQueries({ queryKey: ["settlements", destinationId] });
      toast.success(`Recorded ${n} settlement${n === 1 ? "" : "s"}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to settle"),
  });

  // ---- Settlements: persisted "marked as paid" records ----
  const { data: settlements = [] } = useQuery({
    queryKey: ["settlements", destinationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_settlements")
        .select("*")
        .eq("destination_id", destinationId)
        .order("settled_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const markSettled = useMutation({
    mutationFn: async (args: {
      from: string;
      to: string;
      cents: number;
      currency: string;
      note?: string;
    }) => {
      if (args.cents <= 0) throw new Error("Nothing to settle");
      if (me !== args.from && me !== args.to)
        throw new Error("Only the payer or receiver can mark this settled");
      const { error } = await supabase.from("trip_settlements").insert({
        destination_id: destinationId,
        from_user: args.from,
        to_user: args.to,
        amount_cents: args.cents,
        currency: args.currency,
        note: args.note ?? null,
        created_by: me,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settlements", destinationId] });
      toast.success("Marked settled");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const undoSettlement = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trip_settlements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settlements", destinationId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const summary = useMemo(() => {
    const n = Math.max(1, headcount);
    const byCat = new Map<string, { shared: number; perPerson: number; currency: string }>();
    let totalPerPerson = 0;
    const currency = costs[0]?.currency ?? defaultCurrency;
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
      return {
        category: cat,
        sharedCents: v.shared,
        perPersonCents: v.perPerson,
        perPersonShareCents: pp,
        currency: v.currency,
      };
    });
    return { rows, totalPerPerson, currency };
  }, [costs, headcount, defaultCurrency]);

  // ---- Settle-up: who paid vs who owes ----
  const settle = useMemo(() => {
    const n = Math.max(1, headcount);
    const currency =
      costs.find((c) => c.is_shared)?.currency ?? costs[0]?.currency ?? defaultCurrency;
    // Sum what each member paid AND each member's owed share
    const paid = new Map<string, number>();
    const owed = new Map<string, number>();
    let totalShared = 0;
    for (const c of costs) {
      if (!c.is_shared) continue;
      const payer = c.paid_by ?? c.user_id;
      paid.set(payer, (paid.get(payer) ?? 0) + c.amount_cents);
      totalShared += c.amount_cents;
      // Determine who shares this cost
      const splitIds: string[] =
        Array.isArray((c as { split_member_ids?: string[] }).split_member_ids) &&
        (c as { split_member_ids?: string[] }).split_member_ids!.length > 0
          ? (c as { split_member_ids: string[] }).split_member_ids
          : memberIds;
      const share = c.amount_cents / Math.max(1, splitIds.length);
      for (const uid of splitIds) {
        owed.set(uid, (owed.get(uid) ?? 0) + share);
      }
    }
    const fairShare = totalShared / n;
    const known = Array.from(new Set([...memberIds, ...paid.keys(), ...owed.keys()]));
    // Net = paid - owed (positive = is owed; negative = owes)
    const net = known.map((id) => ({ id, net: (paid.get(id) ?? 0) - (owed.get(id) ?? 0) }));
    const creditors = net
      .filter((x) => x.net > 1)
      .sort((a, b) => b.net - a.net)
      .map((x) => ({ ...x }));
    const debtors = net
      .filter((x) => x.net < -1)
      .sort((a, b) => a.net - b.net)
      .map((x) => ({ ...x }));
    const transfers: { from: string; to: string; cents: number }[] = [];
    let i = 0,
      j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(-debtors[i].net, creditors[j].net);
      if (amt > 1)
        transfers.push({ from: debtors[i].id, to: creditors[j].id, cents: Math.round(amt) });
      debtors[i].net += amt;
      creditors[j].net -= amt;
      if (Math.abs(debtors[i].net) < 1) i++;
      if (Math.abs(creditors[j].net) < 1) j++;
    }
    return { fairShare, totalShared, transfers, currency, knownPayers: paid.size };
  }, [costs, headcount, memberIds, defaultCurrency]);

  const fmt = (cents: number, cur: string) => `${(cents / 100).toFixed(2)} ${cur}`;

  const atFreeCap = !isPro && headcount >= FREE_HEADCOUNT_MAX;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Wallet className="size-5 text-primary" />
              <h3 className="font-display text-lg">Per-person estimate</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Shared costs split by group size; per-person costs counted once.
            </p>
          </div>
          <div className="text-right">
            <div className="font-display text-3xl text-primary">
              {summary.totalPerPerson ? fmt(summary.totalPerPerson, summary.currency) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              per person · {headcount} {headcount === 1 ? "person" : "people"}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Users className="size-4 text-muted-foreground" />
          <Label className="text-xs">Group size</Label>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
            {memberCount} {memberCount === 1 ? "member" : "members"} in crew
          </span>
          {autoFromMembers ? (
            <button
              type="button"
              onClick={() => setAutoFromMembers(false)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Override
            </button>
          ) : (
            <>
              <Input
                type="number"
                min={1}
                max={headcountMax}
                value={headcount}
                onChange={(e) => {
                  const v = Math.max(1, parseInt(e.target.value || "1", 10));
                  setHeadcount(Math.min(v, headcountMax));
                }}
                className="w-20"
              />
              <button
                type="button"
                onClick={() => {
                  setAutoFromMembers(true);
                  setHeadcount(memberCount);
                }}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Use crew count
              </button>
            </>
          )}
          {isOwner && headcount !== initialHeadcount && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => saveHeadcount.mutate(headcount)}
              disabled={saveHeadcount.isPending}
            >
              Save
            </Button>
          )}
          {isPro ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-primary">
              ✦ Pro · unlimited crew
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 text-[11px] ${atFreeCap ? "text-amber-400" : "text-muted-foreground"}`}
            >
              <Lock className="size-3" /> Free plan · up to {FREE_HEADCOUNT_MAX} people ·{" "}
              <a href="/pricing" className="text-primary hover:underline">
                Upgrade
              </a>
            </span>
          )}
        </div>
        {summary.rows.length > 0 && (
          <ul className="mt-4 divide-y divide-border/60 rounded-xl border border-border/60">
            {summary.rows.map((r) => (
              <li key={r.category} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-muted-foreground">{r.category}</span>
                <span className="font-medium tabular-nums">
                  {fmt(r.perPersonShareCents, r.currency)}
                  <span className="text-xs text-muted-foreground"> /person</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {summary.rows.length > 0 && <CostCharts rows={summary.rows} currency={summary.currency} />}

      {/* Settle up */}
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="size-5 text-primary" />
          <h3 className="font-display text-lg">Settle up</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Who owes whom, based on shared costs and who paid.
        </p>
        {settle.totalShared === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Log a shared cost and tag who paid to see settlements.
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="text-xs text-muted-foreground">Fair share / person</div>
                <div className="font-display text-xl tabular-nums">
                  {fmt(settle.fairShare, settle.currency)}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="text-xs text-muted-foreground">Total shared</div>
                <div className="font-display text-xl tabular-nums">
                  {fmt(settle.totalShared, settle.currency)}
                </div>
              </div>
            </div>
            {(() => {
              // Subtract already-settled amounts from each suggested transfer (per from→to + currency).
              const settledByPair = new Map<string, number>();
              for (const s of settlements) {
                if (s.currency !== settle.currency) continue;
                const k = `${s.from_user}→${s.to_user}`;
                settledByPair.set(k, (settledByPair.get(k) ?? 0) + s.amount_cents);
              }
              const remaining = settle.transfers.map((t) => {
                const k = `${t.from}→${t.to}`;
                const already = settledByPair.get(k) ?? 0;
                return { ...t, remaining: Math.max(0, t.cents - already), already };
              });
              const allDone = remaining.every((r) => r.remaining <= 0);
              if (allDone) {
                return (
                  <p className="mt-4 text-sm text-emerald-400">
                    All squared up among known payers ✨
                  </p>
                );
              }
              return (
                <ul className="mt-4 space-y-2">
                  {remaining.map((t, idx) => {
                    if (t.remaining <= 0) {
                      return (
                        <li
                          key={idx}
                          className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-sm"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Check className="size-4 text-emerald-400" />
                            <span>
                              <span className="font-medium">{nameOf(t.from)}</span>{" "}
                              <span className="text-muted-foreground">paid</span>{" "}
                              <span className="font-medium">{nameOf(t.to)}</span>
                            </span>
                          </span>
                          <span className="text-xs text-emerald-400">Settled</span>
                        </li>
                      );
                    }
                    const canMark = me === t.from || me === t.to;
                    return (
                      <li
                        key={idx}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/40 px-4 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{nameOf(t.from)}</span>{" "}
                          <span className="text-muted-foreground">pays</span>{" "}
                          <span className="font-medium">{nameOf(t.to)}</span>
                          {t.already > 0 && (
                            <span className="ml-2 text-[11px] text-muted-foreground">
                              ({fmt(t.already, settle.currency)} already paid)
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="font-medium tabular-nums">
                            {fmt(t.remaining, settle.currency)}
                          </span>
                          {canMark && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={markSettled.isPending}
                              onClick={() =>
                                markSettled.mutate({
                                  from: t.from,
                                  to: t.to,
                                  cents: t.remaining,
                                  currency: settle.currency,
                                })
                              }
                            >
                              <Check className="mr-1 size-3.5" />
                              Mark settled
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
            {settlements.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Settlement history
                </h4>
                <ul className="mt-2 space-y-1.5">
                  {settlements.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-1.5 text-xs"
                    >
                      <span>
                        <span className="font-medium">{nameOf(s.from_user)}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium">{nameOf(s.to_user)}</span>
                        <span className="ml-2 tabular-nums">{fmt(s.amount_cents, s.currency)}</span>
                        <span className="ml-2 text-muted-foreground">
                          · {format(parseISO(s.settled_at), "MMM d")}
                        </span>
                      </span>
                      {s.created_by === me && (
                        <button
                          type="button"
                          onClick={() => undoSettlement.mutate(s.id)}
                          className="text-muted-foreground hover:text-destructive"
                          title="Undo settlement"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg">Log a cost</h3>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { label: "Dinner", category: "Food & drink" },
                { label: "Drinks", category: "Food & drink" },
                { label: "Activity", category: "Tickets & events" },
                { label: "Taxi", category: "Transport" },
                { label: "Groceries", category: "Food & drink" },
              ] as const
            ).map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    category: q.category,
                    label: q.label,
                    is_shared: true,
                    paid_by: me,
                  })
                }
                className="rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
              >
                + {q.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Quick-add picks a category and marks it shared — split is auto-calculated from your crew
          of {memberCount}.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Category</Label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">What</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Airbnb 5 nights"
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div>
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label className="text-xs">Cur.</Label>
              <Input
                value={form.currency}
                onChange={(e) =>
                  setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })
                }
                maxLength={3}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Who paid</Label>
            <select
              value={form.paid_by}
              onChange={(e) => setForm({ ...form, paid_by: e.target.value })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {memberIds.map((id) => (
                <option key={id} value={id}>
                  {id === me ? "Me" : nameOf(id)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">When</Label>
            <Input
              type="date"
              value={form.cost_date}
              onChange={(e) => setForm({ ...form, cost_date: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Split</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(
                [
                  { v: "equal_all", label: `Equal · all ${memberIds.length}` },
                  { v: "equal_some", label: "Pick people" },
                  { v: "per_person", label: "Per-person (no split)" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() =>
                    setForm({ ...form, split_mode: opt.v, is_shared: opt.v !== "per_person" })
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${form.split_mode === opt.v ? "border-primary bg-primary/15 text-primary" : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/50"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {form.split_mode === "equal_some" && (
              <div className="mt-2 flex flex-wrap gap-2 rounded-md border border-border/60 bg-background/40 p-2">
                {memberIds.map((id) => {
                  const checked = form.split_member_ids.includes(id);
                  return (
                    <label
                      key={id}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-background/60 px-2 py-1 text-xs"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const set = new Set(form.split_member_ids);
                          if (v) set.add(id);
                          else set.delete(id);
                          setForm({ ...form, split_member_ids: Array.from(set) });
                        }}
                      />
                      <span>{id === me ? "Me" : nameOf(id)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Note</Label>
            <Input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              maxLength={300}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            <Plus className="mr-1 size-4" />
            Add cost
          </Button>
        </div>
      </section>

      <ul className="space-y-2">
        {costs.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No costs logged yet.
          </li>
        )}
        {costs.map((c) => {
          const checked = bulk.isSelected(c.id);
          return (
            <li
              key={c.id}
              className={`flex items-center justify-between rounded-xl border p-3 text-sm transition ${checked ? "border-primary/60 bg-primary/5" : "border-border/60 bg-card"}`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <Checkbox
                  checked={checked}
                  onClick={(e) => {
                    if ((e as unknown as MouseEvent).shiftKey) {
                      bulk.toggleRange(c.id, orderedIds);
                    } else {
                      bulk.toggle(c.id);
                    }
                  }}
                  onCheckedChange={() => {
                    /* handled by onClick for shift support */
                  }}
                  aria-label={`Select ${c.label}`}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {c.category}
                    </span>
                    <span className="font-medium">{c.label}</span>
                    <span
                      className={`text-[10px] ${c.is_shared ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {c.is_shared ? "shared" : "per-person"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      · paid by{" "}
                      {(c.paid_by ?? c.user_id) === me ? "you" : nameOf(c.paid_by ?? c.user_id)}
                    </span>
                  </div>
                  {c.note && <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium tabular-nums">{fmt(c.amount_cents, c.currency)}</span>
                {(c.user_id === me || isOwner) && (
                  <button
                    onClick={() => del.mutate(c.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <BulkActionBar
        count={bulk.count}
        noun="cost"
        onClear={bulk.clear}
        actions={[
          {
            label: "Mark settled",
            icon: Check,
            onClick: () => setConfirmSettle(true),
            disabled: settlePlan.willApply.length === 0,
          },
          {
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onClick: () => setConfirmDelete(true),
            disabled: deletePlan.willApply.length === 0,
          },
        ]}
      />

      <BulkConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete selected costs?"
        description="This permanently removes the costs."
        willApply={deletePlan.willApply}
        skipped={deletePlan.skipped}
        confirmLabel={bulkDelete.isPending ? "Deleting…" : "Delete"}
        destructive
        onConfirm={() => bulkDelete.mutate()}
      />
      <BulkConfirmDialog
        open={confirmSettle}
        onOpenChange={setConfirmSettle}
        title="Mark these as settled?"
        description="Records a settlement entry from you to each payer for your share."
        willApply={settlePlan.willApply.map((w) => ({ id: w.id, label: w.label }))}
        skipped={settlePlan.skipped}
        confirmLabel={bulkSettle.isPending ? "Saving…" : "Mark settled"}
        onConfirm={() => bulkSettle.mutate()}
      />
    </div>
  );
}

/* -------------------------- COST CHARTS -------------------------- */

type CostRow = {
  category: string;
  sharedCents: number;
  perPersonCents: number;
  perPersonShareCents: number;
  currency: string;
};

const CAT_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--secondary))",
  "hsl(var(--muted-foreground))",
  "hsl(var(--destructive))",
  "hsl(var(--ring))",
];

function CostCharts({ rows, currency }: { rows: CostRow[]; currency: string }) {
  const totalShared = rows.reduce((a, r) => a + r.sharedCents, 0);
  const totalPerPerson = rows.reduce((a, r) => a + r.perPersonCents, 0);
  const totalTrip = totalShared + totalPerPerson;

  const pieData = rows
    .map((r, i) => ({
      name: r.category,
      value: (r.sharedCents + r.perPersonCents) / 100,
      fill: CAT_COLORS[i % CAT_COLORS.length],
    }))
    .filter((d) => d.value > 0);

  const barData = rows.map((r) => ({
    category: r.category,
    perPerson: Math.round(r.perPersonShareCents) / 100,
  }));

  const chartConfig = Object.fromEntries(
    rows.map((r, i) => [
      r.category,
      { label: r.category, color: CAT_COLORS[i % CAT_COLORS.length] },
    ]),
  );

  const fmt = (cents: number) => `${(cents / 100).toFixed(2)} ${currency}`;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex items-center gap-2">
        <Wallet className="size-5 text-primary" />
        <h3 className="font-display text-lg">Breakdown</h3>
      </div>

      <div className="mt-4 grid gap-4 text-center sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="text-xs text-muted-foreground">Total trip</div>
          <div className="font-display text-xl">{fmt(totalTrip)}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="text-xs text-muted-foreground">Shared pool</div>
          <div className="font-display text-xl">{fmt(totalShared)}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="text-xs text-muted-foreground">Per-person items</div>
          <div className="font-display text-xl">{fmt(totalPerPerson)}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Share of total by category</p>
          <ChartContainer config={chartConfig} className="mt-2 h-56 w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={45}
                outerRadius={80}
                paddingAngle={2}
              >
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Per-person spend by category</p>
          <ChartContainer config={chartConfig} className="mt-2 h-56 w-full">
            <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="category" width={110} tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="perPerson" radius={4}>
                {barData.map((_, i) => (
                  <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </section>
  );
}
