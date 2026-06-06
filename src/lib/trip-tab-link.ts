/**
 * Pure helper that computes the navigation props for a sidebar trip-tab link.
 * Centralized so the routing behaviour can be unit-tested without rendering
 * the full sidebar / router tree.
 */

export type TripTabLinkProps =
  | {
      hasTrip: true;
      to: "/trips/$id";
      params: { id: string };
      search: { tab: string };
      disabled: false;
      title?: undefined;
    }
  | {
      hasTrip: false;
      to: "/trips";
      params?: undefined;
      search?: undefined;
      disabled: true;
      title: string;
    };

export function getTripTabLinkProps(
  tripId: string | undefined | null,
  tabKey: string,
): TripTabLinkProps {
  if (tripId && tripId.length > 0) {
    return {
      hasTrip: true,
      to: "/trips/$id",
      params: { id: tripId },
      search: { tab: tabKey },
      disabled: false,
    };
  }
  return {
    hasTrip: false,
    to: "/trips",
    disabled: true,
    title: "Open a trip to use this",
  };
}
