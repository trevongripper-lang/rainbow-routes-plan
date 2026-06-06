import { describe, it, expect } from "vitest";
import { getTripTabLinkProps } from "./trip-tab-link";

const VALID_TRIP_ID = "f5149fff-d349-413c-a36d-2b6d33670b4c";

describe("getTripTabLinkProps", () => {
  describe("with a valid trip id", () => {
    it("routes Costs to the trip detail page with tab=costs", () => {
      const props = getTripTabLinkProps(VALID_TRIP_ID, "costs");
      expect(props).toEqual({
        hasTrip: true,
        to: "/trips/$id",
        params: { id: VALID_TRIP_ID },
        search: { tab: "costs" },
        disabled: false,
      });
    });

    it("routes Travel plans (flights) to the trip detail page with tab=flights", () => {
      const props = getTripTabLinkProps(VALID_TRIP_ID, "flights");
      expect(props).toEqual({
        hasTrip: true,
        to: "/trips/$id",
        params: { id: VALID_TRIP_ID },
        search: { tab: "flights" },
        disabled: false,
      });
    });

    it.each(["overview", "stays", "tickets", "ratings"])(
      "routes %s tab to the trip detail page",
      (tab) => {
        const props = getTripTabLinkProps(VALID_TRIP_ID, tab);
        expect(props.hasTrip).toBe(true);
        if (props.hasTrip) {
          expect(props.to).toBe("/trips/$id");
          expect(props.params.id).toBe(VALID_TRIP_ID);
          expect(props.search.tab).toBe(tab);
        }
      },
    );

    it("works for any uuid-shaped trip id", () => {
      const otherId = "00000000-0000-0000-0000-000000000001";
      const props = getTripTabLinkProps(otherId, "costs");
      expect(props.hasTrip).toBe(true);
      if (props.hasTrip) expect(props.params.id).toBe(otherId);
    });
  });

  describe("with no trip open", () => {
    it.each([undefined, null, ""])(
      "falls back to /trips with a disabled tooltip when tripId is %p",
      (tripId) => {
        const props = getTripTabLinkProps(tripId, "costs");
        expect(props).toEqual({
          hasTrip: false,
          to: "/trips",
          disabled: true,
          title: "Open a trip to use this",
        });
      },
    );

    it("never produces a /trips/$id link without a tripId", () => {
      const props = getTripTabLinkProps(undefined, "flights");
      expect(props.to).toBe("/trips");
      expect(props.hasTrip).toBe(false);
    });
  });
});
