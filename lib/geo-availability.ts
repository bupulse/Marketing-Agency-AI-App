import "server-only";
// Only for GEO_PROVIDER=google (the built-in provider is always available). Is the Google Geocoding API usable? Until the Google project has billing (or the API enabled), Google answers
// REQUEST_DENIED, and the pricing page should not offer "Use my location" at all. The answer is cached ~10 minutes per
// server instance; a denial is logged once per change, never shown to visitors. Resolves to the API key, or null.
import { logError } from "@/lib/errors";
import { GeocodeDeniedError, placesKey, reverseGeocodeCountry } from "@/lib/places/google";

export const AVAILABILITY_TTL_MS = 10 * 60 * 1000;
// A fixed point (Kigali): the probe never carries a visitor's location.
const PROBE = { lat: -1.9441, lng: 30.0619 };

let cached: { available: boolean; at: number; key: string } | null = null;

export function resetGeocodingAvailability() {
  cached = null;
}

async function remember(available: boolean, key: string, status?: string) {
  const changed = cached?.available !== available;
  cached = { available, at: Date.now(), key };
  if (!available && changed) await logError(new Error(`Geocoding API unavailable (${status ?? "denied"}); "Use my location" is hidden`), { source: "geo.availability" });
}

/** A denial seen while serving a request: hide the feature for the next 10 minutes. */
export async function markGeocodingUnavailable(status: string) {
  const key = placesKey();
  if (key) await remember(false, key, status);
}

/** The Google key when geocoding works (or might: a network error is not a denial and is not cached), else null. */
export async function geocodingAvailable(): Promise<string | null> {
  const key = placesKey();
  if (!key) return null;
  if (cached && cached.key === key && Date.now() - cached.at < AVAILABILITY_TTL_MS) return cached.available ? key : null;
  try {
    await reverseGeocodeCountry(key, PROBE.lat, PROBE.lng);
    await remember(true, key);
    return key;
  } catch (error) {
    if (error instanceof GeocodeDeniedError) {
      await remember(false, key, error.googleStatus);
      return null;
    }
    return key;
  }
}
