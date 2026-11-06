import { CLOUDFLARE_RANGES, GOOGLE_FRONT_END_RANGES, inRanges } from "./cidr";
import { currentPlatform, type Platform } from "./detect";
import { RWANDA_RANGES } from "./rwanda-ranges";

// The visitor's country and IP address from the headers the host sets. Each host only trusts its own headers:
// anyone can send `cf-ipcountry` or `x-nf-geo` to a host that does not overwrite them, so on Netlify the cf-* headers
// are ignored and on Cloudflare the x-nf-* ones are. Neither host ever falls back to headers a visitor can choose
// (x-forwarded-for, x-country). "node" (next dev, next start, tests) reads the Cloudflare headers and, for local
// runs, the first x-forwarded-for hop, as it always did.
// Cloud Run sets no geo or client-address header of its own. Google's front end appends the address that connected to
// it at the END of x-forwarded-for (whatever the caller put before it stays in front), so only the last hop is
// Google's. When that address is one of Cloudflare's, the request came through Cloudflare's proxy, which overwrites
// cf-connecting-ip and cf-ipcountry: those are trusted then, and only then (docs/DEPLOY_CLOUDRUN.md, "Domain").

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
  // A Rwandan provider's own address is Rwanda even when the host's location list says otherwise (some Liquid Telecom
  // Rwanda lines show as Uganda; lib/platform/rwanda-ranges.ts). Only the address the host itself saw is used.
  if (inRanges(trustedClientIp(h, platform), RWANDA_RANGES)) return "RW";
  return hostCountry(h, platform);
}

function hostCountry(h: Headers, platform: Platform): string | null {
  if (platform === "netlify") return countryFromNetlifyGeo(h.get("x-nf-geo"));
  if (platform === "cloudrun" && !viaCloudflare(h, platform)) return null;
  return cleanCountry(h.get("cf-ipcountry"));
}

const firstForwarded = (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

/**
 * Cloud Run: the address that connected to Google's front end, the last x-forwarded-for hop (Google appends it after
 * anything the caller sent). Hops in Google's own front-end ranges are skipped, should a Google load balancer sit in
 * between. Null when there is none.
 */
export function cloudRunPeer(h: Headers): string | null {
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((hop) => hop.trim()).filter(Boolean).slice(-4);
  while (hops.length && inRanges(hops[hops.length - 1], GOOGLE_FRONT_END_RANGES)) hops.pop();
  return hops.pop() || null;
}

/**
 * True when the request reached the app through Cloudflare's proxy, so Cloudflare's cf-* headers can be trusted:
 * always on Cloudflare Workers, never on Netlify, and on Cloud Run when the address that connected to Google is
 * one of Cloudflare's published ranges. Plain Node keeps reading cf-* as it always did.
 */
export function viaCloudflare(h: Headers, platform: Platform = currentPlatform()): boolean {
  if (platform === "netlify") return false;
  if (platform === "cloudrun") return inRanges(cloudRunPeer(h), CLOUDFLARE_RANGES);
  return true;
}

/**
 * The address the host itself saw the visitor connect from, and nothing a visitor can choose: Cloudflare's
 * cf-connecting-ip, Netlify's x-nf-client-connection-ip; on Cloud Run cf-connecting-ip behind Cloudflare's proxy,
 * else the address Google's front end saw (cloudRunPeer). Null when absent. Use this for allow-lists.
 */
export function trustedClientIp(h: Headers, platform: Platform = currentPlatform()): string | null {
  if (platform === "cloudrun" && !viaCloudflare(h, platform)) return cloudRunPeer(h);
  const header = platform === "netlify" ? "x-nf-client-connection-ip" : "cf-connecting-ip";
  return h.get(header)?.trim() || null;
}

/**
 * The caller's address for rate limits and logs: the host's own header (trustedClientIp). Only plain Node (local dev,
 * tests) falls back to the first x-forwarded-for hop; on Cloudflare, Netlify and Cloud Run a missing header gives null, and the
 * callers then use one shared "unknown" rate-limit bucket rather than a key the caller picked.
 */
export function clientIp(h: Headers, platform: Platform = currentPlatform()): string | null {
  return trustedClientIp(h, platform) ?? (platform === "node" ? firstForwarded(h) : null);
}
