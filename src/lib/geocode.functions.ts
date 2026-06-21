import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

    // IMPORTANT: `title` is the actual place name users type (e.g. "Atlanta",
    // "Mykonos"). `city` is almost always null. Putting region/country alone in
    // the query causes Mapbox to return the centroid of that region (e.g.
    // "North America, United States" → Dublin, OH). Always lead with title.
    const parts = [dest.title, dest.city, dest.region, dest.country]
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length > 0);
    const query = Array.from(new Set(parts)).join(", ");
    if (!query) return { ok: false, cached: false, latitude: null, longitude: null };
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      query,
    )}.json?limit=1&types=place,region,country,locality&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mapbox geocoding failed: ${res.status}`);
    const json = (await res.json()) as { features?: Array<{ center?: [number, number] }> };
    const center = json.features?.[0]?.center;
    if (!center) return { ok: false, cached: false, latitude: null, longitude: null };
    const [lng, lat] = center;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin
      .from("destinations")
      .update({ latitude: lat, longitude: lng })
      .eq("id", destinationId);
    if (upErr) throw upErr;
    return { ok: true, cached: false, latitude: lat, longitude: lng };
  });
