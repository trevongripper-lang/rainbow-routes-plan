import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningProgressView } from "@/components/planning-progress";
import {
  computePlanningItems,
  computeWeightedScore,
  pendingPlanningItems,
  nextBestAction,
  type PlanningInput,
} from "@/lib/planning-progress";

function view(input: PlanningInput) {
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

const FULL: PlanningInput = {
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  datesLocked: true,
  memberCount: 4,
  confirmedCount: 4,
  headcount: 4,
  staysCount: 1,
  stayNotNeeded: false,
  travelHandledCount: 4,
  myNetCents: 0,
  settlementsCount: 1,
  noSharedCosts: false,
  hasSharedCosts: true,
};

const NEW_TRIP: PlanningInput = {
  startDate: null,
  endDate: null,
  datesLocked: false,
  memberCount: 1,
  confirmedCount: 1,
  headcount: 4,
  staysCount: 0,
  stayNotNeeded: false,
  travelHandledCount: 0,
  myNetCents: 0,
  settlementsCount: 0,
  noSharedCosts: false,
  hasSharedCosts: false,
};

const PARTIAL: PlanningInput = {
  ...NEW_TRIP,
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  datesLocked: false,
  memberCount: 4,
  confirmedCount: 2,
  travelHandledCount: 2,
  staysCount: 1,
};

describe("PlanningProgressView accessibility", () => {
  beforeEach(() => cleanup());

  it("trigger is a focusable button reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(view(NEW_TRIP));
    const trigger = screen.getByRole("button", { name: /planning progress/i });
    expect(trigger.tagName).toBe("BUTTON");
    await user.tab();
    expect(trigger).toHaveFocus();
  });

  it("summary surfaces pending items in aria-label", () => {
    render(view(PARTIAL));
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("dates set");
    expect(label.toLowerCase()).toContain("money not discussed");
  });

  it("announces ready when nothing is pending", () => {
    render(view(FULL));
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", expect.stringMatching(/ready to go/i));
  });

  it("progressbar exposes 100 percent when ready", () => {
    render(view(FULL));
    const bar = screen.getByRole("progressbar", { name: /planning progress/i });
    expect(bar).toHaveAttribute("aria-valuetext", "100 percent complete");
  });

  it("tooltip lists pending items on focus", async () => {
    const user = userEvent.setup();
    render(view(PARTIAL));
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    const text = within(tooltip).getByRole("list").textContent ?? "";
    expect(text).toContain("Dates locked");
    expect(text).toContain("Money handled");
    expect(text).not.toContain("Destination picked");
  });

  it("Money is surfaced as pending on a brand-new trip (fixes false-positive)", async () => {
    const user = userEvent.setup();
    render(view(NEW_TRIP));
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent ?? "").toContain("Money handled");
    expect(tooltip.textContent ?? "").toContain("Not discussed");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(view(PARTIAL));
    await user.tab();
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows 'Ready to go' when complete", async () => {
    const user = userEvent.setup();
    render(view(FULL));
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).queryByRole("list")).not.toBeInTheDocument();
    expect(tooltip.textContent ?? "").toMatch(/ready to go/i);
  });

  it("'Next best action' line appears when pending", async () => {
    const user = userEvent.setup();
    render(view(PARTIAL));
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent ?? "").toMatch(/next best action/i);
  });
});
