import "server-only";
// The adapter behind "Use my location": GEO_PROVIDER=builtin (default, offline, free) | google (Geocoding API, needs
// GOOGLE_MAPS_API_KEY and billing). Only google can be unavailable (lib/geo-availability.ts).
import { geocodingAvailable } from "@/lib/geo-availability";
import { reverseGeocodeCountry } from "@/lib/places/google";
import { builtinCountryAt } from "./builtin";
import { geoProvider } from "./availability";

export { geoLookupAvailable, geoProvider, type GeoProvider } from "./availability";

/** The ISO country of a point, or null for open sea. The google provider may throw (GeocodeDeniedError, PlacesError). */
export async function lookupCountry(lat: number, lng: number): Promise<string | null> {
  if (geoProvider() === "builtin") return builtinCountryAt(lat, lng);
  const key = await geocodingAvailable();
  return key ? reverseGeocodeCountry(key, lat, lng) : null;
}
