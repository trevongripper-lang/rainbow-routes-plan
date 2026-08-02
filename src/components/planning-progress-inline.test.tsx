import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningProgressInline } from "@/components/planning-progress";
import {
  computePlanningItems,
  computeWeightedScore,
  pendingPlanningItems,
  nextBestAction,
  type PlanningInput,
} from "@/lib/planning-progress";

const PARTIAL: PlanningInput = {
  startDate: "2026-07-01",
  endDate: "2026-07-08",
  datesLocked: false,
  memberCount: 4,
  confirmedCount: 2,
  headcount: 4,
  staysCount: 1,
  stayNotNeeded: false,
  travelHandledCount: 2,
  myNetCents: 0,
  settlementsCount: 0,
  noSharedCosts: false,
  hasSharedCosts: false,
};

function inline(input: PlanningInput, extra: Record<string, unknown> = {}) {
  const items = computePlanningItems(input);
  const { earned, total, pct } = computeWeightedScore(items);
  return (
    <PlanningProgressInline
      isLoading={false}
      items={items}
      earned={earned}
      total={total}
      pct={pct}
      remaining={pendingPlanningItems(items)}
      next={nextBestAction(items)}
      {...extra}
    />
  );
}

describe("PlanningProgressInline", () => {
  beforeEach(() => cleanup());

  it("renders a labelled progressbar with the computed percentage", () => {
    render(inline(PARTIAL));
    const bar = screen.getByRole("progressbar", { name: /planning progress/i });
    const { pct } = computeWeightedScore(computePlanningItems(PARTIAL));
    expect(bar).toHaveAttribute("aria-valuetext", `${pct} percent complete`);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(`${pct}%`);
  });

  it("renders all six status chips with text, not colour alone", () => {
    render(inline(PARTIAL));
    const chips = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(chips).toHaveLength(6);
    const text = chips.map((c) => c.textContent ?? "").join(" ");
    for (const label of ["Destination", "Dates", "Travelers", "Stay", "Travel", "Money"]) {
      expect(text).toContain(label);
    }
    // Status is announced as words for screen readers.
    expect(text).toMatch(/complete/);
    expect(text).toMatch(/not started|in progress/);
  });

  it("exposes existing quick actions on pending items only", async () => {
    const user = userEvent.setup();
    const onLock = vi.fn();
    render(
      inline(PARTIAL, {
        actions: { dates: onLock, destination: () => {} },
        actionLabels: { dates: "Lock dates", destination: "Should not render" },
      }),
    );
    expect(screen.queryByRole("button", { name: "Should not render" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lock dates" }));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("shows a busy skeleton while loading", () => {
    render(
      <PlanningProgressInline
        isLoading
        items={[]}
        earned={0}
        total={0}
        pct={0}
        remaining={[]}
        next={null}
      />,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
