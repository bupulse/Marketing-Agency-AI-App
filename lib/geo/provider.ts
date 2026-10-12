import "server-only";
// The adapter behind "Use my location": GEO_PROVIDER=builtin (default, offline, free) | google (Geocoding API, needs
// GOOGLE_MAPS_API_KEY and billing). Only google can be unavailable (lib/geo-availability.ts).
import { geocodingAvailable } from "@/lib/geo-availability";
import { reverseGeocodeCountry } from "@/lib/places/google";
import { builtinCountryAt } from "./builtin";

export type GeoProvider = "builtin" | "google";

export function geoProvider(): GeoProvider {
  return (process.env.GEO_PROVIDER ?? "").trim().toLowerCase() === "google" ? "google" : "builtin";
}

/** Is "Use my location" usable right now? Always for builtin; for google when a key is set and Google accepts it. */
export async function geoLookupAvailable(): Promise<boolean> {
  return geoProvider() === "builtin" ? true : (await geocodingAvailable()) !== null;
}

/** The ISO country of a point, or null for open sea. The google provider may throw (GeocodeDeniedError, PlacesError). */
export async function lookupCountry(lat: number, lng: number): Promise<string | null> {
  if (geoProvider() === "builtin") return builtinCountryAt(lat, lng);
  const key = await geocodingAvailable();
  return key ? reverseGeocodeCountry(key, lat, lng) : null;
}
