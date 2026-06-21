import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningProgressView } from "@/components/planning-progress";
import { computePlanningItems, pendingPlanningItems } from "@/lib/planning-progress";

function view(input: Parameters<typeof computePlanningItems>[0]) {
  const items = computePlanningItems(input);
  const remaining = pendingPlanningItems(items);
  const doneCount = items.filter((i) => i.status === "done").length;
  const pct = Math.round((doneCount / items.length) * 100);
  return <PlanningProgressView isLoading={false} items={items} doneCount={doneCount} pct={pct} remaining={remaining} />;
}

const FULL = {
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  staysCount: 1,
  flightsBooked: 4,
  memberCount: 4,
  ticketsCount: 2,
  myNetCents: 0,
};

const NEW_TRIP = {
  startDate: null,
  endDate: null,
  staysCount: 0,
  flightsBooked: 0,
  memberCount: 4,
  ticketsCount: 0,
  myNetCents: 0,
};

const PARTIAL = {
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  staysCount: 1,
  flightsBooked: 2,
  memberCount: 4,
  ticketsCount: 1,
  myNetCents: -4200,
};

describe("PlanningProgressView accessibility", () => {
  beforeEach(() => cleanup());

  it("exposes the trigger as a focusable button reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(view(NEW_TRIP));
    const trigger = screen.getByRole("button", { name: /planning progress/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.tagName).toBe("BUTTON");

    await user.tab();
    expect(trigger).toHaveFocus();
  });

  it("announces the summary, completion count, and pending items in the trigger's accessible name", () => {
    render(view(PARTIAL));
    const trigger = screen.getByRole("button");
    const label = trigger.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/4 of 6 done/i);
    expect(label).toMatch(/2 pending/i);
    expect(label.toLowerCase()).toContain("flights 2 / 4 booked");
    expect(label.toLowerCase()).toContain("balances outstanding");
    // items already done are NOT named
    expect(label.toLowerCase()).not.toContain("destination decided");
    expect(label.toLowerCase()).not.toContain("dates set");
  });

  it("announces completion when nothing is pending", () => {
    render(view(FULL));
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-label", expect.stringMatching(/complete, 6 of 6 done/i));
  });

  it("exposes the progress as a progressbar with a screen-reader value", () => {
    render(view(PARTIAL));
    const bar = screen.getByRole("progressbar", { name: /planning progress/i });
    expect(bar).toHaveAttribute("aria-valuetext", expect.stringMatching(/67 percent complete/i));
  });

  it("opens the tooltip on keyboard focus and lists only pending items as a labelled list", async () => {
    const user = userEvent.setup();
    render(view(PARTIAL));
    await user.tab(); // focus the trigger → Radix opens the tooltip on focus

    const tooltip = await screen.findByRole("tooltip");
    const heading = within(tooltip).getByText(/still to do/i);
    const list = within(tooltip).getByRole("list");
    expect(list).toHaveAttribute("aria-labelledby", heading.id);

    const rows = within(tooltip).getAllByRole("listitem");
    const rowText = rows.map((r) => r.textContent ?? "");
    expect(rowText).toHaveLength(2);
    expect(rowText[0]).toContain("Flights");
    expect(rowText[0]).toContain("2 / 4 booked");
    expect(rowText[1]).toContain("Balances");
    expect(rowText[1]).toContain("Outstanding");
    // done items must not leak into the pending list
    const allText = tooltip.textContent ?? "";
    expect(allText).not.toMatch(/Destination/);
    expect(allText).not.toMatch(/Activities/);
  });

  it("opens on pointer hover and lists pending items", async () => {
    const user = userEvent.setup();
    render(view(NEW_TRIP));
    await user.hover(screen.getByRole("button"));
    const tooltip = await screen.findByRole("tooltip");
    const rows = within(tooltip).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Dates"),
        expect.stringContaining("Stay"),
        expect.stringContaining("Flights"),
        expect.stringContaining("Activities"),
      ]),
    );
    expect(rows).toHaveLength(4);
  });

  it("closes on Escape (keyboard escape mechanism)", async () => {
    const user = userEvent.setup();
    render(view(PARTIAL));
    await user.tab();
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not show the pending list when everything is done", async () => {
    const user = userEvent.setup();
    render(view(FULL));
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).queryByRole("list")).not.toBeInTheDocument();
    expect(tooltip.textContent ?? "").toMatch(/everything's planned/i);
  });

  it("decorative icons in the pending list are hidden from screen readers", async () => {
    const user = userEvent.setup();
    const { container } = render(view(PARTIAL));
    await user.tab();
    await screen.findByRole("tooltip");
    const svgs = container.ownerDocument.querySelectorAll("[role='tooltip'] svg");
    expect(svgs.length).toBeGreaterThan(0);
    svgs.forEach((svg) => expect(svg).toHaveAttribute("aria-hidden", "true"));
  });
});
