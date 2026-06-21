import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type MapboxFeature = {
  id: string;
  text: string;
  place_name: string;
  center: [number, number];
  place_type: string[];
  context?: Array<{ id: string; text: string; short_code?: string }>;
};

export type GeocodeCandidate = {
  place_name: string;
  latitude: number;
  longitude: number;
  city: string | null;
  region: string | null;
  country: string | null;
};

function parseFeature(f: MapboxFeature): GeocodeCandidate {
  const ctx = f.context || [];
  const pick = (prefix: string) =>
    ctx.find((c) => c.id.startsWith(prefix))?.text ?? null;
  const selfType = f.place_type?.[0] ?? "";
  const city =
    selfType === "place" || selfType === "locality"
      ? f.text
      : pick("place") ?? pick("locality");
  const region = selfType === "region" ? f.text : pick("region");
  const country = selfType === "country" ? f.text : pick("country");
  return {
    place_name: f.place_name,
    latitude: f.center[1],
    longitude: f.center[0],
    city,
    region,
    country,
  };
}

export const geocodeSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { query: string }) => ({
    query: String(data?.query ?? "").trim().slice(0, 200),
  }))
  .handler(async ({ data }) => {
    const token = process.env.MAPBOX_TOKEN;
    if (!token) throw new Error("MAPBOX_TOKEN not configured");
    if (!data.query) return { candidates: [] as GeocodeCandidate[] };
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      data.query,
    )}.json?limit=5&types=place,locality,region,country&access_token=${token}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Mapbox failed: ${r.status}`);
    const j = (await r.json()) as { features?: MapboxFeature[] };
    return { candidates: (j.features ?? []).map(parseFeature) };
  });

export const geocodeDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { destinationId: string }) => data)
  .handler(async ({ data, context }) => {
    const { destinationId } = data;
    const { data: dest, error } = await context.supabase
      .from("destinations")
      .select("id, title, city, region, country, latitude, longitude")
      .eq("id", destinationId)
      .maybeSingle();
    if (error) throw error;
    if (!dest) throw new Error("Trip not found");
    if (dest.latitude != null && dest.longitude != null) {
      return { ok: true, cached: true, latitude: dest.latitude, longitude: dest.longitude };
    }
    const token = process.env.MAPBOX_TOKEN;
    if (!token) throw new Error("MAPBOX_TOKEN not configured");

    // Lead with `title` (the real place name) so the query is never just a
    // continent/country pair, which would resolve to a region centroid.
    const parts = [dest.title, dest.city, dest.region, dest.country]
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length > 0);
    const query = Array.from(new Set(parts)).join(", ");
    if (!query) return { ok: false, cached: false, latitude: null, longitude: null };
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      query,
    )}.json?limit=1&types=place,locality,region,country&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mapbox geocoding failed: ${res.status}`);
    const json = (await res.json()) as { features?: MapboxFeature[] };
    const top = json.features?.[0];
    if (!top?.center) return { ok: false, cached: false, latitude: null, longitude: null };
    const parsed = parseFeature(top);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin
      .from("destinations")
      .update({
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        // Backfill missing city/region/country so the data is self-consistent.
        ...(dest.city ? {} : parsed.city ? { city: parsed.city } : {}),
        ...(dest.region && dest.region !== "—" ? {} : parsed.region ? { region: parsed.region } : {}),
        ...(dest.country ? {} : parsed.country ? { country: parsed.country } : {}),
      })
      .eq("id", destinationId);
    if (upErr) throw upErr;
    return { ok: true, cached: false, latitude: parsed.latitude, longitude: parsed.longitude };
  });
