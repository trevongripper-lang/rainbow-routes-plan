import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const geocodeDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { destinationId: string }) => data)
  .handler(async ({ data, context }) => {
    const { destinationId } = data;
    // Membership/visibility is enforced by RLS on this select.
    const { data: dest, error } = await context.supabase
      .from("destinations")
      .select("id, title, region, country, latitude, longitude")
      .eq("id", destinationId)
      .maybeSingle();
    if (error) throw error;
    if (!dest) throw new Error("Trip not found");
    if (dest.latitude != null && dest.longitude != null) {
      return { ok: true, cached: true, latitude: dest.latitude, longitude: dest.longitude };
    }
    const token = process.env.MAPBOX_TOKEN;
    if (!token) throw new Error("MAPBOX_TOKEN not configured");

    const query = [dest.region, dest.country].filter(Boolean).join(", ") || dest.title;
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      query,
    )}.json?limit=1&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mapbox geocoding failed: ${res.status}`);
    const json = (await res.json()) as { features?: Array<{ center?: [number, number] }> };
    const center = json.features?.[0]?.center;
    if (!center) return { ok: false, cached: false, latitude: null, longitude: null };
    const [lng, lat] = center;

    // Write with service role so any member who views the trip can backfill coords.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin
      .from("destinations")
      .update({ latitude: lat, longitude: lng })
      .eq("id", destinationId);
    if (upErr) throw upErr;
    return { ok: true, cached: false, latitude: lat, longitude: lng };
  });
