import "server-only";
import { prisma } from "@/lib/db";
import { hasFeature } from "@/lib/entitlements";
import { campaignLimits } from "./campaigns";
import { creatorPayInWords, formatsInWords, requirementsInWords } from "./describe";
import { logoUrls } from "./logos";
import { filterMarket, isListed, placesLeft, type MarketFilters, type MarketItem } from "./market-filters";
import { readPayRules } from "./pay";
import { holdsPlace } from "./portal-groups";
import { dayIn, ymdOf } from "./periods";
import { NEW_RECORD, paymentRecords, type PaymentRecord } from "./record";
import { readRequirements } from "./requirements";

// The public marketplace, bupulse.com/creators (docs/CREATOR_MARKETPLACE.md): the campaigns the listing rule keeps
// (lib/creators/market-filters.ts), with what a card shows: the company and its logo, the pay in words, the places
// left and the company's payment record.

export type MarketCard = MarketItem & {
  id: string;
  slug: string;
  name: string;
  endsOn: string;
  currency: string;
  pay: string[];
  /** Who it looks for, short ("Kigali · 1,000+ followers · Kinyarwanda"), and what to post (docs/CREATOR_CAMPAIGN_WIZARD.md). */
  wanted: string[];
  formats: string[];
  company: { id: string; name: string; logoUrl: string | null; industry: string | null };
  record: PaymentRecord;
};

const DAY = 86_400_000;

/** Places a campaign has left (plan limit minus SELECTED, JOINED and open invitations). */
export async function placesLeftIn(campaign: { id: string; businessId: string }, now = new Date()): Promise<number> {
  const [{ creatorsPerCampaign }, picked] = await Promise.all([
    campaignLimits(campaign.businessId),
    prisma.campaignCreator.count({ where: { campaignId: campaign.id, ...holdsPlace(now) } }),
  ]);
  return placesLeft(creatorsPerCampaign, picked);
}

/**
 * Every campaign on the marketplace now, newest first. `details` false skips the logos and payment records (the
 * sitemap needs the slugs only).
 */
export async function listedCampaigns(now = new Date(), opts: { details?: boolean } = {}): Promise<MarketCard[]> {
  const details = opts.details !== false;
  const rows = await prisma.creatorCampaign.findMany({
    // A rough cut in the database (a company's day can be up to 14 hours off UTC); the rule itself is isListed().
    where: { status: "LIVE", acceptingApplications: true, listed: true, hiddenAt: null, endsOn: { gte: new Date(now.getTime() - 2 * DAY) } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      acceptingApplications: true,
      listed: true,
      hiddenAt: true,
      startsOn: true,
      endsOn: true,
      platforms: true,
      currency: true,
      payRules: true,
      viewTargetPerCreator: true,
      viewTargetCampaign: true,
      requirements: true,
      formats: true,
      createdAt: true,
      businessId: true,
      business: { select: { name: true, logoUrl: true, timezone: true, industry: true, industryRef: { select: { slug: true, name: true } } } },
      periods: { where: { endsAt: { gt: now } }, orderBy: { index: "asc" }, take: 1, select: { viewTargetPerCreator: true, viewTargetCampaign: true, budget: true } },
      _count: { select: { creators: { where: holdsPlace(now) } } },
    },
  });

  // The plan checks and limits once per company (companies usually run one or two campaigns).
  const companies = [...new Set(rows.map((r) => r.businessId))];
  const [features, limits] = await Promise.all([
    Promise.all(companies.map(async (id) => [id, await hasFeature({ businessId: id }, "creators").catch(() => false)] as const)).then((e) => new Map(e)),
    Promise.all(companies.map(async (id) => [id, (await campaignLimits(id)).creatorsPerCampaign] as const)).then((e) => new Map(e)),
  ]);
  const kept = rows.filter((r) =>
    isListed({ ...r, hasFeature: features.get(r.businessId) ?? false, endsOn: ymdOf(r.endsOn), today: dayIn(now, r.business.timezone || "UTC") }),
  );
  const [logos, records] = details
    ? await Promise.all([logoUrls(kept.map((r) => r.business.logoUrl)), paymentRecords(kept.map((r) => r.businessId), now)])
    : [new Map<string, string>(), new Map<string, PaymentRecord>()];

  return kept.map((r) => {
    const payRules = readPayRules(r.payRules);
    const goals = r.periods[0] ?? { viewTargetPerCreator: r.viewTargetPerCreator, viewTargetCampaign: r.viewTargetCampaign, budget: null };
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      platforms: r.platforms,
      payRules,
      industrySlug: r.business.industryRef?.slug ?? null,
      startsOn: ymdOf(r.startsOn),
      endsOn: ymdOf(r.endsOn),
      today: dayIn(now, r.business.timezone || "UTC"),
      placesLeft: placesLeft(limits.get(r.businessId) ?? 0, r._count.creators),
      createdAt: r.createdAt,
      currency: r.currency,
      pay: creatorPayInWords(payRules, goals, r.currency),
      wanted: requirementsInWords(readRequirements(r.requirements)),
      // Campaigns made before the wizard have no formats.
      formats: formatsInWords(r.formats ?? []),
      company: { id: r.businessId, name: r.business.name, logoUrl: r.business.logoUrl ? (logos.get(r.business.logoUrl) ?? null) : null, industry: r.business.industryRef?.name ?? r.business.industry ?? null },
      record: records.get(r.businessId) ?? NEW_RECORD,
    };
  });
}

/** The marketplace page: the cards the filters keep, and the business types to filter by (those listed now). */
export async function marketplace(filters: MarketFilters, now = new Date()) {
  const all = await listedCampaigns(now);
  const types = new Map<string, string>();
  for (const c of all) if (c.industrySlug && c.company.industry) types.set(c.industrySlug, c.company.industry);
  return {
    cards: filterMarket(all, filters),
    total: all.length,
    types: [...types].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
