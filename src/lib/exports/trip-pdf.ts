import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 48;
const LINE = 14;

type Ctx = {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
};

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensureSpace(ctx: Ctx, need: number) {
  if (ctx.y - need < MARGIN) newPage(ctx);
}

function clean(s: string): string {
  // pdf-lib StandardFont (WinAnsi) can't encode emoji etc.
  return s.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = trial;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawText(
  ctx: Ctx,
  text: string,
  opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number } = {},
) {
  const size = opts.size ?? 11;
  const font = opts.bold ? ctx.bold : ctx.font;
  const color = opts.color ?? [0.12, 0.13, 0.18];
  const x = MARGIN + (opts.indent ?? 0);
  const lines = wrap(text, font, size, PAGE_W - MARGIN * 2 - (opts.indent ?? 0));
  for (const line of lines) {
    ensureSpace(ctx, size + 2);
    ctx.page.drawText(line, { x, y: ctx.y - size, size, font, color: rgb(...color) });
    ctx.y -= size + 4;
  }
}

function gap(ctx: Ctx, h = 8) {
  ctx.y -= h;
}

function hr(ctx: Ctx) {
  ensureSpace(ctx, 8);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y - 2 },
    end: { x: PAGE_W - MARGIN, y: ctx.y - 2 },
    thickness: 0.5,
    color: rgb(0.8, 0.82, 0.88),
  });
  ctx.y -= 10;
}

