import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------- URL enrichment ----------
const EnrichInput = z.object({ url: z.string().url().max(2000) });

export type EnrichedUrl = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
  price: number | null;
  currency: string | null;
  start_date: string | null;
  end_date: string | null;
};

function pickMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`,
      "i",
    );
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]).trim();
    const re2 = new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${name}["']`,
      "i",
    );
    const m2 = html.match(re2);
    if (m2?.[1]) return decodeEntities(m2[1]).trim();
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
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
      // ignore malformed JSON-LD blocks
    }
  }
  return out;
}

function firstStringProp(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

export const enrichUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => EnrichInput.parse(data))
  .handler(async ({ data }): Promise<EnrichedUrl> => {
    const fallback: EnrichedUrl = {
      url: data.url,
      title: null,
      description: null,
      image: null,
      site_name: null,
      price: null,
      currency: null,
      start_date: null,
      end_date: null,
    };
    let html = "";
    try {
      const res = await fetch(data.url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; TribeTripsBot/1.0; +https://jointribetrips.com)",
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      if (!res.ok) return fallback;
      html = (await res.text()).slice(0, 400_000);
    } catch {
      return fallback;
    }

    const title =
      pickMeta(html, ["og:title", "twitter:title"]) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
      null;
    const description = pickMeta(html, ["og:description", "twitter:description", "description"]);
    const image = pickMeta(html, ["og:image", "twitter:image", "twitter:image:src"]);
    const site_name = pickMeta(html, ["og:site_name", "application-name"]);

    // Parse JSON-LD for price / dates
    let price: number | null = null;
    let currency: string | null = null;
    let start_date: string | null = null;
    let end_date: string | null = null;

    for (const node of extractJsonLd(html)) {
      const stack: unknown[] = Array.isArray(node) ? [...node] : [node];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        const obj = cur as Record<string, unknown>;
        for (const v of Object.values(obj)) {
          if (v && typeof v === "object") stack.push(v);
        }
        const offers = obj.offers;
        if (offers) stack.push(offers);
        const p = obj.price ?? obj.lowPrice ?? firstStringProp(obj, "price");
        if (price === null && p !== undefined) {
          const n = typeof p === "number" ? p : parseFloat(String(p).replace(/[^0-9.]/g, ""));
          if (!Number.isNaN(n)) price = n;
        }
        const cur1 = obj.priceCurrency ?? obj.currency;
        if (!currency && typeof cur1 === "string") currency = cur1;
        const sd = obj.startDate ?? obj.checkinDate ?? obj.validFrom;
        if (!start_date && typeof sd === "string") start_date = sd.slice(0, 10);
        const ed = obj.endDate ?? obj.checkoutDate ?? obj.validThrough;
        if (!end_date && typeof ed === "string") end_date = ed.slice(0, 10);
      }
    }

    // Fallback price from meta tags (Airbnb-style)
    if (price === null) {
      const m = pickMeta(html, ["product:price:amount", "og:price:amount"]);
      if (m) {
        const n = parseFloat(m.replace(/[^0-9.]/g, ""));
        if (!Number.isNaN(n)) price = n;
      }
    }
    if (!currency) currency = pickMeta(html, ["product:price:currency", "og:price:currency"]);

    return {
      ...fallback,
      title,
      description,
      image,
      site_name,
      price,
      currency,
      start_date,
      end_date,
    };
  });

// ---------- AI smart-add classifier ----------
const SmartAddInput = z.object({
  destinationId: z.string().uuid(),
  text: z.string().min(2).max(2000),
  enriched: z
    .object({
      url: z.string(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      image: z.string().nullable(),
      site_name: z.string().nullable(),
      price: z.number().nullable(),
      currency: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
    })
    .nullish(),
});

const ClassifySchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["stay", "ticket", "cost", "flight", "note"],
      description:
        "Which trip surface this belongs to. 'stay' = lodging. 'ticket' = activity/tour/event/admission. 'cost' = pure expense or split-the-bill. 'flight' = airline travel. 'note' = chat message / open question.",
    },
    title: { type: "string", description: "Short label (max ~80 chars)" },
    description: { type: "string", description: "Optional longer description, may be empty" },
    amount: { type: "number", description: "Numeric amount if mentioned, else 0" },
    currency: { type: "string", description: "ISO currency like USD, EUR. Empty if unknown" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["kind", "title", "confidence"],
  additionalProperties: false,
} as const;

export const classifySmartAdd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SmartAddInput.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI service not configured");

    const context = data.enriched
      ? `URL: ${data.enriched.url}\nSite: ${data.enriched.site_name ?? "?"}\nPage title: ${data.enriched.title ?? "?"}\nPage description: ${data.enriched.description ?? "?"}\nPrice: ${data.enriched.price ?? "?"} ${data.enriched.currency ?? ""}`
      : "(no URL context)";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You classify items pasted into a group-trip planner. Decide which surface the item belongs to (stay/ticket/cost/flight/note), give a short title, optional description, and extract a numeric amount + currency if any. Use the URL context when present to make a confident call.",
          },
          {
            role: "user",
            content: `User pasted:\n"""${data.text}"""\n\nURL context:\n${context}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_item",
              description: "Classify the pasted item",
              parameters: ClassifySchema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_item" } },
      }),
    });

    if (res.status === 429) throw new Error("AI rate limit reached. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    if (!res.ok) throw new Error(`AI classification failed: ${(await res.text()).slice(0, 200)}`);

    const json = await res.json();
    const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("AI returned no classification");
    try {
      return JSON.parse(args) as {
        kind: "stay" | "ticket" | "cost" | "flight" | "note";
        title: string;
        description?: string;
        amount?: number;
        currency?: string;
        confidence: "high" | "medium" | "low";
      };
    } catch {
      throw new Error("AI returned malformed classification");
    }
  });
