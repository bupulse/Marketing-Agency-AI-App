import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { visitorCountry } from "@/lib/platform/headers";
import { GEO_COOKIE, verifyGeoCookie } from "@/lib/geo-cookie";
import {
  DEFAULT_REGION_KEY,
  isPaymentMethod,
  isRegionKey,
  REGION_SEEDS,
  regionKeyForCountryCode,
  regionKeyForCountryName,
  type RegionInfo,
} from "@/lib/region-format";

// Which region a visitor or a company is in. Public pages show the region of where the visitor really is, with no
// switch: the country the visitor's browser reported through "Use my location" (a signed 24 h cookie, lib/geo-cookie.ts),
// else the host's IP country (Cloudflare's cf-ipcountry, Netlify's x-nf-geo), else (outside production) ANALYTICS_DEV_COUNTRY, else the catch-all region. The old
// ?region= / bp-region override only works when REGION_OVERRIDE=1 (local development). Billing never looks at the IP:
// it uses Business.pricingRegion, set from the sign-up country and changeable by an admin. Regions are rows of
// PricingRegion, cached like the plans.

export const REGION_COOKIE = "bp-region";
export const REGION_QUERY = "region";

/** Local development only: honour ?region= and the bp-region cookie on the public pages. Off unless REGION_OVERRIDE=1. */
export function regionOverrideEnabled(): boolean {
  return process.env.REGION_OVERRIDE === "1";
}

const TTL_MS = 30_000;
let lastGood: RegionInfo[] | null = null;
let fetchedAt = 0;

export function clearRegionCache() {
  fetchedAt = 0;
}
/** For tests: forget everything, including the last good copy. */
export function resetRegionCache() {
  fetchedAt = 0;
  lastGood = null;
}

type Row = { key: string; name: string; currency: string; countries: string[]; paymentMethods: string[]; active: boolean; sortOrder: number };

export function regionOf(row: Row): RegionInfo {
  return {
    key: row.key,
    name: row.name,
    currency: row.currency.toUpperCase(),
    countries: (row.countries ?? []).map((c) => c.toUpperCase()),
    paymentMethods: (row.paymentMethods ?? []).filter(isPaymentMethod),
    active: row.active !== false,
    sortOrder: Number(row.sortOrder ?? 0),
  };
}

/** Every region (active or not), in sort order. Cached for 30 s; on a database error the last good copy (or the seeds). */
export async function getRegions(opts: { force?: boolean; now?: number } = {}): Promise<RegionInfo[]> {
  const now = opts.now ?? Date.now();
  if (!opts.force && lastGood && now - fetchedAt < TTL_MS) return lastGood;
  try {
    const rows = (await prisma.pricingRegion.findMany({ orderBy: [{ sortOrder: "asc" }, { key: "asc" }] })) as Row[];
    if (!rows || rows.length === 0) throw new Error("no regions in the database");
    lastGood = rows.map(regionOf).sort((a, b) => a.sortOrder - b.sortOrder);
    fetchedAt = now;
    return lastGood;
  } catch {
    return lastGood ?? REGION_SEEDS.map((r) => ({ ...r, countries: [...r.countries], paymentMethods: [...r.paymentMethods] }));
  }
}

export async function getRegion(key: string): Promise<RegionInfo | null> {
  return (await getRegions()).find((r) => r.key === key) ?? null;
}

/** The region that takes everyone the others do not list (GLOBAL in the seeds). */
export async function fallbackRegion(): Promise<RegionInfo> {
  const regions = await getRegions();
  return regions.find((r) => r.active && r.countries.length === 0) ?? regions.find((r) => r.key === DEFAULT_REGION_KEY) ?? regions[0];
}

export async function regionFromCountryCode(code: string | null | undefined): Promise<string> {
  return regionKeyForCountryCode(code, await getRegions());
}

