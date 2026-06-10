import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getIntegrationsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return {
      serpstack: { configured: Boolean(process.env.SERPSTACK_API_KEY) },
      aviationstack: { configured: Boolean(process.env.AVIATIONSTACK_API_KEY) },
    };
  });

export const testSerpstack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const key = process.env.SERPSTACK_API_KEY;
    if (!key) {
      return { ok: false as const, message: "SERPSTACK_API_KEY is not configured." };
    }
    const params = new URLSearchParams({
      access_key: key,
      query: "DL123 flight schedule",
      num: "1",
      output: "json",
    });
    try {
      const res = await fetch(`https://api.serpstack.com/search?${params}`);
      const json = (await res.json()) as {
        success?: boolean;
        error?: { code?: number; type?: string; info?: string };
        organic_results?: Array<{ title?: string; url?: string; snippet?: string }>;
        search_information?: { total_results?: number };
      };
      if (!res.ok || json?.error || json?.success === false) {
        const info = json?.error?.info || `HTTP ${res.status}`;
        return { ok: false as const, message: `Serpstack rejected the request: ${info}` };
      }
      const top = json.organic_results?.[0];
      return {
        ok: true as const,
        message: "Serpstack responded successfully.",
        sample: top
          ? { title: top.title ?? "", url: top.url ?? "", snippet: top.snippet ?? "" }
          : null,
        totalResults: json.search_information?.total_results ?? null,
      };
    } catch (e) {
      return {
        ok: false as const,
        message: `Network error reaching Serpstack: ${e instanceof Error ? e.message : "unknown"}`,
      };
    }
  });
