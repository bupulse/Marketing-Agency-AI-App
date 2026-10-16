import { currentPlatform, type Platform } from "./detect";

// The visitor's country and IP address from the headers the host sets. Each host only trusts its own headers:
// anyone can send `cf-ipcountry` or `x-nf-geo` to a host that does not overwrite them, so on Netlify the cf-* headers
// are ignored and on Cloudflare the x-nf-* ones are. Neither host ever falls back to headers a visitor can choose
// (x-forwarded-for, x-country). "node" (next dev, next start, tests) reads the Cloudflare headers and, for local
// runs, the first x-forwarded-for hop, as it always did.

const COUNTRY = /^[A-Z]{2}$/;

/** A two-letter ISO country code, or null for missing, unknown (XX) and Tor (T1). */
export function cleanCountry(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return COUNTRY.test(code) && code !== "XX" && code !== "T1" ? code : null;
}

/**
 * Netlify's `x-nf-geo` header: base64 of JSON like {"city":"Kigali","country":{"code":"RW","name":"Rwanda"},...}.
 * Some deployments send the JSON itself; both are accepted. Returns the country code, or null when it is missing or
 * cannot be read.
 */
export function countryFromNetlifyGeo(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw || raw.length > 4096) return null;
  const parse = (text: string) => {
    try {
      const geo = JSON.parse(text) as { country?: { code?: unknown } | null } | null;
      return typeof geo?.country?.code === "string" ? cleanCountry(geo.country.code) : null;
    } catch {
      return null;
    }
  };
  if (raw.startsWith("{")) return parse(raw);
  try {
    return parse(new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/**
 * The visitor's country as the host saw it (Cloudflare: cf-ipcountry; Netlify: x-nf-geo only), or null, which means
 * the catch-all region. x-country is not read: a visitor can send it, and only x-nf-geo is what Netlify itself set.
 */
export function visitorCountry(h: Headers, platform: Platform = currentPlatform()): string | null {
  if (platform === "netlify") return countryFromNetlifyGeo(h.get("x-nf-geo"));
  return cleanCountry(h.get("cf-ipcountry"));
}

const firstForwarded = (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

/**
 * The address the host itself saw the visitor connect from, and nothing a visitor can choose: Cloudflare's
 * cf-connecting-ip, Netlify's x-nf-client-connection-ip. Null when absent. Use this for allow-lists.
 */
export function trustedClientIp(h: Headers, platform: Platform = currentPlatform()): string | null {
  const header = platform === "netlify" ? "x-nf-client-connection-ip" : "cf-connecting-ip";
  return h.get(header)?.trim() || null;
}

/**
 * The caller's address for rate limits and logs: the host's own header (trustedClientIp). Only plain Node (local dev,
 * tests) falls back to the first x-forwarded-for hop; on Cloudflare and Netlify a missing header gives null, and the
 * callers then use one shared "unknown" rate-limit bucket rather than a key the caller picked.
 */
export function clientIp(h: Headers, platform: Platform = currentPlatform()): string | null {
  return trustedClientIp(h, platform) ?? (platform === "node" ? firstForwarded(h) : null);
}
