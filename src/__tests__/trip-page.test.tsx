import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => ({ id: "trip-1" }),
  }),
  Link: ({
    children,
    to,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    [k: string]: unknown;
  }) => React.createElement("a", { href: to, ...rest }, children),
  useNavigate: () => () => {},
  useSearch: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useSuspenseQuery: () => ({
    data: {
      dest: {
        id: "trip-1",
        title: "Test Trip",
        region: "Europe",
        country: "Italy",
        description: "A lovely test trip.",
        image_url: null,
        is_past: false,
        user_id: "owner-1",
        headcount: 3,
        default_currency: "USD",
        start_date: null,
        end_date: null,
      },
      me: "user-1",
      author: { display_name: "Trip Owner" },
      votes: 0,
      voted: false,
      comments: [],
    },
  }),
  useQuery: () => ({ data: {} }),
  useMutation: () => ({ mutate: () => {}, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
  queryOptions: (opts: unknown) => opts,
}));

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  TabsContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/components/page-hero", () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) =>
    React.createElement(
      "nav",
      { "aria-label": "Breadcrumbs" },
      items.map((i) => React.createElement("span", { key: i.label }, i.label)),
    ),
}));

vi.mock("@/components/trip-tabs", () => ({
  StaysTab: () => null,
  TicketsTab: () => null,
  CostsTab: () => null,
}));
vi.mock("@/components/flights-tab", () => ({ FlightsTab: () => null }));
vi.mock("@/components/chatter", () => ({ Chatter: () => null }));
vi.mock("@/components/invite-modal", () => ({ InviteModal: () => null }));
vi.mock("@/components/unlock-trip-button", () => ({ UnlockTripButton: () => null }));
vi.mock("@/components/itinerary-tab", () => ({ ItineraryTab: () => null }));
vi.mock("@/components/trip-events-strip", () => ({ TripEventsStrip: () => null }));
vi.mock("@/components/smart-add", () => ({ SmartAdd: () => null }));
vi.mock("@/components/polls", () => ({ PollsPanel: () => null }));
vi.mock("@/components/attendees-card", () => ({ AttendeesCard: () => null }));
vi.mock("@/components/planning-progress", () => ({
  PlanningProgress: () =>
    React.createElement(
      "button",
      { type: "button", "data-testid": "planning-progress" },
      "Planning progress",
    ),
}));

import { Route } from "@/routes/_authenticated/trips.$id";

describe("Trips page layout", () => {
  it("renders the planning progress bar above the hero heading", () => {
    const Component = (Route as unknown as { component: React.FC }).component;
    render(<Component />);

    const progress = screen.getByTestId("planning-progress");
    const hero = screen.getByRole("heading", { name: /Test Trip/i, level: 1 });

    expect(progress).toBeInTheDocument();
    expect(hero).toBeInTheDocument();

    const following = progress.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(following).toBeTruthy();
  });
});
