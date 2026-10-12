import "server-only";
// Google Places API (New): address autocomplete and the chosen place's details, called only from our server
// (/api/places/*) with the server-only GOOGLE_MAPS_API_KEY. The key never reaches the browser, and errors from
// Google are reduced to a status so its messages (which can echo the request) never reach the client either.
// Billing: the browser keeps one session token from the first keystroke to the chosen place, so the autocomplete
// requests and the one details request are charged as a single session. Details ask only for Essentials fields.
import { isBuildingResult, PLACE_ID } from "@/lib/business-info/locations";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places/";
const TIMEOUT_MS = 5000;

export const SESSION_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/** `main` is the place or building name ("M Peace Plaza"), `secondary` the rest ("KN 4 Avenue, Kigali, Rwanda").
 * `building` is true for an establishment or premise: its name is then the building name. */
export type PlaceSuggestion = { placeId: string; main: string; secondary: string; text: string; building: boolean };
export type PlaceDetails = { placeId: string; address: string; lat?: number; lng?: number };

export class PlacesError extends Error {
  constructor(public status: number) {
    super(`Places request failed (${status})`);
  }
}

export function placesKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new PlacesError(res.status);
  return res.json();
}

type AutocompleteResponse = {
  suggestions?: { placePrediction?: { placeId?: string; types?: string[]; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[];
};

/**
 * Suggestions for what was typed: buildings, malls and businesses as well as street addresses (no type filter), kept
 * to the business's country (includedRegionCodes) and ranked for it (regionCode, e.g. "rw").
 */
export async function autocomplete(key: string, input: { q: string; sessionToken: string; regionCode?: string | null; languageCode?: string }): Promise<PlaceSuggestion[]> {
  const body: Record<string, unknown> = { input: input.q, sessionToken: input.sessionToken, languageCode: input.languageCode ?? "en" };
  if (input.regionCode) {
    body.regionCode = input.regionCode;
    body.includedRegionCodes = [input.regionCode];
  }
  const data = (await call(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.types,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify(body),
  })) as AutocompleteResponse;
  return (data.suggestions ?? []).flatMap((s) => {
    const p = s.placePrediction;
    if (!p?.placeId || !PLACE_ID.test(p.placeId)) return [];
    const text = (p.text?.text ?? "").slice(0, 300);
    const main = (p.structuredFormat?.mainText?.text ?? text).slice(0, 200);
    return [{ placeId: p.placeId, main, secondary: (p.structuredFormat?.secondaryText?.text ?? "").slice(0, 200), text, building: isBuildingResult(p.types) }];
  }).slice(0, 5);
}

type DetailsResponse = { id?: string; formattedAddress?: string; location?: { latitude?: number; longitude?: number } };

/** The formatted address and coordinates of a place (Place Details Essentials fields only). Ends the session. */
export async function placeDetails(key: string, input: { placeId: string; sessionToken?: string; regionCode?: string | null; languageCode?: string }): Promise<PlaceDetails> {
  const params = new URLSearchParams({ languageCode: input.languageCode ?? "en" });
  if (input.sessionToken) params.set("sessionToken", input.sessionToken);
  if (input.regionCode) params.set("regionCode", input.regionCode);
  const data = (await call(`${DETAILS_URL}${encodeURIComponent(input.placeId)}?${params}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,formattedAddress,location" },
  })) as DetailsResponse;
  const lat = data.location?.latitude;
  const lng = data.location?.longitude;
  return {
    placeId: data.id && PLACE_ID.test(data.id) ? data.id : input.placeId,
    address: (data.formattedAddress ?? "").slice(0, 300),
    ...(typeof lat === "number" && typeof lng === "number" ? { lat, lng } : {}),
  };
}

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

type GeocodeResponse = { status?: string; results?: { address_components?: { short_name?: string; types?: string[] }[] }[] };

/**
 * The ISO country code of a point, or null when Google has none (open sea). Server-side only: the key stays here and
 * only the two-letter code leaves. Coordinates are sent to Google for this one lookup and never stored by us.
 */
export async function reverseGeocodeCountry(key: string, lat: number, lng: number): Promise<string | null> {
  const params = new URLSearchParams({ latlng: `${lat},${lng}`, result_type: "country", key });
  const data = (await call(`${GEOCODE_URL}?${params}`, {})) as GeocodeResponse;
  if (data.status === "ZERO_RESULTS") return null;
  if (data.status !== "OK") throw new PlacesError(502);
  const code = data.results?.[0]?.address_components?.find((c) => c.types?.includes("country"))?.short_name?.toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}
