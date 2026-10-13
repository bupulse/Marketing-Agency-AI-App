// Database reads for planning: everything buildWeekPlan needs, scoped to one business.
import "server-only";
import { byHandNetwork } from "@/lib/content-board/by-hand";
import type { Network } from "@/lib/social/types";
import { prisma } from "@/lib/db";
import { readKnowledge } from "@/lib/brand/schemas";
import { accountUsable } from "@/lib/publishing/service";
import { isNetwork } from "@/lib/social/registry";
import { holidaysBetween } from "./calendar";
import { buildProfile } from "./learning";
import { loadPostResults } from "./results";

export { loadPostResults };
import { industryTags } from "./playbook";
import type { PlanInput, PlanProject } from "./planner";
import { readConfig } from "./settings";
import { localDateISO, safeZone, weekDates } from "./timezone";
import { campaignContext, productContext } from "@/lib/knowledge/context";
import { legacyTypeOf } from "@/lib/knowledge/legacy";
import { formatPrice } from "@/lib/knowledge/products";
import { isVideoPath } from "@/lib/visuals/post-media";

const CONTEXT_FIELDS = { kind: true, name: true, category: true, summary: true, description: true, priceModel: true, priceAmount: true, currency: true, priceNote: true, usps: true, features: true, targetCustomer: true, details: true } as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const PHOTO_MARK = "photo:";

const ALBUM = { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }], take: 10, select: { asset: { select: { path: true } } } };

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
  const [connections, products, campaigns, postedByProduct, postedByCampaign, assets, recentDesigns, recentPosts, existing, results, faqs] = await Promise.all([
    prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } }),
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
    // FAQs live in the Knowledge base now (KnowledgeFaq, in the owner's order).
    prisma.knowledgeFaq.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 50, select: { question: true, answer: true } }),
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
      photoPaths: p.photos.map((x) => x.asset.path).filter((path) => !isVideoPath(path)),
      videoPaths: p.photos.map((x) => x.asset.path).filter(isVideoPath),
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
      photoPaths: c.photos.map((x) => x.asset.path).filter((path) => !isVideoPath(path)),
      videoPaths: c.photos.map((x) => x.asset.path).filter(isVideoPath),
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
    connections: planConnections(connections, config.connectionIds),
    projects: planProjects,
    faqs,
    hasHours: !!(knowledge.hours || knowledge.openingHours.length),
    holidays: holidaysBetween(business.country, dates[0], dates[6], { skipReligious: config.skipReligious }),
    photos: assets.map((a) => ({ id: a.id, path: a.path, folderId: a.folderId, mimeType: a.mimeType, recentUses: uses.get(a.path) ?? 0 })),
    existing: existing.flatMap((e) => (e.connectionId && e.scheduledAt ? [{ connectionId: e.connectionId, scheduledAt: e.scheduledAt }] : [])),
    recentIdeas,
    profile: buildProfile(results, timeZone),
    now,
  };
}

/**
 * The accounts Autopilot writes for: the chosen usable accounts, and for each app chosen while it was not connected
 * ("network:<app>") its account once one is connected (so the posts publish on their own), else the app itself, whose
 * posts become reminders to post yourself (docs/CONTENT.md).
 */
export function planConnections(all: { id: string; provider: string; status: string; postingMode: string }[], chosen: string[]): { id: string; network: Network }[] {
  const usable = all.filter((c) => isNetwork(c.provider) && accountUsable(c));
  const out: { id: string; network: Network }[] = usable.filter((c) => chosen.includes(c.id)).map((c) => ({ id: c.id, network: c.provider as Network }));
  for (const id of chosen) {
    const network = byHandNetwork(id);
    if (!network) continue;
    const account = usable.find((c) => c.provider === network && c.postingMode === "AUTO") ?? usable.find((c) => c.provider === network);
    const entry = account ? { id: account.id, network } : { id, network };
    if (!out.some((o) => o.id === entry.id)) out.push(entry);
  }
  return out;
}
