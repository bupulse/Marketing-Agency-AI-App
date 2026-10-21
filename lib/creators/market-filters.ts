// The marketplace's rules (docs/CREATOR_MARKETPLACE.md, "The marketplace"): which campaigns are listed, the four
// filters (platform, best pay, business type, open now or starting soon) read from the query string, and the order.
// Pure, so the rules have tests; lib/creators/marketplace.ts reads the database.

import type { PayRules } from "./pay";
import { isCreatorNetwork, type CreatorNetwork } from "./describe";

export type MarketSort = "new" | "pay";
export type MarketWhen = "now" | "soon";
export type MarketFilters = { platform: CreatorNetwork | null; sort: MarketSort; type: string | null; when: MarketWhen | null };

export const NO_FILTERS: MarketFilters = { platform: null, sort: "new", type: null, when: null };
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase() ?? "";

/** The filters from /creators?platform=…&sort=pay&type=<industry slug>&when=now|soon. Anything else is ignored. */
export function readMarketFilters(query: Query): MarketFilters {
  const platform = one(query.platform);
  const type = one(query.type);
  const when = one(query.when);
  return {
    platform: isCreatorNetwork(platform) ? platform : null,
    sort: one(query.sort) === "pay" ? "pay" : "new",
    type: SLUG.test(type) ? type : null,
    when: when === "now" || when === "soon" ? when : null,
  };
}

/** The link of a filtered list (only the filters that are set, so it stays short to share). */
export function marketHref(f: Partial<MarketFilters>): string {
  const q = new URLSearchParams();
  if (f.platform) q.set("platform", f.platform);
  if (f.sort === "pay") q.set("sort", "pay");
  if (f.type) q.set("type", f.type);
  if (f.when) q.set("when", f.when);
  const s = q.toString();
  return s ? `/creators?${s}` : "/creators";
}

export const hasFilters = (f: MarketFilters) => Boolean(f.platform || f.type || f.when || f.sort !== "new");

/** What the listing rule reads of a campaign. Days are "YYYY-MM-DD" in the company's timezone. */
export type ListingFacts = {
  status: string;
  acceptingApplications: boolean;
  listed: boolean;
  hiddenAt: Date | null;
  /** The company's plan still has `creators`. */
  hasFeature: boolean;
  endsOn: string;
  /** Today in the company's timezone. */
  today: string;
};

/**
 * On the marketplace: LIVE, taking applications, listed by the company, not hidden by an admin, the company's plan
 * still has the feature, and its last day has not passed.
 */
export function isListed(c: ListingFacts): boolean {
  return c.status === "LIVE" && c.acceptingApplications && c.listed && c.hiddenAt === null && c.hasFeature && c.endsOn >= c.today;
}

/** Places left in a campaign: the plan's `creatorsPerCampaign` minus the places held (SELECTED, JOINED, open invitations). */
export const placesLeft = (limit: number, picked: number) => Math.max(0, limit - picked);

/** What the filters and the order read of a listed campaign. */
export type MarketItem = { platforms: string[]; payRules: PayRules; industrySlug: string | null; startsOn: string; today: string; placesLeft: number; createdAt: Date };

/** Best pay first: the highest rate per 1,000 views, then the highest fee per post. */
export function byBestPay(a: Pick<MarketItem, "payRules">, b: Pick<MarketItem, "payRules">): number {
  return (b.payRules.ratePerThousand ?? 0) - (a.payRules.ratePerThousand ?? 0) || (b.payRules.feePerPost ?? 0) - (a.payRules.feePerPost ?? 0);
}

/** "Open now" (started) or "Starting soon" (first day still ahead). */
export const whenOf = (i: Pick<MarketItem, "startsOn" | "today">): MarketWhen => (i.startsOn <= i.today ? "now" : "soon");

/**
 * The listed campaigns these filters keep, in their order. "Open now" and "Starting soon" keep only campaigns with
 * places left; without that filter a full campaign stays on the list (marked full), after the others.
 */
export function filterMarket<T extends MarketItem>(items: T[], f: MarketFilters): T[] {
  const kept = items.filter((i) => (!f.platform || i.platforms.includes(f.platform)) && (!f.type || i.industrySlug === f.type) && (!f.when || (whenOf(i) === f.when && i.placesLeft > 0)));
  const order = (a: T, b: T) => (f.sort === "pay" ? byBestPay(a, b) : 0) || b.createdAt.getTime() - a.createdAt.getTime();
  return kept.sort((a, b) => Number(a.placesLeft === 0) - Number(b.placesLeft === 0) || order(a, b));
}
