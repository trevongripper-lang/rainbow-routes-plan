import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { CalendarDays, MapPin, ExternalLink, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { PageHero } from "@/components/page-hero";

export const Route = createFileRoute("/_authenticated/events")({
  component: EventsPage,
});


async function fetchEvents() {
  const { data, error } = await supabase.from("events").select("*").order("start_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function EventsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["events"], queryFn: fetchEvents });
  const [region, setRegion] = useState<string>("All");

  const regions = useMemo(() => ["All", ...Array.from(new Set((data ?? []).map((e) => e.region)))], [data]);
  const filtered = region === "All" ? data ?? [] : (data ?? []).filter((e) => e.region === region);

  return (
    <div className="space-y-8">
      <PageHero
        crumbs={[{ label: "Events" }]}
        eyebrow="Pride · circuit · beach"
        eyebrowIcon={Sparkles}
        title="Events by"
        highlight="region"
        description="Curated celebrations and parties around the world — sorted by where you're headed."
      />

      <div className="flex flex-wrap gap-2">
        {regions.map((r) => (
          <button key={r} onClick={() => setRegion(r)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition ${region === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card/40 text-muted-foreground backdrop-blur hover:text-foreground"}`}>
            {r}
          </button>
        ))}
      </div>


      <div className="mt-6 grid gap-3">
        {isLoading && Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-card/60" />)}
        {filtered.map((e) => (
          <article key={e.id} className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-primary"><MapPin className="size-3" />{e.region}</span>
                <span>{e.city}, {e.country}</span>
                {e.tags && <span className="text-accent">· {e.tags}</span>}
              </div>
              <h3 className="mt-1.5 font-display text-xl">{e.name}</h3>
              {e.description && <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5 text-sm font-medium">
                  <CalendarDays className="size-3.5 text-primary" />
                  {format(new Date(e.start_date), "MMM d")}{e.end_date && e.end_date !== e.start_date ? ` – ${format(new Date(e.end_date), "MMM d")}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">{format(new Date(e.start_date), "yyyy")}</div>
              </div>
              {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground"><ExternalLink className="size-4" /></a>}
            </div>
          </article>
        ))}
        {filtered.length === 0 && !isLoading && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">Nothing in this region yet.</div>
        )}
      </div>
    </div>
  );
}
