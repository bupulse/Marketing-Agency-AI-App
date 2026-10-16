import { cookies } from "next/headers";
import { z } from "zod";
import { logError } from "@/lib/errors";
import { GEO_COOKIE, GEO_MAX_AGE_SECONDS, signGeoCookie } from "@/lib/geo-cookie";
import { markGeocodingUnavailable } from "@/lib/geo-availability";
import { geoLookupAvailable, lookupCountry } from "@/lib/geo/provider";
import { GeocodeDeniedError } from "@/lib/places/google";
import { trustedClientIp } from "@/lib/platform/headers";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";

// "Use my location" on /pricing. POST { lat, lng } from the browser's geolocation. Looks the country up on the server with
// the country provider (lib/geo/provider.ts: built-in offline map by default, Google when GEO_PROVIDER=google), answers
// only the ISO country code, and sets the signed bp-geo cookie. Coordinates are used for this one call and never stored
// or logged. When the provider is unavailable: { enabled: false }.
const body = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });

const HEADERS = { "Cache-Control": "private, no-store" };
const reply = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, { status, headers: { ...HEADERS, ...extra } });

export async function POST(request: Request) {
  if (!(await geoLookupAvailable())) return reply({ enabled: false });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "Bad request" }, 400);

  const ip = (trustedClientIp(request.headers) ?? "").slice(0, 64) || "unknown";
  try {
    await rateLimit(`geo:country:${ip}`, RATE_LIMITS.geoCountry);
  } catch (error) {
    if (error instanceof RateLimitError) return reply({ error: "Too many tries. Please try again later." }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    throw error;
  }

  let country: string | null;
  try {
    country = await lookupCountry(parsed.data.lat, parsed.data.lng);
  } catch (error) {
    if (error instanceof GeocodeDeniedError) {
      await markGeocodingUnavailable(error.googleStatus);
      return reply({ enabled: false });
    }
    await logError(new Error("Geocoding failed"), { source: "geo.country" });
    return reply({ error: "We could not work out your country right now." }, 502);
  }
  if (!country) return reply({ error: "We could not work out your country." }, 404);

  const signed = await signGeoCookie(country);
  if (!signed) return reply({ error: "Not available right now." }, 503);
  (await cookies()).set(GEO_COOKIE, signed, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: GEO_MAX_AGE_SECONDS });
  return reply({ enabled: true, country });
}
