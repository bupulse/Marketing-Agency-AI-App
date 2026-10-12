import "server-only";
import { headers } from "next/headers";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { visitorCountry } from "@/lib/platform/headers";
import { getPlans } from "@/lib/plan-catalog";
import { getRegions } from "@/lib/region";
import { regionKeyForCountryCode, type RegionInfo } from "@/lib/region-format";
import { getRegionPrices, regionalPlansFor, type RegionalPlan } from "@/lib/region-prices";

// Soft region check (docs/REGIONS.md). A company's prices come from the country it declared at sign-up
// (Business.pricingRegion). When the host's IP country at sign-up or at a payment start (Mobile Money, card checkout)
// belongs to a dearer region, the company is flagged for the admin (Client 360 and the Overview attention list, with
// "Change region"). Nothing is ever blocked: a real customer travelling, or on a VPN, still pays. An unknown IP country
// (no host header, Tor) is never a mismatch, and neither is a cheaper one.

export type MismatchSource = "signup" | "momo" | "card";

export type RegionMismatch = {
  country: string; // the IP country (ISO code)
  ipRegion: string; // the region that country belongs to
  companyRegion: string; // Business.pricingRegion when it was seen
  source: MismatchSource;
  firstSeenAt: string;
  seenAt: string;
  dismissedAt?: string | null;
};

/** Pure: the cheapest monthly price a region offers, in USD cents (the card price of a local-currency plan), or null. */
export function priceLevelUsdCents(plans: RegionalPlan[]): number | null {
  let min: number | null = null;
  for (const p of plans) {
    const usd = p.currency === "USD" ? p.monthlyPriceCents : (p.card?.monthlyUsdCents ?? null);
    if (usd && usd > 0 && (min === null || usd < min)) min = usd;
  }
  return min;
}

/**
 * Pure: the IP country's region when it is dearer than the company's, else null. Dearer = its cheapest plan costs more
 * (in USD). A region without prices cannot be compared and is never a mismatch.
 */
export function dearerRegion(input: { country: string | null; companyRegion: string; regions: RegionInfo[]; level: (regionKey: string) => number | null }): string | null {
  if (!input.country) return null;
  const ipRegion = regionKeyForCountryCode(input.country, input.regions);
  if (ipRegion === input.companyRegion) return null;
  const ip = input.level(ipRegion);
  const own = input.level(input.companyRegion);
  return ip !== null && own !== null && ip > own ? ipRegion : null;
}

/** Reads Business.regionMismatch, or null when missing or malformed. */
export function parseMismatch(value: unknown): RegionMismatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.country !== "string" || typeof v.ipRegion !== "string" || typeof v.companyRegion !== "string" || typeof v.seenAt !== "string") return null;
  const source = v.source === "momo" || v.source === "card" ? v.source : "signup";
  return {
    country: v.country,
    ipRegion: v.ipRegion,
    companyRegion: v.companyRegion,
    source,
    firstSeenAt: typeof v.firstSeenAt === "string" ? v.firstSeenAt : v.seenAt,
    seenAt: v.seenAt,
    dismissedAt: typeof v.dismissedAt === "string" ? v.dismissedAt : null,
  };
}

/**
 * Records a mismatch for the company when the request's IP country maps to a dearer region than its own. Never throws
 * and never blocks: callers go on whatever it returns. `h` defaults to the current request's headers. A mismatch the
 * admin dismissed for the same country and region is not raised again.
 */
export async function noteRegionMismatch(businessId: string, source: MismatchSource, h?: Headers, now = new Date()): Promise<RegionMismatch | null> {
  try {
    if (!businessId) return null;
    const country = visitorCountry(h ?? (await headers()));
    if (!country) return null;
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { pricingRegion: true, regionMismatch: true } });
    if (!business) return null;
    const [regions, plans, prices] = await Promise.all([getRegions(), getPlans(), getRegionPrices()]);
    const levels = new Map<string, number | null>();
    const level = (key: string) => {
      if (!levels.has(key)) {
        const region = regions.find((r) => r.key === key && r.active);
        levels.set(key, region ? priceLevelUsdCents(regionalPlansFor(plans, prices, region)) : null);
      }
      return levels.get(key) ?? null;
    };
    const ipRegion = dearerRegion({ country, companyRegion: business.pricingRegion, regions, level });
    if (!ipRegion) return null;
    const previous = parseMismatch(business.regionMismatch);
    const same = previous && previous.country === country && previous.companyRegion === business.pricingRegion;
    if (same && previous.dismissedAt) return null;
    const flag: RegionMismatch = {
      country,
      ipRegion,
      companyRegion: business.pricingRegion,
      source,
      firstSeenAt: same ? previous.firstSeenAt : now.toISOString(),
      seenAt: now.toISOString(),
      dismissedAt: null,
    };
    await prisma.business.update({ where: { id: businessId }, data: { regionMismatch: flag as unknown as Prisma.InputJsonValue, regionMismatchAt: now } });
    return flag;
  } catch (error) {
    await logError(error, { source: "region.check", level: "warn", businessId }).catch(() => {});
    return null;
  }
}

/** Companies with an open mismatch, newest first (the Overview attention list). */
export async function openRegionMismatches(take = 20) {
  const rows = await prisma.business.findMany({
    where: { regionMismatchAt: { not: null } },
    orderBy: { regionMismatchAt: "desc" },
    take,
    select: { id: true, name: true, pricingRegion: true, regionMismatch: true },
  });
  return rows.flatMap((r) => {
    const flag = parseMismatch(r.regionMismatch);
    return flag ? [{ businessId: r.id, name: r.name, pricingRegion: r.pricingRegion, flag }] : [];
  });
}

/** Clears the flag of a region change: the region now matches what the admin decided. */
export const CLEARED_MISMATCH = { regionMismatch: Prisma.DbNull, regionMismatchAt: null };
