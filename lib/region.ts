import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import {
  DEFAULT_REGION_KEY,
  isPaymentMethod,
  isRegionKey,
  REGION_SEEDS,
  regionKeyForCountryCode,
  regionKeyForCountryName,
  type RegionInfo,
} from "@/lib/region-format";

// Which region a visitor or a company is in. Public pages show the region of the visitor's IP country (Cloudflare's
// cf-ipcountry), which a visitor can override with ?region= (kept in a cookie by proxy.ts: the "Not in Rwanda? See
// other prices" switch, and local testing). Billing never looks at the IP: it uses Business.pricingRegion, set from
// the sign-up country and changeable by an admin. Regions are rows of PricingRegion, cached like the plans.

export const REGION_COOKIE = "bp-region";
export const REGION_QUERY = "region";

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

/** ISO country code from Cloudflare, with a dev fallback (ANALYTICS_DEV_COUNTRY) so local runs can look like a visitor. */
export function countryFromHeaders(h: Headers): string | null {
  const raw = (h.get("cf-ipcountry") ?? "").toUpperCase();
  if (/^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1") return raw;
  return process.env.NODE_ENV !== "production" && process.env.ANALYTICS_DEV_COUNTRY ? process.env.ANALYTICS_DEV_COUNTRY.toUpperCase().slice(0, 2) : null;
}

/** Pure: the display region key from a ?region= value, the cookie and the IP country, in that order. Unknown or inactive keys are ignored. */
export function resolveDisplayRegionKey(input: { query?: string | null; cookie?: string | null; country?: string | null }, regions: RegionInfo[]): string {
  const active = new Set(regions.filter((r) => r.active).map((r) => r.key));
  for (const asked of [input.query, input.cookie]) {
    const key = (asked ?? "").toUpperCase();
    if (isRegionKey(key) && active.has(key)) return key;
  }
  return regionKeyForCountryCode(input.country, regions);
}

/** The region a visitor sees on the public pages. `query` is the page's ?region= value, if any. */
export async function displayRegion(query?: string | string[] | null): Promise<RegionInfo> {
  const [h, c, regions] = await Promise.all([headers(), cookies(), getRegions()]);
  const key = resolveDisplayRegionKey({ query: Array.isArray(query) ? query[0] : query, cookie: c.get(REGION_COOKIE)?.value, country: countryFromHeaders(h) }, regions);
  return regions.find((r) => r.key === key) ?? (await fallbackRegion());
}

/** The company's billing region (Business.pricingRegion). An unknown or retired key falls back to the catch-all region. */
export async function companyRegion(businessId: string): Promise<RegionInfo> {
  const business = businessId ? await prisma.business.findUnique({ where: { id: businessId }, select: { pricingRegion: true } }).catch(() => null) : null;
  return (business?.pricingRegion ? await getRegion(business.pricingRegion) : null) ?? (await fallbackRegion());
}
