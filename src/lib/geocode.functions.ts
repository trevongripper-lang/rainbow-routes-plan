import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Nominatim (OpenStreetMap) result shape — subset we use.
type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    county?: string;
    state?: string;
    region?: string;
    country?: string;
  };
};

export type GeocodeCandidate = {
  place_name: string;
  latitude: number;
  longitude: number;
  city: string | null;
  region: string | null;
  country: string | null;
};

// Nominatim usage policy requires a descriptive User-Agent identifying the app.
const USER_AGENT = "TribeTrips/1.0 (+https://jointribetrips.com; hello@jointribetrips.com)";

function parseResult(r: NominatimResult): GeocodeCandidate {
  const a = r.address ?? {};
  const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? null;
  const region = a.state ?? a.region ?? a.county ?? null;
  const country = a.country ?? null;
  return {
    place_name: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    city,
    region,
    country,
  };
}

async function nominatimSearch(query: string, limit: number): Promise<NominatimResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=${limit}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Location search failed: ${res.status}`);
  return (await res.json()) as NominatimResult[];
}

export const geocodeSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { query: string }) => ({
    query: String(data?.query ?? "")
      .trim()
      .slice(0, 200),
  }))
  .handler(async ({ data }) => {
    if (!data.query) return { candidates: [] as GeocodeCandidate[] };
    const results = await nominatimSearch(data.query, 5);
    return { candidates: results.map(parseResult) };
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

    // Lead with `title` (the real place name) so the query is never just a
    // continent/country pair, which would resolve to a region centroid.
    const parts = [dest.title, dest.city, dest.region, dest.country]
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length > 0);
    const query = Array.from(new Set(parts)).join(", ");
    if (!query) return { ok: false, cached: false, latitude: null, longitude: null };

    const results = await nominatimSearch(query, 1);
    const top = results[0];
    if (!top) return { ok: false, cached: false, latitude: null, longitude: null };
    const parsed = parseResult(top);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin
      .from("destinations")
      .update({
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        ...(dest.city ? {} : parsed.city ? { city: parsed.city } : {}),
        ...(dest.region && dest.region !== "—"
          ? {}
          : parsed.region
            ? { region: parsed.region }
            : {}),
        ...(dest.country ? {} : parsed.country ? { country: parsed.country } : {}),
      })
      .eq("id", destinationId);
    if (upErr) throw upErr;
    return { ok: true, cached: false, latitude: parsed.latitude, longitude: parsed.longitude };
  });
