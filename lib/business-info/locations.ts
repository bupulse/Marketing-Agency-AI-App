// Where the business is: a head office and any branches. An address comes from the Google Places search (with its
// place id and coordinates) or is entered by hand (street, area, city). Either can be inside a building or mall
// (building name, floor, block, shop number). Pure: the form, the server action and the chat share it.
import { countries } from "@/lib/content/countries";

export type LocationKind = "head" | "branch";

/** "Inside a building or mall": the name is required, the rest optional. */
export type Building = { name: string; floor?: string; block?: string; unit?: string };
/** A hand-entered address ("Can't find it? Enter it yourself"). Never has a place id or coordinates. */
export type ManualAddress = { street?: string; area?: string; city?: string };

export type Location = {
  kind: LocationKind;
  /** "Head office", "Kimironko branch". */
  label?: string;
  /** The full address: Google's formatted address, or the manual parts joined ("KN 4 Ave, Kiyovu, Kigali"). */
  address: string;
  /** Google place id, when the address was picked from the search. */
  placeId?: string;
  lat?: number;
  lng?: number;
  building?: Building;
  manual?: ManualAddress;
  /** Built from the text and place id (mapsUrl()), never taken from the browser. */
  mapsUrl?: string;
};

export const MAX_BRANCHES = 9;
export const HEAD_OFFICE_LABEL = "Head office";

/** Lengths of the building and manual address fields (the form's maxLength and the server's check). */
export const LOCATION_LIMITS = { buildingName: 120, floor: 40, block: 40, unit: 40, street: 160, area: 80, city: 80 } as const;

/** Place ids are opaque base64url-like strings. */
export const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

/** Google place types that are a building or a business inside one: their name is the building name. */
const BUILDING_TYPES = new Set([
  "establishment",
  "premise",
  "subpremise",
  "point_of_interest",
  "shopping_mall",
  "store",
  "office",
  "corporate_office",
  "lodging",
  "hotel",
  "hospital",
  "school",
  "university",
  "restaurant",
  "cafe",
  "bank",
  "market",
]);

export function isBuildingResult(types: readonly string[] | undefined): boolean {
  return !!types?.some((t) => BUILDING_TYPES.has(t));
}

const clean = (v: string | undefined) => v?.replace(/\s+/g, " ").trim() || undefined;

/** "KN 4 Ave, Kiyovu, Kigali". */
export function manualAddressText(m: ManualAddress): string {
  return [m.street, m.area, m.city].map(clean).filter(Boolean).join(", ");
}

// ---- floors, blocks and shop numbers ----

/** "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export const MAX_FLOOR = 60;

/** The floor dropdown, bottom to top. `value` is what is stored ("B2", "G", "8", "R"). */
export const FLOORS: { value: string; label: string }[] = [
  { value: "B2", label: "Basement 2" },
  { value: "B1", label: "Basement 1" },
  { value: "G", label: "Ground floor" },
  { value: "M", label: "Mezzanine" },
  ...Array.from({ length: MAX_FLOOR }, (_, i) => ({ value: String(i + 1), label: `${ordinal(i + 1)} floor` })),
  { value: "R", label: "Rooftop" },
];
const FLOOR_LABELS = new Map(FLOORS.map((f) => [f.value, f.label]));

export function isFloorValue(value: string): boolean {
  return FLOOR_LABELS.has(value);
}

/** "8th floor" for "8"; a floor saved as free text before the dropdown is shown as typed. */
export function floorLabel(value: string | undefined): string {
  const v = clean(value);
  return v ? (FLOOR_LABELS.get(v) ?? v) : "";
}

/**
 * The dropdown value of a floor typed as text before the dropdown existed: "8", "8th", "8th floor", "floor 8",
 * "ground", "GF", "basement 1", "B1", "mezzanine", "rooftop". Null when it can't be read (it is then kept as typed).
 */
