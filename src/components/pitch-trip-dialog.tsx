import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ImageOff, MapPin, Plus, Upload, X, Check, Sparkles, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { geocodeSearch, type GeocodeCandidate } from "@/lib/geocode.functions";

const VIBES = [
  { id: "beach", label: "Beach Escape", emoji: "🌴" },
  { id: "party", label: "Party", emoji: "🎉" },
  { id: "nightlife", label: "Nightlife", emoji: "🍸" },
  { id: "lgbtq", label: "LGBTQ+", emoji: "🏳️‍🌈" },
  { id: "foodie", label: "Foodie", emoji: "🍽️" },
  { id: "culture", label: "Culture", emoji: "🏛️" },
  { id: "luxury", label: "Luxury", emoji: "💎" },
  { id: "relax", label: "Relaxation", emoji: "🧘" },
  { id: "adventure", label: "Adventure", emoji: "🥾" },
  { id: "romance", label: "Romance", emoji: "❤️" },
];

const AUDIENCES = [
  "Party Lovers", "Beach Lovers", "Foodies", "LGBTQ+ Travelers",
  "Luxury Travelers", "Adventure Seekers", "Couples", "Friend Groups", "Solo Travelers",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LENGTHS = ["Weekend", "4–5 Days", "1 Week", "10+ Days"];
const BUDGETS = ["$", "$$", "$$$", "$$$$"];

type FormState = {
  title: string;
  country: string;
  city: string;
  image_url: string;
  vibes: string[];
  description: string;
  special_note: string;
  best_time: string;
  trip_length: string;
  budget: string;
  reasons: [string, string, string];
  audience: string[];
  downsides: string;
};

const EMPTY: FormState = {
  title: "", country: "", city: "", image_url: "",
  vibes: [], description: "", special_note: "",
  best_time: "", trip_length: "", budget: "",
  reasons: ["", "", ""], audience: [], downsides: "",
};

export function PitchTripDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<"form" | "verify">("form");
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const search = useServerFn(geocodeSearch);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleArr = (k: "vibes" | "audience", v: string) =>
    setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));

  function resetAll() {
    setForm(EMPTY);
    setStep("form");
    setCandidates([]);
    setSelectedIdx(null);
  }

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image must be under 8MB");
      return;
    }
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${u.user.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("destination-covers").upload(path, file, {
        cacheControl: "31536000", upsert: false,
      });
      if (up.error) throw up.error;
      const signed = await supabase.storage.from("destination-covers").createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      if (signed.error) throw signed.error;
      update("image_url", signed.data.signedUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const lookup = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Destination name is required");
      if (!form.country.trim()) throw new Error("Country is required");
      if (!form.description.trim()) throw new Error("Tell the crew why you should go");
      const parts = [form.title.trim(), form.city.trim(), form.country.trim()].filter(Boolean);
      const query = Array.from(new Set(parts)).join(", ");
      const res = await search({ data: { query } });
      if (!res.candidates.length) {
        throw new Error("We couldn't find that place. Double-check the spelling and try again.");
      }
      return res.candidates;
    },
    onSuccess: (cands) => {
      setCandidates(cands);
      setSelectedIdx(0);
      setStep("verify");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Lookup failed"),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      if (selectedIdx == null) throw new Error("Pick the correct location to continue");
      const chosen = candidates[selectedIdx];
      if (!chosen) throw new Error("Pick the correct location to continue");

      const reasons = form.reasons.map((r) => r.trim()).filter(Boolean);
      // Verified values from Mapbox win over typed values so the saved
      // destination always matches the chosen coordinates.
      const city = chosen.city || form.city.trim() || null;
      const country = chosen.country || form.country.trim() || null;
      const region = chosen.region || form.city.trim() || form.country.trim() || "—";
      const payload = {
        title: form.title.trim(),
        country,
        city,
        region,
        latitude: chosen.latitude,
        longitude: chosen.longitude,
        description: form.description.trim() || null,
        image_url: form.image_url || null,
        vibes: form.vibes.length ? form.vibes : null,
        special_note: form.special_note.trim() || null,
        best_time: form.best_time || null,
        trip_length: form.trip_length || null,
        budget: form.budget || null,
        reasons: reasons.length ? reasons : null,
        audience: form.audience.length ? form.audience : null,
        downsides: form.downsides.trim() || null,
        user_id: u.user.id,
      };
      const { error } = await supabase
        .from("destinations")
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("Pitched to the crew!");
      setOpen(false);
      resetAll();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="shrink-0"><Plus className="size-4" /> Pitch a trip</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-5xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-6 py-4">
          <DialogTitle className="font-display text-2xl">
            <Sparkles className="mr-2 inline size-5 text-primary" />
            Pitch a trip
          </DialogTitle>
          <p className="text-sm text-muted-foreground">Convince the crew — make it sound impossible to say no.</p>
        </DialogHeader>

        {step === "verify" ? (
          <VerifyStep
            candidates={candidates}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
            onBack={() => setStep("form")}
            onConfirm={() => create.mutate()}
            confirming={create.isPending}
            typed={{ title: form.title, city: form.city, country: form.country }}
          />
        ) : (
        <div className="grid max-h-[calc(92vh-5rem)] grid-cols-1 overflow-hidden md:grid-cols-[1.4fr_1fr]">

          {/* Form column */}
          <form
            onSubmit={(e) => { e.preventDefault(); lookup.mutate(); }}

            className="space-y-6 overflow-y-auto px-6 py-5"
          >
            {/* Destination */}
            <Section title="Destination">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Destination name *</Label>
                  <Input required value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Mykonos" />
                </div>
                <div>
                  <Label>Country *</Label>
                  <Input required value={form.country} onChange={(e) => update("country", e.target.value)} placeholder="Greece" />
                </div>
              </div>
              <div>
                <Label>City <span className="text-muted-foreground">(optional)</span></Label>
                <Input value={form.city} onChange={(e) => update("city", e.target.value)} placeholder="Mykonos Town" />
              </div>
            </Section>

            {/* Cover photo */}
            <Section title="Cover Photo">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="relative h-32 w-full overflow-hidden rounded-xl border border-border/60 bg-muted sm:w-48">
                  {form.image_url ? (
                    <>
                      <img src={form.image_url} alt="Cover preview" className="size-full object-cover" />
                      <button
                        type="button"
                        onClick={() => update("image_url", "")}
                        className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 hover:bg-background"
                        aria-label="Remove cover"
                      >
                        <X className="size-3.5" />
                      </button>
                    </>
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <ImageOff className="size-6" />
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="w-full sm:w-auto"
                  >
                    <Upload className="size-4" /> {uploading ? "Uploading..." : "Upload image"}
                  </Button>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" /> or paste a URL <span className="h-px flex-1 bg-border" />
                  </div>
                  <Input
                    value={form.image_url}
                    onChange={(e) => update("image_url", e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
            </Section>

            {/* Vibes */}
            <Section title="Vibe" hint="Pick all that fit">
              <ChipGrid
                options={VIBES.map((v) => ({ id: v.id, label: `${v.emoji} ${v.label}` }))}
                value={form.vibes}
                onToggle={(id) => toggleArr("vibes", id)}
              />
            </Section>

            {/* Convince */}
            <Section title="Convince the Crew">
              <div>
                <Label>Why should we go? *</Label>
                <Textarea
                  required
                  rows={4}
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder="Convince your friends this destination is worth the PTO, money, and planning."
                />
              </div>
              <div>
                <Label>What makes this trip special? <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  value={form.special_note}
                  onChange={(e) => update("special_note", e.target.value)}
                  placeholder="Atlantis Week · Pride Festival · Legendary beach clubs"
                />
              </div>
            </Section>

            {/* Planning */}
            <Section title="Trip Planning">
              <div>
                <Label>Best time to go</Label>
                <ChipGrid
                  options={MONTHS.map((m) => ({ id: m, label: m }))}
                  value={form.best_time ? [form.best_time] : []}
                  onToggle={(id) => update("best_time", form.best_time === id ? "" : id)}
                  size="sm"
                />
              </div>
              <div>
                <Label>Ideal trip length</Label>
                <Segmented options={LENGTHS} value={form.trip_length} onChange={(v) => update("trip_length", v)} />
              </div>
              <div>
                <Label>Budget</Label>
                <Segmented options={BUDGETS} value={form.budget} onChange={(v) => update("budget", v)} />
              </div>
            </Section>

            {/* Highlights */}
            <Section title="Top 3 Reasons This Trip Wins">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-medium text-primary">{i + 1}</span>
                  <Input
                    value={form.reasons[i]}
                    onChange={(e) => {
                      const next = [...form.reasons] as FormState["reasons"];
                      next[i] = e.target.value;
                      update("reasons", next);
                    }}
                    placeholder={["Sunset views in Little Venice", "Legendary nightlife", "Elia Beach"][i]}
                  />
                </div>
              ))}
            </Section>

            {/* Audience */}
            <Section title="Who Is This Trip For?" hint="Multi-select">
              <ChipGrid
                options={AUDIENCES.map((a) => ({ id: a, label: a }))}
                value={form.audience}
                onToggle={(id) => toggleArr("audience", id)}
              />
            </Section>

            {/* Downsides */}
            <Section title="Things to Know" hint="Optional — be honest">
              <Textarea
                rows={2}
                value={form.downsides}
                onChange={(e) => update("downsides", e.target.value)}
                placeholder="Expensive during peak season · Crowded in summer · Requires multiple flights"
              />
            </Section>

            <Button type="submit" disabled={lookup.isPending} className="w-full" size="lg">
              {lookup.isPending ? "Looking up location..." : "Next: verify location"}
            </Button>
          </form>

          {/* Preview column */}
          <aside className="hidden border-l border-border/60 bg-muted/20 md:block">
            <div className="sticky top-0 max-h-[calc(92vh-5rem)] overflow-y-auto p-5">
              <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Live preview</p>
              <PitchPreview form={form} />
            </div>
          </aside>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VerifyStep({
  candidates,
  selectedIdx,
  onSelect,
  onBack,
  onConfirm,
  confirming,
  typed,
}: {
  candidates: GeocodeCandidate[];
  selectedIdx: number | null;
  onSelect: (i: number) => void;
  onBack: () => void;
  onConfirm: () => void;
  confirming: boolean;
  typed: { title: string; city: string; country: string };
}) {
  const typedQuery = [typed.title, typed.city, typed.country].filter((s) => s.trim()).join(", ");
  return (
    <div className="flex max-h-[calc(92vh-5rem)] flex-col overflow-hidden">
      <div className="space-y-1 border-b border-border/60 px-6 py-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Step 2 of 2</p>
        <h3 className="font-display text-xl">Verify the location</h3>
        <p className="text-sm text-muted-foreground">
          You typed <span className="text-foreground">"{typedQuery}"</span>. Pick the location that matches so the
          map, events, and timezone all line up.
        </p>
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto px-6 py-4">
        {candidates.map((c, i) => {
          const active = selectedIdx === i;
          return (
            <li key={`${c.latitude},${c.longitude},${i}`}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-pressed={active}
                className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <span
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${
                    active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                  aria-hidden
                >
                  {active && <Check className="size-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <MapPin className="size-3.5 text-primary" />
                    <span className="truncate">{c.place_name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {c.city && <span>City: {c.city}</span>}
                    {c.region && <span>Region: {c.region}</span>}
                    {c.country && <span>Country: {c.country}</span>}
                    <span className="opacity-70">
                      {c.latitude.toFixed(3)}, {c.longitude.toFixed(3)}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col-reverse gap-2 border-t border-border/60 px-6 py-4 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack} disabled={confirming}>
          <ArrowLeft className="size-4" /> Back to edit
        </Button>
        <Button type="button" onClick={onConfirm} disabled={confirming || selectedIdx == null} size="lg">
          {confirming ? <><Loader2 className="size-4 animate-spin" /> Pitching...</> : "Confirm & pitch to crew"}
        </Button>
      </div>
    </div>
  );
}


function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ChipGrid({
  options, value, onToggle, size = "md",
}: {
  options: { id: string; label: string }[];
  value: string[];
  onToggle: (id: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onToggle(o.id)}
            className={`rounded-full border transition ${size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"} ${
              active
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-card p-1">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(active ? "" : o)}
            className={`rounded-full px-3 py-1 text-sm transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function PitchPreview({ form }: { form: FormState }) {
  const vibeLabels = useMemo(
    () => form.vibes.map((id) => VIBES.find((v) => v.id === id)).filter(Boolean) as typeof VIBES,
    [form.vibes],
  );
  const reasons = form.reasons.filter((r) => r.trim());
  const title = form.title || "Your destination";

  return (
    <article className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-soft)]">
      <div className="relative aspect-[16/10] bg-muted">
        {form.image_url ? (
          <img src={form.image_url} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/15 via-accent/10 to-muted text-muted-foreground">
            <ImageOff className="size-7" />
          </div>
        )}
        <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-xs backdrop-blur">
          <MapPin className="size-3 text-primary" />
          {form.city ? `${form.city}, ${form.country || "—"}` : form.country || "Where to?"}
        </div>
        {form.budget && (
          <div className="absolute right-3 top-3 rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium backdrop-blur">
            {form.budget}
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h4 className="font-display text-xl leading-tight">{title}</h4>
          {(form.best_time || form.trip_length) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[form.best_time, form.trip_length].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {vibeLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {vibeLabels.slice(0, 5).map((v) => (
              <span key={v.id} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {v.emoji} {v.label}
              </span>
            ))}
            {vibeLabels.length > 5 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">+{vibeLabels.length - 5}</span>
            )}
          </div>
        )}

        {form.description && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{form.description}</p>
        )}

        {form.special_note && (
          <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">✨ {form.special_note}</p>
        )}

        {reasons.length > 0 && (
          <ul className="space-y-1.5">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        {form.downsides && (
          <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">Heads up:</span> {form.downsides}
          </p>
        )}
      </div>
    </article>
  );
}
