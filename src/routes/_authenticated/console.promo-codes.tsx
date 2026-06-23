import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Plus, Power, PowerOff, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createPromoCode,
  listPromoCodes,
  setPromoCodeActive,
  updatePromoCode,
  type PromoCodeRow,
} from "@/lib/promo-admin.functions";

export const Route = createFileRoute("/_authenticated/console/promo-codes")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getSession();
    if (!userData.session) throw notFound();
    const { data } = await supabase.rpc("has_role", { _user_id: userData.session.user.id, _role: "admin" });
    if (!data) throw notFound();
  },
  component: PromoAdminPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Console" }] }),
});

type FormState = {
  id?: string;
  code: string;
  credits: number;
  validity_days: number;
  max_redemptions: string;
  code_expires_at: string;
  note: string;
};

const empty: FormState = {
  code: "",
  credits: 3,
  validity_days: 90,
  max_redemptions: "",
  code_expires_at: "",
  note: "",
};

function PromoAdminPage() {
  const listFn = useServerFn(listPromoCodes);
  const createFn = useServerFn(createPromoCode);
  const updateFn = useServerFn(updatePromoCode);
  const toggleFn = useServerFn(setPromoCodeActive);
  const qc = useQueryClient();

  const codes = useQuery({
    queryKey: ["promo-codes"],
    queryFn: () => listFn({ data: {} as never }),
  });

  const [form, setForm] = useState<FormState>(empty);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const payload = {
        code: f.code,
        credits: Number(f.credits),
        validity_days: Number(f.validity_days),
        max_redemptions: f.max_redemptions.trim() === "" ? null : Number(f.max_redemptions),
        code_expires_at: f.code_expires_at ? new Date(f.code_expires_at).toISOString() : null,
        note: f.note,
      };
      if (f.id) return updateFn({ data: { id: f.id, ...payload } });
      return createFn({ data: payload });
    },
    onSuccess: () => {
      setForm(empty);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["promo-codes"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promo-codes"] }),
  });

  const startEdit = (r: PromoCodeRow) =>
    setForm({
      id: r.id,
      code: r.code,
      credits: r.credits,
      validity_days: r.validity_days,
      max_redemptions: r.max_redemptions == null ? "" : String(r.max_redemptions),
      code_expires_at: r.code_expires_at ? r.code_expires_at.slice(0, 10) : "",
      note: r.note ?? "",
    });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <header>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Console</p>
        <h1 className="font-display text-3xl">Promo codes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Codes grant trip-unlock credits. Credits expire after the validity window from each redemption.
        </p>
      </header>

      <section className="rounded-2xl border border-border/60 bg-card/60 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">{form.id ? "Edit code" : "New code"}</h2>
          {form.id && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setForm(empty);
                setErr(null);
              }}
            >
              <X className="size-3.5" /> Cancel edit
            </button>
          )}
        </div>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            save.mutate(form);
          }}
        >
          <Field label="Code">
            <input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="FRIENDS3"
              className={input}
            />
          </Field>
          <Field label="Credits granted">
            <input
              required
              type="number"
              min={1}
              max={50}
              value={form.credits}
              onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })}
              className={input}
            />
          </Field>
          <Field label="Validity (days)">
            <input
              required
              type="number"
              min={1}
              max={365}
              value={form.validity_days}
              onChange={(e) => setForm({ ...form, validity_days: Number(e.target.value) })}
              className={input}
            />
          </Field>
          <Field label="Max redemptions (blank = unlimited)">
            <input
              type="number"
              min={1}
              value={form.max_redemptions}
              onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })}
              className={input}
            />
          </Field>
          <Field label="Code expires (optional)">
            <input
              type="date"
              value={form.code_expires_at}
              onChange={(e) => setForm({ ...form, code_expires_at: e.target.value })}
              className={input}
            />
          </Field>
          <Field label="Note (internal)">
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className={input}
            />
          </Field>
          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            {err ? <p className="text-sm text-destructive">{err}</p> : <span />}
            <button
              type="submit"
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : form.id ? <Save className="size-4" /> : <Plus className="size-4" />}
              {form.id ? "Save changes" : "Create code"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/60 p-6">
        <h2 className="font-display text-xl">All codes</h2>
        {codes.isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
        {codes.data && codes.data.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">No codes yet. Create one above.</p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Credits</th>
                <th className="py-2 pr-3">Validity</th>
                <th className="py-2 pr-3">Used</th>
                <th className="py-2 pr-3">Cap</th>
                <th className="py-2 pr-3">Expires</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {(codes.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="py-2 pr-3 font-mono">{r.code}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.credits}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.validity_days}d</td>
                  <td className="py-2 pr-3 tabular-nums">{r.redemptions_count}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.max_redemptions ?? "∞"}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {r.code_expires_at ? new Date(r.code_expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        r.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => startEdit(r)}
                      >
                        Edit
                      </button>
                      <button
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => toggle.mutate({ id: r.id, active: !r.active })}
                      >
                        {r.active ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                        {r.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const input =
  "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
