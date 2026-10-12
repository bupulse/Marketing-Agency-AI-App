// Where the business is: a head office and any branches. An address can come from the Google Places search
// (with its place id and coordinates) or be typed by hand. Pure: the form, the server action and the chat share it.

export type LocationKind = "head" | "branch";

export type Location = {
  kind: LocationKind;
  /** "Head office", "Kimironko branch". */
  label?: string;
  address: string;
  /** Google place id, when the address was picked from the search. */
  placeId?: string;
  lat?: number;
  lng?: number;
  /** Built from the address and place id (mapsUrl()), never taken from the browser. */
  mapsUrl?: string;
};

export const MAX_BRANCHES = 9;
export const HEAD_OFFICE_LABEL = "Head office";

/** Place ids are opaque base64url-like strings. */
export const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

/**
 * A Google Maps link that opens the place (or searches the address when there is no place id). Uses the public
 * Maps URLs format, so it needs no key and loads nothing on our pages.
 */
export function mapsUrl(loc: Pick<Location, "address" | "placeId" | "lat" | "lng">): string {
  const params = new URLSearchParams({ api: "1" });
  const query = loc.address.trim() || (loc.lat !== undefined && loc.lng !== undefined ? `${loc.lat},${loc.lng}` : "");
  params.set("query", query);
  if (loc.placeId && PLACE_ID.test(loc.placeId)) params.set("query_place_id", loc.placeId);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/** "Head office: KG 7 Ave, Kigali (map: https://...)" lines for the chat. */
export function summarizeLocations(locations: readonly Location[]): string[] {
  return locations.map((l) => {
    const label = l.label?.trim() || (l.kind === "head" ? HEAD_OFFICE_LABEL : "Branch");
    return `${label.slice(0, 80)}: ${l.address.slice(0, 160)} (map: ${l.mapsUrl ?? mapsUrl(l)})`;
  });
}