/** The region of a sign-up country name, for Business.pricingRegion. */
export async function regionFromCountryName(name: string | null | undefined): Promise<string> {
  return regionKeyForCountryName(name, await getRegions());
}

/**
 * The visitor's IP country from the host: Cloudflare's cf-ipcountry, or Netlify's x-nf-geo (lib/platform/headers.ts);
 * null when absent, unknown (XX) or Tor (T1).
 */
export function ipCountryFromHeaders(h: Headers): string | null {
  return visitorCountry(h);
}

/** ANALYTICS_DEV_COUNTRY, outside production only: lets a local run look like a visitor. */
export function devCountry(): string | null {
  const raw = process.env.NODE_ENV !== "production" ? (process.env.ANALYTICS_DEV_COUNTRY ?? "").toUpperCase().slice(0, 2) : "";
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}

/** ISO country code from Cloudflare, with a dev fallback (ANALYTICS_DEV_COUNTRY) so local runs can look like a visitor. Cloudflare always wins. */
export function countryFromHeaders(h: Headers): string | null {
  return ipCountryFromHeaders(h) ?? devCountry();
}

/**
 * Pure: the display region key. Order: the dev override (`query`, then `cookie`; pass them only when REGION_OVERRIDE=1),
 * the verified "Use my location" country (`geo`), the Cloudflare IP country (`ip`), the dev country (`dev`), the catch-all.
 * `geo` beats `ip` on purpose: it exists only because the visitor allowed their browser's location, which is how a
 * VPN user gets their own prices. Unknown or inactive override keys are ignored.
 */
export function resolveDisplayRegionKey(
  input: { query?: string | null; cookie?: string | null; geo?: string | null; ip?: string | null; dev?: string | null },
  regions: RegionInfo[],
): string {
  const active = new Set(regions.filter((r) => r.active).map((r) => r.key));
  for (const asked of [input.query, input.cookie]) {
    const key = (asked ?? "").toUpperCase();
    if (isRegionKey(key) && active.has(key)) return key;
  }
  return regionKeyForCountryCode(input.geo || input.ip || input.dev || null, regions);
}

/** The region a visitor sees on the public pages. */
export async function displayRegion(): Promise<RegionInfo> {
  const [h, c, regions] = await Promise.all([headers(), cookies(), getRegions()]);
  const key = resolveDisplayRegionKey(
    {
      cookie: regionOverrideEnabled() ? c.get(REGION_COOKIE)?.value : null,
      geo: await verifyGeoCookie(c.get(GEO_COOKIE)?.value),
      ip: ipCountryFromHeaders(h),
      dev: devCountry(),
    },
    regions,
  );
  return regions.find((r) => r.key === key) ?? (await fallbackRegion());
}

/** Same, with the page's ?region= value; only for local development (REGION_OVERRIDE=1). */
export async function displayRegionWithOverride(query?: string | string[] | null): Promise<RegionInfo> {
  if (!regionOverrideEnabled()) return displayRegion();
  const [h, c, regions] = await Promise.all([headers(), cookies(), getRegions()]);
  const key = resolveDisplayRegionKey(
    {
      query: Array.isArray(query) ? query[0] : query,
      cookie: c.get(REGION_COOKIE)?.value,
      geo: await verifyGeoCookie(c.get(GEO_COOKIE)?.value),
      ip: ipCountryFromHeaders(h),
      dev: devCountry(),
    },
    regions,
  );
  return regions.find((r) => r.key === key) ?? (await fallbackRegion());
}

/** The company's billing region (Business.pricingRegion). An unknown or retired key falls back to the catch-all region. */
export async function companyRegion(businessId: string): Promise<RegionInfo> {
  const business = businessId ? await prisma.business.findUnique({ where: { id: businessId }, select: { pricingRegion: true } }).catch(() => null) : null;
  return (business?.pricingRegion ? await getRegion(business.pricingRegion) : null) ?? (await fallbackRegion());
}
