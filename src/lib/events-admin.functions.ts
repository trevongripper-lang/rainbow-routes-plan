import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type EventDraft = {
  name: string;
  description: string;
  start_date: string; // YYYY-MM-DD
  end_date: string | null;
  city: string;
  region: string;
  country: string;
  url: string;
  image_url: string | null;
  tags: string;
  latitude: number | null;
  longitude: number | null;
};

async function assertAdmin(ctx: {
  supabase: typeof import("@/integrations/supabase/client").supabase;
  userId: string;
}) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

// ---------- Page fetch + meta extraction ----------
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function pickMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`,
      "i",
    );
    const m1 = html.match(re1);
    if (m1?.[1]) return decodeEntities(m1[1]).trim();
    const re2 = new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${name}["']`,
      "i",
    );
    const m2 = html.match(re2);
    if (m2?.[1]) return decodeEntities(m2[1]).trim();
  }
  return null;
}

function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const v = JSON.parse(m[1].trim());
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    } catch {
      // skip invalid JSON-LD blocks
    }
  }
  return out;
}

type RawEvent = {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  image?: string;
  location?: unknown;
  url?: string;
};

function findEventNodes(nodes: unknown[]): RawEvent[] {
  const out: RawEvent[] = [];
  const stack: unknown[] = [...nodes];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    const obj = cur as Record<string, unknown>;
    const t = obj["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types.some((x) => typeof x === "string" && x.toLowerCase().includes("event"))) {
      out.push(obj as RawEvent);
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return out;
}

// ---------- Extract via AI (URL → structured event) ----------
const ExtractInput = z.object({ url: z.string().url().max(2000) });

export const extractEventFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExtractInput.parse(d))
  .handler(async ({ data, context }): Promise<EventDraft> => {
    await assertAdmin(context);

    // 1) Fetch page
    let html = "";
    try {
      const res = await fetch(data.url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; TribeTripsBot/1.0; +https://tribetrips.app)",
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      if (res.ok) html = (await res.text()).slice(0, 600_000);
    } catch {
      // network/parse errors fall through to AI-only path
    }

    const ogTitle =
      pickMeta(html, ["og:title", "twitter:title"]) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
      "";
    const ogDesc = pickMeta(html, ["og:description", "twitter:description", "description"]) || "";
    const ogImage = pickMeta(html, ["og:image", "twitter:image", "twitter:image:src"]);
    const jsonLd = findEventNodes(extractJsonLd(html));
    const ldHint = jsonLd.length > 0 ? JSON.stringify(jsonLd[0]).slice(0, 4000) : "";

    // 2) Ask AI to normalize
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI not configured");

    const schema = {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        description: { type: "string", description: "Concise 1-3 sentence description" },
        start_date: { type: "string", description: "YYYY-MM-DD, best guess if range" },
        end_date: { type: "string", description: "YYYY-MM-DD or empty if single day" },
        city: { type: "string" },
        region: { type: "string", description: "State/region/continent if known, else country" },
        country: { type: "string" },
        tags: { type: "string", description: "Comma-separated, e.g. 'pride,festival'" },
      },
      required: ["name", "start_date", "city", "country"],
      additionalProperties: false,
    } as const;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "Extract structured event details from the provided page context. Be precise about dates (ISO YYYY-MM-DD) and location (city + country). If you can't find a real date, leave start_date empty.",
          },
          {
            role: "user",
            content: `URL: ${data.url}\nPage title: ${ogTitle}\nPage description: ${ogDesc}\nJSON-LD event hint: ${ldHint}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: { name: "event", description: "Event details", parameters: schema },
          },
        ],
        tool_choice: { type: "function", function: { name: "event" } },
      }),
    });
    if (aiRes.status === 429) throw new Error("AI rate limit. Try again shortly.");
    if (aiRes.status === 402) throw new Error("AI credits exhausted.");
    if (!aiRes.ok) throw new Error(`AI extraction failed: ${(await aiRes.text()).slice(0, 200)}`);
    const aiJson = await aiRes.json();
    const args = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("AI returned no event");
    const parsed = JSON.parse(args) as {
      name: string;
      description?: string;
      start_date: string;
      end_date?: string;
      city: string;
      region?: string;
      country: string;
      tags?: string;
    };

    // 3) Geocode location
    let latitude: number | null = null;
    let longitude: number | null = null;
    const token = process.env.MAPBOX_TOKEN;
    if (token) {
      const q = [parsed.city, parsed.region, parsed.country].filter(Boolean).join(", ");
      try {
        const mbUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&types=place,locality,region&access_token=${token}`;
        const r = await fetch(mbUrl);
        if (r.ok) {
          const j = (await r.json()) as { features?: Array<{ center: [number, number] }> };
          const top = j.features?.[0];
          if (top?.center) {
            longitude = top.center[0];
            latitude = top.center[1];
          }
        }
      } catch {
        // geocoding failures are non-fatal
      }
    }

    return {
      name: parsed.name || ogTitle || "",
      description: parsed.description || ogDesc || "",
      start_date: parsed.start_date || "",
      end_date: parsed.end_date || null,
      city: parsed.city || "",
      region: parsed.region || parsed.country || "",
      country: parsed.country || "",
      url: data.url,
      image_url: ogImage ?? null,
      tags: parsed.tags || "",
      latitude,
      longitude,
    };
  });

// ---------- Save event ----------
const SaveInput = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional().default(""),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  city: z.string().min(1).max(120),
  region: z.string().min(1).max(120),
  country: z.string().min(1).max(120),
  url: z.string().url().max(2000).optional().or(z.literal("")),
  tags: z.string().max(200).optional().default(""),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("events")
      .insert({
        name: data.name,
        description: data.description || null,
        start_date: data.start_date,
        end_date: data.end_date || null,
        city: data.city,
        region: data.region,
        country: data.country,
        url: data.url || null,
        tags: data.tags || null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const listAdminEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("events")
      .select("id, name, city, country, start_date, end_date, url")
      .order("start_date", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
