import { supabase } from "@/integrations/supabase/client";

type TripLite = {
  id: string;
  title: string;
  region: string | null;
  country: string | null;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
};

function pad(n: number) { return n.toString().padStart(2, "0"); }
function fmtDate(d: string): string {
  // YYYYMMDD for all-day events
  return d.replaceAll("-", "");
}
function fmtDateTime(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function fold(line: string): string {
  // RFC5545 line folding at 75 octets
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
    i += 73;
  }
  return parts.join("\r\n");
}

function uid(seed: string) {
  return `${seed}@rainbow-routes`;
}

export async function buildTripsIcs(trips: TripLite[]): Promise<string> {
  const ids = trips.map((t) => t.id);
  const [stays, flights, tickets] = await Promise.all([
    supabase.from("trip_stays").select("*").in("destination_id", ids),
    supabase.from("trip_flights").select("*").in("destination_id", ids),
    supabase.from("trip_tickets").select("*").in("destination_id", ids),
  ]);

  const now = fmtDateTime(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rainbow Routes//Trip Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  const push = (vevent: string[]) => {
    lines.push("BEGIN:VEVENT", ...vevent.map(fold), "END:VEVENT");
  };

  for (const t of trips) {
    const loc = [t.city, t.region, t.country].filter(Boolean).join(", ");
    if (t.start_date && t.end_date) {
      // All-day, DTEND is exclusive (add one day)
      const end = new Date(t.end_date + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + 1);
      const endIso = `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}`;
      push([
        `UID:${uid("trip-" + t.id)}`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${fmtDate(t.start_date)}`,
        `DTEND;VALUE=DATE:${endIso}`,
        `SUMMARY:🌈 ${esc(t.title)}`,
        loc ? `LOCATION:${esc(loc)}` : "",
        t.description ? `DESCRIPTION:${esc(t.description)}` : "",
        "TRANSP:TRANSPARENT",
      ].filter(Boolean));
    }
  }

  for (const s of (stays.data ?? []) as Array<Record<string, unknown>>) {
    const ci = s.check_in as string | null;
    const co = s.check_out as string | null;
    if (!ci) continue;
    const endDate = co ? co : ci;
    const end = new Date(endDate + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() + 1);
    const endIso = `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}`;
    push([
      `UID:${uid("stay-" + (s.id as string))}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${fmtDate(ci)}`,
      `DTEND;VALUE=DATE:${endIso}`,
      `SUMMARY:🛏 ${esc((s.title as string) ?? "Stay")}`,
      s.address ? `LOCATION:${esc(s.address as string)}` : "",
      s.url ? `URL:${esc(s.url as string)}` : "",
      s.description ? `DESCRIPTION:${esc(s.description as string)}` : "",
    ].filter(Boolean));
  }

  for (const f of (flights.data ?? []) as Array<Record<string, unknown>>) {
    const date = f.flight_date as string | null;
    if (!date) continue;
    const dep = (f.depart_time as string | null) ?? "00:00";
    const arr = (f.arrive_time as string | null) ?? dep;
    const start = new Date(`${date}T${dep.length === 5 ? dep + ":00" : dep}Z`);
    const end = new Date(`${date}T${arr.length === 5 ? arr + ":00" : arr}Z`);
    if (end <= start) end.setUTCHours(end.getUTCHours() + 1);
    const route = [f.depart_airport, f.arrive_airport].filter(Boolean).join(" → ");
    push([
      `UID:${uid("flight-" + (f.id as string))}`,
      `DTSTAMP:${now}`,
      `DTSTART:${fmtDateTime(start)}`,
      `DTEND:${fmtDateTime(end)}`,
      `SUMMARY:✈️ ${esc(((f.airline as string) ?? "") + " " + ((f.flight_number as string) ?? "")).trim() || "Flight"}${route ? " · " + esc(route) : ""}`,
      f.confirmation ? `DESCRIPTION:Confirmation ${esc(f.confirmation as string)}` : "",
    ].filter(Boolean));
  }

  for (const t of (tickets.data ?? []) as Array<Record<string, unknown>>) {
    // Tickets have no date; skip — they'll appear in the PDF.
    void t;
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export async function exportTripsIcs(trips: TripLite[]): Promise<void> {
  const ics = await buildTripsIcs(trips);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trips-${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
