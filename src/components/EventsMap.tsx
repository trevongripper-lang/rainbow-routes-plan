import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { format, parseISO } from "date-fns";
import { MapPin } from "lucide-react";
// Bundle Leaflet marker images with the app instead of pulling from unpkg.
// The `?url` suffix tells Vite to emit the file and return its URL.
import iconUrl from "leaflet/dist/images/marker-icon.png?url";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png?url";
import shadowUrl from "leaflet/dist/images/marker-shadow.png?url";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

type EventRow = {
  id: string;
  name: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string | null;
  url: string | null;
  latitude: number | null;
  longitude: number | null;
};

export default function EventsMap({ events }: { events: EventRow[] }) {
  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MarkerClusterGroup
        chunkedLoading
        showCoverageOnHover={false}
        spiderfyOnMaxZoom
        maxClusterRadius={50}
      >
        {events.map((e) => (
          <Marker key={e.id} position={[e.latitude as number, e.longitude as number]}>
            <Popup>
              <div className="space-y-1">
                <div className="font-semibold">{e.name}</div>
                <div className="text-xs text-gray-600">
                  <MapPin className="mr-1 inline size-3" />
                  {e.city}, {e.country}
                </div>
                <div className="text-xs">
                  {format(parseISO(e.start_date), "MMM d, yyyy")}
                  {e.end_date && e.end_date !== e.start_date
                    ? ` – ${format(parseISO(e.end_date), "MMM d, yyyy")}`
                    : ""}
                </div>
                {(() => {
                  const href =
                    e.url && /^https?:\/\//i.test(e.url)
                      ? e.url
                      : `https://www.google.com/search?q=${encodeURIComponent(`${e.name} ${e.city}`)}`;
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs underline"
                    >
                      More info
                    </a>
                  );
                })()}
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
