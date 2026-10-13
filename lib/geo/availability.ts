import "server-only";
// Whether "Use my location" can be offered, without the border data: the pricing page asks this, and only the lookup
// route (lib/geo/provider.ts) bundles @rapideditor/country-coder, so the Worker carries it once (docs/DEPLOY.md).
import { geocodingAvailable } from "@/lib/geo-availability";

export type GeoProvider = "builtin" | "google";

export function geoProvider(): GeoProvider {
  return (process.env.GEO_PROVIDER ?? "").trim().toLowerCase() === "google" ? "google" : "builtin";
}

/** Is "Use my location" usable right now? Always for builtin; for google when a key is set and Google accepts it. */
export async function geoLookupAvailable(): Promise<boolean> {
  return geoProvider() === "builtin" ? true : (await geocodingAvailable()) !== null;
}
