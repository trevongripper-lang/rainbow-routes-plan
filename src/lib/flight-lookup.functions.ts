import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  query: z.string().min(2).max(200),
});

const Schema = {
  type: "object",
  properties: {
    airline: { type: "string", description: "Airline name, e.g. 'Delta Air Lines'" },
    flight_number: { type: "string", description: "Flight number, e.g. 'DL123'" },
    flight_date: { type: "string", description: "ISO date YYYY-MM-DD if mentioned, otherwise empty string" },
    depart_airport: { type: "string", description: "IATA code or city, e.g. 'JFK' or 'New York'" },
    arrive_airport: { type: "string", description: "IATA code or city of arrival" },
    depart_time: { type: "string", description: "Local departure time HH:MM (24h), or empty" },
    arrive_time: { type: "string", description: "Local arrival time HH:MM (24h), or empty" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string", description: "Short clarification if anything was uncertain" },
  },
  required: ["airline", "flight_number", "confidence"],
  additionalProperties: false,
} as const;

export const lookupFlight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI service not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You help travelers fill in flight details. Given a flight number, airline, route, or natural-language description, return your best-guess structured details. Use general knowledge of airline schedules. If you are uncertain about a specific field, leave it as an empty string and set confidence accordingly. Never invent confirmation numbers.",
          },
          { role: "user", content: data.query },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "set_flight_details",
              description: "Return structured flight details",
              parameters: Schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "set_flight_details" } },
      }),
    });

    if (res.status === 429) throw new Error("AI rate limit reached. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI lookup failed: ${txt.slice(0, 200)}`);
    }

    const json = await res.json();
    const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("AI returned no result");
    let parsed: {
      airline: string;
      flight_number: string;
      flight_date?: string;
      depart_airport?: string;
      arrive_airport?: string;
      depart_time?: string;
      arrive_time?: string;
      confidence: "high" | "medium" | "low";
      notes?: string;
      source?: "ai" | "aviationstack" | "serpstack";
    };
    try {
      parsed = JSON.parse(args);
      parsed.source = "ai";
    } catch {
      throw new Error("AI returned malformed result");
    }

    // Best-effort verification via AviationStack (real-time schedule API).
    const avKey = process.env.AVIATIONSTACK_API_KEY;
    const flightNum = (parsed.flight_number || "").replace(/\s+/g, "").toUpperCase();
    let verifiedByAviationStack = false;
    if (avKey && flightNum) {
      try {
        const params = new URLSearchParams({
          access_key: avKey,
          flight_iata: flightNum,
          limit: "1",
        });
        if (parsed.flight_date) params.set("flight_date", parsed.flight_date);
        const avRes = await fetch(`https://api.aviationstack.com/v1/flights?${params}`);
        if (avRes.ok) {
          const avJson = await avRes.json();
          const f = avJson?.data?.[0];
          if (f) {
            const hhmm = (iso?: string | null) => (iso ? iso.slice(11, 16) : "");
            const verifiedNote = `Verified via AviationStack${f.flight_status ? ` · ${f.flight_status}` : ""}${f.departure?.terminal ? ` · dep T${f.departure.terminal}` : ""}${f.departure?.gate ? `/G${f.departure.gate}` : ""}${f.arrival?.terminal ? ` · arr T${f.arrival.terminal}` : ""}`;
            parsed = {
              ...parsed,
              airline: f.airline?.name || parsed.airline,
              flight_number: f.flight?.iata || parsed.flight_number,
              flight_date: f.flight_date || parsed.flight_date,
              depart_airport: f.departure?.iata || parsed.depart_airport,
              arrive_airport: f.arrival?.iata || parsed.arrive_airport,
              depart_time: hhmm(f.departure?.scheduled) || parsed.depart_time,
              arrive_time: hhmm(f.arrival?.scheduled) || parsed.arrive_time,
              confidence: "high",
              notes: verifiedNote,
              source: "aviationstack",
            };
            verifiedByAviationStack = true;
          }
        }
      } catch {
        // Verification is best-effort; fall back to AI parse silently.
      }
    }

    // Fallback verification via Serpstack web search snippets.
    // Used when AviationStack didn't return data (free tier limits, historical
    // flights, codeshares). We pull Google search snippets for the flight
    // number and ask the AI to re-extract fields from real-world results.
    const spKey = process.env.SERPSTACK_API_KEY;
    if (!verifiedByAviationStack && spKey && flightNum) {
      try {
        const q = `${flightNum} flight${parsed.flight_date ? ` ${parsed.flight_date}` : ""} schedule departure arrival airport`;
        const spParams = new URLSearchParams({
          access_key: spKey,
          query: q,
          num: "5",
          output: "json",
        });
        const spRes = await fetch(`https://api.serpstack.com/search?${spParams}`);
        if (spRes.ok) {
          const spJson = await spRes.json();
          const organic: Array<{ title?: string; snippet?: string; url?: string }> =
            spJson?.organic_results ?? [];
          const snippets = organic
            .slice(0, 5)
            .map((r, i) => `${i + 1}. ${r.title ?? ""} — ${r.snippet ?? ""}`)
            .join("\n");
          if (snippets.trim()) {
            const refineRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [
                  {
                    role: "system",
                    content:
                      "Refine flight details using real web search results. Prefer information from the snippets over prior guesses. Leave fields empty if the snippets don't support a confident value.",
                  },
                  {
                    role: "user",
                    content: `Original query: ${data.query}\nPrior guess: ${JSON.stringify(parsed)}\nWeb snippets:\n${snippets}`,
                  },
                ],
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "set_flight_details",
                      description: "Return refined flight details",
                      parameters: Schema,
                    },
                  },
                ],
                tool_choice: { type: "function", function: { name: "set_flight_details" } },
              }),
            });
            if (refineRes.ok) {
              const refineJson = await refineRes.json();
              const refArgs =
                refineJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
              if (refArgs) {
                try {
                  const refined = JSON.parse(refArgs);
                  parsed = {
                    ...parsed,
                    ...refined,
                    notes: `Refined via Serpstack web results.${refined.notes ? " " + refined.notes : ""}`,
                    source: "serpstack",
                  };
                } catch {
                  // ignore malformed refine
                }
              }
            }
          }
        }
      } catch {
        // Best-effort; silently fall back.
      }
    }

    return parsed;
  });