function fmtDateRange(start: string | null, end: string | null): string {
  if (!start) return "Dates TBD";
  const s = new Date(start + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (!end || end === start) return s;
  const e = new Date(end + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${s} → ${e}`;
}

export async function buildTripsPdf(trips: TripLite[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(trips.length === 1 ? trips[0].title : `Trips (${trips.length})`);
  doc.setProducer("Rainbow Routes");
  doc.setCreator("Rainbow Routes");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, bold, page: null as unknown as PDFPage, y: 0 };
  newPage(ctx);

  const ids = trips.map((t) => t.id);
  const [stays, flights, tickets, costs, members] = await Promise.all([
    supabase.from("trip_stays").select("*").in("destination_id", ids),
    supabase.from("trip_flights").select("*").in("destination_id", ids),
    supabase.from("trip_tickets").select("*").in("destination_id", ids),
    supabase.from("trip_costs").select("*").in("destination_id", ids),
    supabase.from("trip_members").select("destination_id, user_id").in("destination_id", ids),
  ]);

  const memberIds = Array.from(new Set((members.data ?? []).map((m) => m.user_id)));
  const profilesRes = memberIds.length
    ? await supabase.rpc("get_public_profiles", { _ids: memberIds })
    : { data: [] as Array<{ id: string; display_name: string | null }> };
  const nameOf = new Map<string, string>(
    (profilesRes.data ?? []).map((p) => [p.id, p.display_name ?? "Traveler"]),
  );

  trips.forEach((trip, idx) => {
    if (idx > 0) newPage(ctx);
    drawText(ctx, trip.title, { size: 22, bold: true });
    gap(ctx, 2);
    const loc = [trip.city, trip.region, trip.country].filter(Boolean).join(", ");
    if (loc) drawText(ctx, loc, { size: 12, color: [0.4, 0.42, 0.5] });
    drawText(ctx, fmtDateRange(trip.start_date, trip.end_date), {
      size: 11,
      color: [0.4, 0.42, 0.5],
    });
    gap(ctx);
    if (trip.description) {
      drawText(ctx, trip.description, { size: 10 });
      gap(ctx);
    }

    // Members
    const tripMembers = (members.data ?? []).filter((m) => m.destination_id === trip.id);
    if (tripMembers.length) {
      hr(ctx);
      drawText(ctx, "Crew", { size: 14, bold: true });
      drawText(ctx, tripMembers.map((m) => nameOf.get(m.user_id) ?? "Traveler").join(", "), {
        size: 10,
      });
      gap(ctx);
    }

    // Flights
    const tflights = (flights.data ?? []).filter((f) => f.destination_id === trip.id);
    if (tflights.length) {
      hr(ctx);
      drawText(ctx, "Flights", { size: 14, bold: true });
      for (const f of tflights) {
        const route = [f.depart_airport, f.arrive_airport].filter(Boolean).join(" -> ");
        const title = `${f.airline ?? "Flight"} ${f.flight_number ?? ""}`.trim();
        drawText(ctx, `• ${title} ${route ? "(" + route + ")" : ""}`.trim(), {
          size: 10,
          bold: true,
        });
        const meta = [f.flight_date, [f.depart_time, f.arrive_time].filter(Boolean).join(" – ")]
          .filter(Boolean)
          .join(" · ");
        if (meta) drawText(ctx, meta, { size: 9, color: [0.45, 0.47, 0.55], indent: 12 });
        if (f.confirmation)
          drawText(ctx, `Conf #${f.confirmation}`, {
            size: 9,
            color: [0.45, 0.47, 0.55],
            indent: 12,
          });
      }
      gap(ctx);
    }

    // Stays
    const tstays = (stays.data ?? []).filter((s) => s.destination_id === trip.id);
    if (tstays.length) {
      hr(ctx);
      drawText(ctx, "Stays", { size: 14, bold: true });
      for (const s of tstays) {
        drawText(ctx, `• ${s.title}`, { size: 10, bold: true });
        const dates = [s.check_in, s.check_out].filter(Boolean).join(" → ");
        if (dates) drawText(ctx, dates, { size: 9, color: [0.45, 0.47, 0.55], indent: 12 });
        if (s.address) drawText(ctx, s.address, { size: 9, color: [0.45, 0.47, 0.55], indent: 12 });
        if (s.url) drawText(ctx, s.url, { size: 9, color: [0.2, 0.4, 0.8], indent: 12 });
      }
      gap(ctx);
    }

    // Tickets
    const ttickets = (tickets.data ?? []).filter((t) => t.destination_id === trip.id);
    if (ttickets.length) {
      hr(ctx);
      drawText(ctx, "Tickets", { size: 14, bold: true });
      for (const t of ttickets) {
        const price =
          t.price_cents != null ? ` — ${(t.price_cents / 100).toFixed(2)} ${t.currency}` : "";
        drawText(ctx, `• ${t.name}${price}`, { size: 10 });
        if (t.url) drawText(ctx, t.url, { size: 9, color: [0.2, 0.4, 0.8], indent: 12 });
        if (t.notes) drawText(ctx, t.notes, { size: 9, color: [0.45, 0.47, 0.55], indent: 12 });
      }
      gap(ctx);
    }

    // Costs summary
    const tcosts = (costs.data ?? []).filter((c) => c.destination_id === trip.id);
    if (tcosts.length) {
      hr(ctx);
      drawText(ctx, "Costs", { size: 14, bold: true });
      const totals = new Map<string, number>();
      let grand = 0;
      const cur = tcosts[0].currency;
      for (const c of tcosts) {
        totals.set(c.category, (totals.get(c.category) ?? 0) + c.amount_cents);
        grand += c.amount_cents;
      }
      for (const [cat, cents] of totals) {
        drawText(ctx, `• ${cat}: ${(cents / 100).toFixed(2)} ${cur}`, { size: 10 });
      }
      drawText(ctx, `Total: ${(grand / 100).toFixed(2)} ${cur}`, { size: 11, bold: true });
      gap(ctx);
    }
  });

  // Footer on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const txt = `Rainbow Routes  ·  page ${i + 1} of ${pages.length}`;
    p.drawText(txt, {
      x: MARGIN,
      y: 24,
      size: 8,
      font,
      color: rgb(0.55, 0.57, 0.65),
    });
  });

  return doc.save();
}

export async function exportTripsPdf(trips: TripLite[]): Promise<void> {
  const bytes = await buildTripsPdf(trips);
  // Copy into a fresh ArrayBuffer to satisfy Blob's BlobPart typing across TS lib versions.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    trips.length === 1
      ? `${trips[0].title.replace(/[^\w\s-]/g, "").trim() || "trip"}.pdf`
      : `trips-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
