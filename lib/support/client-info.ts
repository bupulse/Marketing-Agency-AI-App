import { userAgent } from "next/server";
import { cleanCountry, clientIp } from "@/lib/platform/headers";
import { currentPlatform, type Platform } from "@/lib/platform/detect";

// What POST /visit learns about the visitor from the request, once per visit (heartbeats go straight to Supabase and
// never pass a Netlify function): the address, the host's geo headers, and device, system and browser from the user
// agent. No paid IP database (docs/SUPPORT_CHAT.md section 7). Pure apart from reading the headers.

export type Geo = { country: string | null; city: string | null; region: string | null; timezone: string | null };

const clean = (value: unknown, max = 80) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** Netlify's x-nf-geo (base64 JSON, or the JSON itself): city, country, subdivision and timezone. */
export function geoFromNetlify(value: string | null | undefined): Geo | null {
  const raw = (value ?? "").trim();
  if (!raw || raw.length > 4096) return null;
  let text = raw;
  if (!raw.startsWith("{")) {
    try {
      text = new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
    } catch {
      return null;
    }
  }
  try {
    const geo = JSON.parse(text) as { city?: unknown; country?: { code?: unknown } | null; subdivision?: { name?: unknown } | null; timezone?: unknown } | null;
    if (!geo || typeof geo !== "object") return null;
    return { country: cleanCountry(typeof geo.country?.code === "string" ? geo.country.code : null), city: clean(geo.city), region: clean(geo.subdivision?.name), timezone: clean(geo.timezone, 60) };
  } catch {
    return null;
  }
}

/** Each host trusts only its own headers (lib/platform/headers.ts): Netlify x-nf-geo, otherwise Cloudflare's cf-*. */
export function geoFrom(h: Headers, platform: Platform = currentPlatform()): Geo {
  if (platform === "netlify") return geoFromNetlify(h.get("x-nf-geo")) ?? { country: null, city: null, region: null, timezone: null };
  return { country: cleanCountry(h.get("cf-ipcountry")), city: clean(h.get("cf-ipcity")), region: clean(h.get("cf-region")), timezone: clean(h.get("cf-timezone"), 60) };
}

export type Device = { device: "phone" | "tablet" | "desktop"; os: string | null; browser: string | null; bot: boolean };

/** Phone, tablet or desktop; when the user agent says nothing, a narrow screen counts as a phone. */
export function deviceFrom(h: Headers, screenW?: number): Device {
  const ua = userAgent({ headers: h });
  const type = ua.device.type;
  const device = type === "mobile" ? "phone" : type === "tablet" ? "tablet" : type ? "desktop" : screenW && screenW < 600 ? "phone" : screenW && screenW < 1000 && /Android|iPad/i.test(ua.ua) ? "tablet" : "desktop";
  const os = ua.os.name ? `${ua.os.name}${ua.os.version ? ` ${ua.os.version.split(".")[0]}` : ""}` : null;
  const browser = ua.browser.name ? `${ua.browser.name}${ua.browser.version ? ` ${ua.browser.version.split(".")[0]}` : ""}` : null;
  return { device, os: os?.slice(0, 40) ?? null, browser: browser?.slice(0, 40) ?? null, bot: ua.isBot };
}

/** The referrer's host name only, and none for BuPulse's own pages. */
export function referrerHost(referrer: string | null | undefined, ownHosts: string[]): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || ownHosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

export function requestIp(h: Headers): string | null {
  return clientIp(h)?.slice(0, 64) ?? null;
}
