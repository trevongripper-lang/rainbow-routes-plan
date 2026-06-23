import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Sparkles, Save, Link as LinkIcon, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  createEvent,
  extractEventFromUrl,
  listAdminEvents,
  type EventDraft,
} from "@/lib/events-admin.functions";

export const Route = createFileRoute("/_authenticated/console/events")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getSession();
    if (!userData.session) throw notFound();
    const { data } = await supabase.rpc("has_role", {
      _user_id: userData.session.user.id,
      _role: "admin",
    });
    if (!data) throw notFound();
  },
  component: EventsAdminPage,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Console — Events" }],
  }),
});

function EventsAdminPage() {
  const extractFn = useServerFn(extractEventFromUrl);
  const createFn = useServerFn(createEvent);
  const listFn = useServerFn(listAdminEvents);
  const qc = useQueryClient();

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);

  const list = useQuery({ queryKey: ["admin-events"], queryFn: () => listFn() });

  async function onExtract() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const d = await extractFn({ data: { url: url.trim() } });
      setDraft(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't extract");
    } finally {
      setBusy(false);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No draft");
      return createFn({
        data: {
          name: draft.name,
          description: draft.description,
          start_date: draft.start_date,
          end_date: draft.end_date || null,
          city: draft.city,
          region: draft.region,
          country: draft.country,
          url: draft.url || "",
          source_url: draft.source_url || draft.url || "",
          tags: draft.tags,
          latitude: draft.latitude,
          longitude: draft.longitude,
          verified: draft.verified,
          confidence_notes: draft.confidence_notes,
        },
      });
    },
    onSuccess: () => {
      toast.success("Event saved");
      setDraft(null);
      setUrl("");
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-2xl">Events — Smart Add</h1>
        <p className="text-sm text-muted-foreground">
          Paste a URL. Tribe extracts the name, dates, location, image, and description. Review and
          save.
        </p>
      </div>

      <section className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <LinkIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://worldprideamsterdam.com"
              className="pl-9"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onExtract();
                }
              }}
            />
          </div>
          <Button onClick={() => void onExtract()} disabled={busy || !url.trim()}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="mr-2 size-4" /> Extract
              </>
            )}
          </Button>
        </div>
      </section>

      {draft && (
        <section className="rounded-2xl border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Review</h2>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              <X className="size-4" />
            </Button>
          </div>

          {draft.image_url && (
            <img
              src={draft.image_url}
              alt=""
              className="aspect-video w-full rounded-lg object-cover"
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Start date">
              <Input
                type="date"
                value={draft.start_date}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
              />
            </Field>
            <Field label="End date">
              <Input
                type="date"
                value={draft.end_date ?? ""}
                onChange={(e) => setDraft({ ...draft, end_date: e.target.value || null })}
              />
            </Field>
            <Field label="City">
              <Input
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
            </Field>
            <Field label="Region">
              <Input
                value={draft.region}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
              />
            </Field>
            <Field label="Country" className="sm:col-span-2">
              <Input
                value={draft.country}
                onChange={(e) => setDraft({ ...draft, country: e.target.value })}
              />
            </Field>
            <Field label="Tags (comma-separated)" className="sm:col-span-2">
              <Input
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              />
            </Field>
            <Field label="URL (display link)" className="sm:col-span-2">
              <Input
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </Field>
            <Field label="Source URL (origin/citation)" className="sm:col-span-2">
              <Input
                value={draft.source_url}
                placeholder="Where this event was discovered (often the same)"
                onChange={(e) => setDraft({ ...draft, source_url: e.target.value })}
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
            <Field label="Confidence notes (admin-only)" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={draft.confidence_notes}
                placeholder="Notes about source reliability, ambiguous dates, etc."
                onChange={(e) => setDraft({ ...draft, confidence_notes: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.verified}
                onChange={(e) => setDraft({ ...draft, verified: e.target.checked })}
              />
              <span>
                <strong>Verified</strong> — date, location, and source confirmed by an admin
              </span>
            </label>
            <div
              className={`text-xs sm:col-span-2 ${
                draft.latitude != null && draft.longitude != null
                  ? "text-muted-foreground"
                  : "text-destructive"
              }`}
            >
              Coordinates:{" "}
              {draft.latitude != null && draft.longitude != null
                ? `${draft.latitude.toFixed(4)}, ${draft.longitude.toFixed(4)}`
                : "NOT resolved — event will not appear in nearby-trip matches by distance. Add lat/lng manually before publishing."}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending || !draft.name || !draft.start_date || !draft.city || !draft.country
              }
            >
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Save className="mr-2 size-4" /> Save event
                </>
              )}
            </Button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="mb-3 font-medium">Recent events</h2>
        {list.isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ul className="divide-y">
            {(list.data ?? []).map((e) => {
              const hasCoords = e.latitude != null && e.longitude != null;
              return (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span className="truncate">{e.name}</span>
                      {e.verified ? (
                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                          Verified
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                          Unverified
                        </span>
                      )}
                      {!hasCoords && (
                        <span
                          title="Missing coordinates"
                          className="rounded-full bg-destructive/20 px-1.5 py-0.5 text-[10px] text-destructive"
                        >
                          No lat/lng
                        </span>
                      )}
                      {e.reports_count > 0 && (
                        <span className="rounded-full bg-destructive/20 px-1.5 py-0.5 text-[10px] text-destructive">
                          {e.reports_count} report{e.reports_count === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {e.city}, {e.country} · {e.start_date}
                      {e.end_date ? ` → ${e.end_date}` : ""}
                    </div>
                    {e.confidence_notes && (
                      <div className="mt-0.5 text-[11px] italic text-muted-foreground">
                        {e.confidence_notes}
                      </div>
                    )}
                  </div>
                  {(e.source_url || e.url) && (
                    <a
                      href={(e.source_url || e.url) as string}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs text-primary hover:underline"
                    >
                      source
                    </a>
                  )}
                </li>
              );
            })}
            {(list.data ?? []).length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">No events yet.</li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {children}
    </div>
  );
}
