// Pure helpers for the first-party tracker (/api/collect). No I/O, so they are unit-tested directly.
// Privacy: the raw IP and UA are only ever hashed together with a daily salt (visitorHash); neither is stored.

const BOT_UA =
  /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http|java\/|okhttp|libwww|scrapy|node-fetch|axios|undici|postman|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|skype|vkshare|bingpreview|yahoo|duckduck|baidu|yandex|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|perplexity|ccbot|amazonbot|applebot/i;

/** True for crawlers, link previewers, scripts and automation. `webdriver` is navigator.webdriver from the tracker. */
export function isBot(userAgent: string | null | undefined, opts: { webdriver?: boolean; acceptLanguage?: string | null } = {}): boolean {
  if (!userAgent || userAgent.length < 20) return true;
  if (opts.webdriver) return true;
  if (BOT_UA.test(userAgent)) return true;
  // Real browsers always send Accept-Language; bare scripts rarely do. Only checked when the header is known to be absent.
  if (opts.acceptLanguage === "") return true;
  return false;
}

export type Device = "mobile" | "tablet" | "desktop";

export function deviceFromUserAgent(userAgent: string, screenWidth?: number | null): Device {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(userAgent)) return "mobile";
  // Desktop-mode iPadOS says "Macintosh"; a touch-sized screen gives it away only if the tracker sent one.
  if (screenWidth && screenWidth > 0 && screenWidth < 600) return "mobile";
  return "desktop";
}

const SOURCE_HOSTS: [RegExp, string][] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yahoo\./, "yahoo"],
  [/(^|\.)baidu\.com$/, "baidu"],
  [/(^|\.)yandex\./, "yandex"],
  [/(^|\.)(facebook\.com|fb\.com|l\.facebook\.com|m\.facebook\.com)$/, "facebook"],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, "instagram"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(reddit\.com|redd\.it)$/, "reddit"],
  [/(^|\.)pinterest\./, "pinterest"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, "chatgpt"],
  [/(^|\.)(perplexity\.ai)$/, "perplexity"],
  [/(^|\.)(claude\.ai)$/, "claude"],
  [/(^|\.)producthunt\.com$/, "producthunt"],
];

export type Utm = { source: string | null; medium: string | null; campaign: string | null };

const clean = (value: unknown, max = 100): string | null => {
  if (typeof value !== "string") return null;
  const v = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return v ? v : null;
};

/** utm_* from a query string ("?utm_source=x&..." or "utm_source=x"). Lower-cased, trimmed, capped. */
export function parseUtm(search: string | null | undefined): Utm {
  if (!search) return { source: null, medium: null, campaign: null };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return { source: null, medium: null, campaign: null };
  }
  const get = (k: string) => clean(params.get(k))?.toLowerCase() ?? null;
  return { source: get("utm_source"), medium: get("utm_medium"), campaign: get("utm_campaign") };
}

/** Host of the referrer, or null when absent, invalid, or the site itself. */
export function referrerHost(referrer: string | null | undefined, siteHost: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host) return null;
    if (siteHost && (host === siteHost || host.endsWith(`.${siteHost}`))) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

/** Traffic source label: utm_source wins, then a known referrer host, then the host itself, else "direct". */
export function classifySource(utmSource: string | null, host: string | null): string {
  if (utmSource) return utmSource;
  if (!host) return "direct";
  for (const [re, name] of SOURCE_HOSTS) if (re.test(host)) return name;
  return host;
}

const PRIVATE_PREFIXES = ["/dashboard", "/admin", "/api", "/widget", "/onboarding", "/welcome", "/account", "/auth", "/login", "/signup", "/reset-password", "/forgot-password"];

/** A tidy path (no query/hash, no trailing slash, max 200) or null if it isn't a marketing page we should record. */
export function normalizePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  let path = value.split(/[?#]/)[0].replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return path || "/";
}

/** The session id the tracker keeps in sessionStorage: 8-40 url-safe characters, otherwise ignored. */
export function cleanSessionId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(value) ? value : null;
}

/** "YYYY-MM-DD" in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * SHA-256 over the day's random salt (lib/analytics/salt.ts, deleted after the day) + the UTC day + IP + UA, hex.
 * Yesterday's hashes can't be matched to today's, and once the salt is gone they can't be recomputed from an IP.
 */
export async function visitorHash(ip: string, userAgent: string, now: Date, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}|${utcDay(now)}|${ip}|${userAgent}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(headers: Headers): string {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? "0.0.0.0";
}

/** ISO country code from Cloudflare, with a dev fallback so local runs still show a country. */
export function countryFrom(headers: Headers, cfCountry: string | undefined, dev: boolean): string | null {
  const raw = (headers.get("cf-ipcountry") ?? cfCountry ?? "").toUpperCase();
  if (/^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1") return raw;
  return dev ? (process.env.ANALYTICS_DEV_COUNTRY || "ZZ").toUpperCase().slice(0, 2) : null;
}
