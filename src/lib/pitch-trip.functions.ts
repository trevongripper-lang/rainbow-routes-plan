import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PitchTripInput = {
  title: string;
  country: string | null;
  city: string | null;
  region: string;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  image_url: string | null;
  vibes: string[] | null;
  special_note: string | null;
  best_time: string | null;
  trip_length: string | null;
  budget: string | null;
  reasons: string[] | null;
  audience: string[] | null;
  downsides: string | null;
};

function clean(input: unknown): PitchTripInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const orNull = (s: string) => (s.length ? s : null);
  const strArr = (v: unknown) =>
    Array.isArray(v)
      ? (v.filter((x) => typeof x === "string" && x.trim().length > 0) as string[])
      : null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const title = str(o.title);
  if (!title) throw new Error("Destination name is required.");
  const region = str(o.region) || str(o.city) || str(o.country);
  if (!region) throw new Error("Region, city, or country is required.");

  return {
    title,
    country: orNull(str(o.country)),
    city: orNull(str(o.city)),
    region,
    latitude: num(o.latitude),
    longitude: num(o.longitude),
    description: orNull(str(o.description)),
    image_url: orNull(str(o.image_url)),
    vibes: strArr(o.vibes),
    special_note: orNull(str(o.special_note)),
    best_time: orNull(str(o.best_time)),
    trip_length: orNull(str(o.trip_length)),
    budget: orNull(str(o.budget)),
    reasons: strArr(o.reasons),
    audience: strArr(o.audience),
    downsides: orNull(str(o.downsides)),
  };
}

export const createPitchTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => clean(input))
  .handler(async ({ data, context }) => {
    // Insert as the authenticated user so RLS (auth.uid() = user_id) applies.
    const { supabase, userId } = context;
    const payload = { ...data, user_id: userId };

    const { data: row, error } = await supabase
      .from("destinations")
      .insert(payload as never)
      .select("id")
      .single();

    if (error) {
      const detail = [error.message, (error as { details?: string }).details, (error as { hint?: string }).hint]
        .filter(Boolean)
        .join(" — ");
      throw new Error(detail || "Failed to create trip");
    }
    return { id: (row as { id: string }).id };
  });
