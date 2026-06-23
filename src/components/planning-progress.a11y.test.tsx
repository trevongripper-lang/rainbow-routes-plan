import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningProgressView } from "@/components/planning-progress";
import {
  computePlanningItems,
  computeWeightedScore,
  pendingPlanningItems,
  nextBestAction,
} from "@/lib/planning-progress";

function view(input: Parameters<typeof computePlanningItems>[0]) {
  const items = computePlanningItems(input);
  const remaining = pendingPlanningItems(items);
  const { earned, total, pct } = computeWeightedScore(items);
  return (
    <PlanningProgressView
      isLoading={false}
      items={items}
      earned={earned}
      total={total}
      pct={pct}
      remaining={remaining}
      next={nextBestAction(items)}
    />
  );
}

const FULL = {
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  staysCount: 1,
  flightsBooked: 4,
  memberCount: 4,
  headcount: 4,
  ticketsCount: 2,
  myNetCents: 0,
  settlementsCount: 0,
};

const NEW_TRIP = {
  startDate: null,
  endDate: null,
  staysCount: 0,
  flightsBooked: 0,
  memberCount: 1,
  headcount: 4,
  ticketsCount: 0,
  myNetCents: 0,
  settlementsCount: 0,
};

const PARTIAL = {
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  staysCount: 1,
  flightsBooked: 2,
  memberCount: 4,
  headcount: 4,
  ticketsCount: 1,
  myNetCents: -4200,
  settlementsCount: 0,
};

describe("PlanningProgressView accessibility", () => {
  beforeEach(() => cleanup());

  it("exposes the trigger as a focusable button reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(view(NEW_TRIP));
    const trigger = screen.getByRole("button", { name: /planning progress/i });
    expect(trigger.tagName).toBe("BUTTON");
    await user.tab();
    expect(trigger).toHaveFocus();
  });

  it("announces a summary including percent and pending items", () => {
    render(view(PARTIAL));
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/percent/i);
    expect(label.toLowerCase()).toContain("flights 2 / 4 booked");
    expect(label.toLowerCase()).toContain("balances outstanding");
  });

  it("announces completion when nothing is pending", () => {
    render(view(FULL));
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-label", expect.stringMatching(/complete/i));
  });

  it("exposes the progress as a progressbar with a screen-reader value", () => {
    render(view(FULL));
    const bar = screen.getByRole("progressbar", { name: /planning progress/i });
    expect(bar).toHaveAttribute("aria-valuetext", "100 percent complete");
  });

  it("opens the tooltip on keyboard focus and lists only pending items", async () => {
    const user = userEvent.setup();
    render(view(PARTIAL));
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    const list = within(tooltip).getByRole("list");
    const rows = within(list).getAllByRole("listitem");
    const text = rows.map((r) => r.textContent ?? "").join("|");
    expect(text).toContain("Flights");
    expect(text).toContain("Balances");
    expect(text).not.toContain("Destination");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(view(PARTIAL));
    await user.tab();
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows 'Everything's planned' when complete", async () => {
    const user = userEvent.setup();
    render(view(FULL));
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).queryByRole("list")).not.toBeInTheDocument();
    expect(tooltip.textContent ?? "").toMatch(/everything's planned/i);
  });

  it("surfaces a 'Next best action' line in the tooltip when pending", async () => {
    const user = userEvent.setup();
    render(view(PARTIAL));
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent ?? "").toMatch(/next best action/i);
  });
});
