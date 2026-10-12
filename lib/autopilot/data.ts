// Database reads for planning: everything buildWeekPlan needs, scoped to one business.
import "server-only";
import { prisma } from "@/lib/db";
import { readKnowledge } from "@/lib/brand/schemas";
import { accountUsable } from "@/lib/publishing/service";
import { isNetwork } from "@/lib/social/registry";
import { holidaysBetween } from "./calendar";
import { buildProfile, type PostResult } from "./learning";
import { industryTags } from "./playbook";
import type { PlanInput, PlanProject } from "./planner";
import { readConfig } from "./settings";
import { localDateISO, safeZone, weekDates } from "./timezone";
import { campaignContext, productContext } from "@/lib/knowledge/context";
import { legacyTypeOf } from "@/lib/knowledge/legacy";
import { formatPrice } from "@/lib/knowledge/products";

const CONTEXT_FIELDS = { kind: true, name: true, category: true, summary: true, description: true, priceModel: true, priceAmount: true, currency: true, priceNote: true, usps: true, features: true, targetCustomer: true, details: true } as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const PHOTO_MARK = "photo:";

const ALBUM = { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }], take: 10, select: { asset: { select: { path: true } } } };

export async function loadPostResults(businessId: string): Promise<PostResult[]> {
  const posts = await prisma.post.findMany({
    where: { businessId, status: "PUBLISHED", publishedAt: { not: null }, metrics: { some: {} } },
    orderBy: { publishedAt: "desc" },
    take: 300,
    select: { playbookId: true, network: true, publishedAt: true, metrics: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  return posts.flatMap((p) => {
    const m = p.metrics[0];
    return m && p.publishedAt ? [{ playbookId: p.playbookId, network: p.network, publishedAt: p.publishedAt, views: m.views, reach: m.reach, likes: m.likes, comments: m.comments, saves: m.saves, shares: m.shares }] : [];
  });
}

/** Everything the planner needs for one business and week. Null when the business does not exist. */
export async function loadPlanInput(businessId: string, weekStart: Date, now: Date): Promise<PlanInput | null> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, include: { autopilot: true } });
  if (!business) return null;
  const config = readConfig(business.autopilot);
  const timeZone = safeZone(business.timezone);
  const dates = weekDates(weekStart, timeZone);
  const since = new Date(now.getTime() - 28 * DAY_MS);
  const photoSince = new Date(now.getTime() - 60 * DAY_MS);

  const today = localDateISO(now, timeZone);
  const [connections, products, campaigns, postedByProduct, postedByCampaign, assets, recentDesigns, recentPosts, existing, results] = await Promise.all([
    prisma.connection.findMany({ where: { businessId, kind: "SOCIAL", id: { in: config.connectionIds } }, orderBy: { createdAt: "asc" } }),
    // Active products and campaigns only: drafts and archived ones are not posted about.
    prisma.product.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 30, include: { photos: ALBUM } }),
    prisma.campaign.findMany({
      where: { businessId, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gte: new Date(`${today}T00:00:00.000Z`) } }] },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { photos: ALBUM, products: { take: 5, select: { product: { select: CONTEXT_FIELDS } } } },
    }),
    prisma.post.groupBy({
      by: ["productId"],
      where: { businessId, productId: { not: null }, status: { notIn: ["CANCELLED", "FAILED"] } },
      _count: { _all: true },
      _max: { scheduledAt: true },
    }),
    prisma.post.groupBy({
      by: ["campaignId"],
      where: { businessId, campaignId: { not: null }, status: { notIn: ["CANCELLED", "FAILED"] } },
      _count: { _all: true },
      _max: { scheduledAt: true },
    }),
    prisma.mediaAsset.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, path: true, folderId: true, mimeType: true } }),
    prisma.design.findMany({ where: { businessId, createdAt: { gte: photoSince }, prompt: { startsWith: PHOTO_MARK } }, select: { prompt: true } }),
    prisma.post.findMany({ where: { businessId, createdAt: { gte: photoSince } }, select: { mediaPaths: true, playbookId: true, groupId: true, source: true, createdAt: true } }),
    prisma.post.findMany({
      where: { businessId, connectionId: { not: null }, scheduledAt: { gte: new Date(weekStart.getTime() - DAY_MS), lt: new Date(weekStart.getTime() + 8 * DAY_MS) }, status: { notIn: ["CANCELLED", "FAILED"] } },
      select: { connectionId: true, scheduledAt: true },
    }),
    loadPostResults(businessId),
  ]);

  const posted = new Map<string | null, { _count: { _all: number }; _max: { scheduledAt: Date | null } }>([...postedByProduct.map((g) => [g.productId, g] as const), ...postedByCampaign.map((g) => [g.campaignId, g] as const)]);
  const planProjects: PlanProject[] = [
    ...products.map((p) => ({
      id: p.id,
      subject: "product" as const,
      title: p.name,
      type: legacyTypeOf(p),
      price: formatPrice(p),
      features: [...p.usps, ...p.features].slice(0, 10),
      context: productContext(p),
      photoPaths: p.photos.map((x) => x.asset.path),
      createdAt: p.createdAt,
      postedCount: posted.get(p.id)?._count._all ?? 0,
      lastPostedAt: posted.get(p.id)?._max.scheduledAt ?? null,
    })),
    ...campaigns.map((c) => ({
      id: c.id,
      subject: "campaign" as const,
      title: c.name,
      type: legacyTypeOf(c),
      price: c.priceInfo,
      features: c.highlights,
      context: campaignContext({ ...c, products: c.products.map((x) => x.product) }),
      photoPaths: c.photos.map((x) => x.asset.path),
      createdAt: c.createdAt,
      postedCount: posted.get(c.id)?._count._all ?? 0,
      lastPostedAt: posted.get(c.id)?._max.scheduledAt ?? null,
    })),
  ];

  const uses = new Map<string, number>();
  for (const d of recentDesigns) {
    const path = d.prompt?.slice(PHOTO_MARK.length);
    if (path) uses.set(path, (uses.get(path) ?? 0) + 1);
  }
  for (const p of recentPosts) for (const path of p.mediaPaths) uses.set(path, (uses.get(path) ?? 0) + 1);

  // Ideas used in the last four weeks, counted once per group.
  const recentIdeas = new Map<string, number>();
  const seen = new Set<string>();
  for (const p of recentPosts) {
    if (p.source !== "AUTOPILOT" || !p.playbookId || p.createdAt < since) continue;
    const key = `${p.playbookId}|${p.groupId ?? p.createdAt.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentIdeas.set(p.playbookId, (recentIdeas.get(p.playbookId) ?? 0) + 1);
  }

  const knowledge = readKnowledge(business.knowledge);
  return {
    businessId,
    weekStart,
    timeZone,
    country: business.country,
    industryTags: industryTags(business.industry),
    config,
    connections: connections.flatMap((c) => (isNetwork(c.provider) && accountUsable(c) ? [{ id: c.id, network: c.provider }] : [])),
    projects: planProjects,
    faqs: knowledge.faqs,
    hasHours: !!(knowledge.hours || knowledge.openingHours.length),
    holidays: holidaysBetween(business.country, dates[0], dates[6], { skipReligious: config.skipReligious }),
    photos: assets.map((a) => ({ id: a.id, path: a.path, folderId: a.folderId, mimeType: a.mimeType, recentUses: uses.get(a.path) ?? 0 })),
    existing: existing.flatMap((e) => (e.connectionId && e.scheduledAt ? [{ connectionId: e.connectionId, scheduledAt: e.scheduledAt }] : [])),
    recentIdeas,
    profile: buildProfile(results, timeZone),
    now,
  };
}