export function parseFloor(text: string | undefined): string | null {
  const t = clean(text)?.toLowerCase().replace(/\./g, "");
  if (!t) return null;
  if (isFloorValue(t.toUpperCase())) return t.toUpperCase();
  if (/^(g|gf|ground( floor)?|ground level|rez-de-chauss[ée]e)$/.test(t)) return "G";
  if (/^(m|mezz|mezzanine)( floor)?$/.test(t)) return "M";
  if (/^(r|roof|rooftop|roof top)( floor| terrace)?$/.test(t)) return "R";
  const basement = /^(?:b|basement|lower ground|lg)\s*(\d)?$/.exec(t) ?? /^(\d)(?:st|nd|rd|th)? basement$/.exec(t);
  if (basement) return basement[1] === "2" ? "B2" : basement[1] === undefined || basement[1] === "1" ? "B1" : null;
  const n = /^(?:floor|level|fl)?\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:floor|fl|level))?$/.exec(t);
  if (n) {
    const num = Number(n[1]);
    if (num === 0) return "G";
    if (num >= 1 && num <= MAX_FLOOR) return String(num);
  }
  return null;
}

/** "B" -> "Block B"; "Block B" or "East wing" stay as typed. */
export function blockLabel(text: string | undefined): string {
  const t = clean(text);
  if (!t) return "";
  return /^[A-Za-z0-9]{1,3}$/.test(t) ? `Block ${t.toUpperCase()}` : t;
}

/** "M Peace Plaza, 8th floor, Block B, Shop 12". The shop or office number is shown exactly as typed. */
export function buildingText(b: Building | undefined): string {
  if (!b) return "";
  return [clean(b.name), floorLabel(b.floor), blockLabel(b.block), clean(b.unit)].filter(Boolean).join(", ");
}

/** The address without a trailing country ("KN 4 Avenue, Kigali, Rwanda" -> "KN 4 Avenue, Kigali"). */
export function shortAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && (countries as readonly string[]).includes(parts[parts.length - 1])) parts.pop();
  return parts.join(", ");
}

/** The address with a leading building name removed (Google's address for a building often starts with it). */
function withoutName(address: string, name: string | undefined): string {
  const n = clean(name);
  if (!n || !address.toLowerCase().startsWith(n.toLowerCase())) return address;
  return address.slice(n.length).replace(/^[\s,]+/, "");
}

/** "M Peace Plaza, 3rd floor, Block B, Shop 12 — KN 4 Avenue, Kigali", or just the address. */
export function locationText(l: Pick<Location, "address" | "building">): string {
  const address = shortAddress(l.address);
  const building = buildingText(l.building);
  if (!building) return address;
  const rest = withoutName(address, l.building?.name);
  return rest ? `${building} — ${rest}` : building;
}

/**
 * A Google Maps link that opens the place, or searches the text when there is no place id (a hand-entered address:
 * "M Peace Plaza, KN 4 Ave, Kiyovu, Kigali"). The public Maps URLs format needs no key and loads nothing on our pages.
 */
export function mapsUrl(loc: Pick<Location, "address" | "placeId" | "lat" | "lng" | "building">): string {
  const params = new URLSearchParams({ api: "1" });
  const placeId = loc.placeId && PLACE_ID.test(loc.placeId) ? loc.placeId : undefined;
  const address = loc.address.trim();
  const name = clean(loc.building?.name);
  const text = !placeId && name ? [name, withoutName(address, name)].filter(Boolean).join(", ") : address;
  params.set("query", text || (loc.lat !== undefined && loc.lng !== undefined ? `${loc.lat},${loc.lng}` : ""));
  if (placeId) params.set("query_place_id", placeId);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/** "Head office: M Peace Plaza, 3rd floor — KN 4 Avenue, Kigali (map: https://...)" lines for the chat. */
export function summarizeLocations(locations: readonly Location[]): string[] {
  return locations.map((l) => {
    const label = l.label?.trim() || (l.kind === "head" ? HEAD_OFFICE_LABEL : "Branch");
    return `${label.slice(0, 80)}: ${locationText(l).slice(0, 220)} (map: ${l.mapsUrl ?? mapsUrl(l)})`;
  });
}
