// Database reads for the Content page (docs/CONTENT.md). Filtering, counting and paging happen in the database; every
// read is scoped to the business; photos and covers are signed in one batched request per bucket.
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/knowledge/campaigns";
import { KIND_LABEL } from "@/lib/knowledge/products";
import { signPaths } from "@/lib/publishing/media";
import { resultsConnectionSelect, resultsForPosts } from "@/lib/publishing/results-query";
import type { PostStatusName } from "@/lib/publishing/status";
import type { CalendarPost } from "@/lib/publishing/types";
import type { PostFormatName } from "@/lib/publishing/validate";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { NETWORKS, type Network } from "@/lib/social/types";
import { createClient } from "@/lib/supabase/server";
import { readItems } from "@/lib/visuals/service";
import { IDEAS } from "@/lib/autopilot/playbook";
import { contestBlocked, readContest } from "@/lib/content-flow/contest";
import { ANGLES, isAngleId } from "@/lib/studio/angles";
import { scriptLines } from "@/lib/visuals/video-plan";
import { contentWhere, startOfToday, type ContentFilters, type ContentScope } from "./filters";
import { buildSubjectCards, GENERAL_LABEL, GENERAL_NAME, type CountRow, type SubjectCard, type SubjectRow } from "./grouping";
import { isPostKind, type PostKind } from "./kind";

const URL_SECONDS = 2 * 60 * 60;
const VIDEO = /\.(mp4|webm)$/i;

/** A post as the Content page shows it: what the calendar's detail and composer need, plus the card's extras. */
export type ContentPost = CalendarPost & {
  createdAt: string;
  reviewNote: string | null;
  autoScheduledAt: string | null;
  kind: PostKind;
  /** What the card shows: the caption. A video idea's text is its script, so its card shows the content's caption
   * (or the script's spoken lines, without timestamps and scene directions); the script stays in the detail. */
  excerpt: string;
  /** A still for a video post (the content's picture), signed; null when there is none. */
  poster: string | null;
  subject: { kind: "product" | "campaign"; id: string; name: string } | null;
  /** The idea type: the content's angle ("Tip of the day"), or Autopilot's idea. Null for hand-made posts. */
  idea: string | null;
  /** A contest the AI suggested: waits for the owner's prize, end date and winner rule (lib/content-flow/contest.ts). */
  contest: { pending: boolean } | null;
};

export type SubjectCardView = Omit<SubjectCard, "lastActivity"> & { coverUrl: string | null; lastActivity: string | null };

export const postInclude = {
  connection: { select: { displayName: true, avatarUrl: true, ...resultsConnectionSelect } },
  product: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
} satisfies Prisma.PostInclude;
type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

async function sign(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  try {
    return await signPaths(await createClient(), paths, URL_SECONDS);
  } catch {
    // Cards without pictures are better than no page.
    return new Map();
  }
}

/** Pictures of content and Autopilot groups, to show as the still of a video post. */
async function postersFor(businessId: string, rows: PostRow[]): Promise<Map<string, string>> {
  const videoOnly = rows.filter((r) => r.mediaPaths.length > 0 ? r.mediaPaths.every((p) => VIDEO.test(p)) : r.format === "SCRIPT");
  const contentIds = [...new Set(videoOnly.flatMap((r) => (r.contentId ? [r.contentId] : [])))];
  const groupIds = [...new Set(videoOnly.flatMap((r) => (r.groupId ? [r.groupId] : [])))];
  if (contentIds.length === 0 && groupIds.length === 0) return new Map();
  const visuals = await prisma.contentVisual.findMany({
    where: { businessId, status: "ready", kind: { not: "video" }, OR: [...(contentIds.length ? [{ contentId: { in: contentIds } }] : []), ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])] },
    orderBy: { createdAt: "desc" },
    select: { contentId: true, groupId: true, items: true },
    take: 200,
  });
  const out = new Map<string, string>();
  for (const r of videoOnly) {
    const v = visuals.find((x) => (r.contentId && x.contentId === r.contentId) || (r.groupId && x.groupId === r.groupId));
    const path = v ? readItems(v.items)[0]?.path : undefined;
    if (path) out.set(r.id, path);
  }
  return out;
}

/** The idea type of each post: its content's angle (packs, day runs), or Autopilot's playbook idea. */
async function ideasFor(businessId: string, rows: PostRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => (r.contentId ? [r.contentId] : [])))];
  const contents = ids.length ? await prisma.generatedContent.findMany({ where: { businessId, id: { in: ids }, angle: { not: null } }, select: { id: true, angle: true } }) : [];
  const angleOf = new Map(contents.map((c) => [c.id, c.angle]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const angle = r.contentId ? angleOf.get(r.contentId) : null;
    const label = isAngleId(angle) ? ANGLES[angle].label : r.playbookId ? (IDEAS.find((i) => i.id === r.playbookId)?.name ?? null) : null;
    if (label) out.set(r.id, label);
  }
  return out;
}

/** Captions of the content versions video ideas were written from. */
async function captionsFor(businessId: string, rows: PostRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => (r.format === "SCRIPT" && r.contentId ? [r.contentId] : [])))];
  if (ids.length === 0) return new Map();
  const contents = await prisma.generatedContent.findMany({ where: { businessId, id: { in: ids } }, select: { id: true, caption: true } });
  return new Map(contents.map((c) => [c.id, c.caption]));
}

/** The card's text: the caption, never a video script's timestamps and directions. Pure. */
export function cardExcerpt(post: { format: string; title: string | null; text: string }, contentCaption?: string): string {
  if (post.format === "SCRIPT") return contentCaption?.trim() || scriptLines(post.text).join(" ");
  return ((post.title ? `${post.title}. ` : "") + post.text).trim();
}

/** Post rows as cards, with every photo and poster signed in one batch. */
export async function toContentPosts(businessId: string, rows: PostRow[]): Promise<ContentPost[]> {
  const [posters, captions, ideas, results] = await Promise.all([postersFor(businessId, rows), captionsFor(businessId, rows), ideasFor(businessId, rows), resultsForPosts(businessId, rows)]);
  const signed = await sign([...rows.flatMap((r) => r.mediaPaths), ...posters.values()]);
  return rows.map((r) => {
    const network = r.network as Network;
    const poster = posters.get(r.id);
    return {
      id: r.id,
      groupId: r.groupId,
      network,
      connectionId: r.connectionId,
      accountName: r.connection?.displayName ?? (isNetwork(r.network) ? getProvider(r.network).rules.label : r.network),
      accountAvatar: r.connection?.avatarUrl ?? null,
      notify: r.connection?.postingMode === "NOTIFY" || (!r.connection && r.remindOnly),
      status: r.status as PostStatusName,
      format: r.format as PostFormatName | "ARTICLE" | "THREAD",
      source: r.source,
      title: r.title,
      text: r.text,
      hashtags: r.hashtags,
      link: r.link,
      mediaPaths: r.mediaPaths,
      media: r.mediaPaths.flatMap((path) => (signed.has(path) ? [{ path, url: signed.get(path) as string }] : [])),
      scheduledAt: r.scheduledAt?.toISOString() ?? null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      permalink: r.permalink,
      lastError: r.lastError,
      subjectId: r.productId ?? r.campaignId ?? r.projectId,
      contentId: r.contentId,
      createdAt: r.createdAt.toISOString(),
      reviewNote: r.reviewNote,
      autoScheduledAt: r.autoScheduledAt?.toISOString() ?? null,
      remindOnly: !r.connection && r.remindOnly,
      kind: isPostKind(r.mediaKind) ? r.mediaKind : "post",
      excerpt: cardExcerpt(r, r.contentId ? captions.get(r.contentId) : undefined),
      poster: poster ? (signed.get(poster) ?? null) : null,
      subject: r.product ? { kind: "product", id: r.product.id, name: r.product.name } : r.campaign ? { kind: "campaign", id: r.campaign.id, name: r.campaign.name } : null,
      idea: ideas.get(r.id) ?? null,
      contest: readContest(r.contest) ? { pending: contestBlocked(r) } : null,
      ...(results.has(r.id) ? { results: results.get(r.id) } : {}),
    };
  });
}

/** Posts created today (local) that wait for review, plus how many older ones wait. App and type filters apply. */
export async function loadToday(businessId: string, filters: ContentFilters, zone: string, now: Date) {
  const since = startOfToday(zone, now);
  const base: Prisma.PostWhereInput = {
    businessId,
    status: "PENDING_APPROVAL",
    ...(filters.apps.length ? { network: { in: filters.apps } } : {}),
    ...(filters.kinds.length ? { mediaKind: { in: filters.kinds } } : {}),
  };
  const [rows, older] = await Promise.all([
    prisma.post.findMany({ where: { ...base, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 60, include: postInclude }),
    prisma.post.count({ where: { ...base, createdAt: { lt: since } } }),
  ]);
  return { posts: await toContentPosts(businessId, rows), older };
}

/** Posts auto-approval scheduled in the last 24 hours that are still going out or went out: the in-app notice. */
export async function recentAutoCount(businessId: string, now: Date): Promise<number> {
  return prisma.post.count({
    where: { businessId, autoScheduledAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED", "NEEDS_ACTION"] } },
  });
}

/** The grid: one card per product and campaign, plus General, with counts under the filters and signed covers. */
export async function loadSubjectCards(businessId: string, filters: ContentFilters, zone: string, now: Date): Promise<SubjectCardView[]> {
  const photo = { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }], take: 1, select: { asset: { select: { path: true } } } };
  const [products, campaigns, groups] = await Promise.all([
    prisma.product.findMany({ where: { businessId }, orderBy: { updatedAt: "desc" }, take: 500, select: { id: true, name: true, kind: true, status: true, updatedAt: true, photos: photo } }),
    prisma.campaign.findMany({ where: { businessId }, orderBy: { updatedAt: "desc" }, take: 500, select: { id: true, name: true, type: true, status: true, updatedAt: true, photos: photo } }),
    prisma.post.groupBy({
      by: ["productId", "campaignId", "status"],
      where: contentWhere(businessId, filters, { zone, now, ignore: ["statuses", "q"] }),
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);
  const productRows: SubjectRow[] = products.map((p) => ({ id: p.id, name: p.name, label: KIND_LABEL[p.kind], status: p.status, updatedAt: p.updatedAt, coverPath: p.photos[0]?.asset.path ?? null }));
  const campaignRows: SubjectRow[] = campaigns.map((c) => ({ id: c.id, name: c.name, label: CAMPAIGN_TYPE_LABEL[c.type], status: c.status, updatedAt: c.updatedAt, coverPath: c.photos[0]?.asset.path ?? null }));
  const counts: CountRow[] = groups.map((g) => ({ productId: g.productId, campaignId: g.campaignId, status: g.status, count: g._count._all, lastCreatedAt: g._max.createdAt }));
  const cards = buildSubjectCards({ products: productRows, campaigns: campaignRows, counts, filters });

  // No album photo: the newest picture BuPulse drew for it (its content's visual), and for General its newest photo.
  const bare = cards.filter((c) => !c.coverPath);
  const covers = new Map<string, string>();
  const productIds = bare.flatMap((c) => (c.kind === "product" && c.id ? [c.id] : []));
  const campaignIds = bare.flatMap((c) => (c.kind === "campaign" && c.id ? [c.id] : []));
  if (productIds.length || campaignIds.length) {
    const visuals = await prisma.contentVisual.findMany({
      where: { businessId, status: "ready", kind: { not: "video" }, content: { OR: [{ productId: { in: productIds } }, { campaignId: { in: campaignIds } }] } },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { items: true, content: { select: { productId: true, campaignId: true } } },
    });
    for (const v of visuals) {
      const key = v.content?.productId ? `product:${v.content.productId}` : v.content?.campaignId ? `campaign:${v.content.campaignId}` : null;
      const path = readItems(v.items)[0]?.path;
      if (key && path && !covers.has(key)) covers.set(key, path);
    }
  }
  if (bare.some((c) => c.kind === "general")) {
    const latest = await prisma.post.findFirst({ where: { businessId, productId: null, campaignId: null, mediaKind: { in: ["post", "carousel"] }, NOT: { mediaPaths: { isEmpty: true } } }, orderBy: { createdAt: "desc" }, select: { mediaPaths: true } });
    if (latest?.mediaPaths[0]) covers.set("general", latest.mediaPaths[0]);
  }
  const withCovers = cards.map((c) => ({ ...c, coverPath: c.coverPath ?? covers.get(c.key) ?? null }));
  const signed = await sign(withCovers.flatMap((c) => (c.coverPath ? [c.coverPath] : [])));
  return withCovers.map((c) => ({ ...c, coverUrl: c.coverPath ? (signed.get(c.coverPath) ?? null) : null, lastActivity: c.lastActivity?.toISOString() ?? null }));
}

export type SubjectInfo = { scope: ContentScope; name: string; label: string; albumHref: string | null; subjectId: string | null };

/** The product, campaign or General a subject page is about; null when it is not this business's. */
export async function loadSubjectInfo(businessId: string, scope: ContentScope): Promise<SubjectInfo | null> {
  if (scope.kind === "general") return { scope, name: GENERAL_NAME, label: GENERAL_LABEL, albumHref: null, subjectId: null };
  if (scope.kind === "product") {
    const p = await prisma.product.findFirst({ where: { id: scope.id, businessId }, select: { id: true, name: true, kind: true } });
    return p ? { scope, name: p.name, label: KIND_LABEL[p.kind], albumHref: `/dashboard/knowledge/products/${p.id}`, subjectId: p.id } : null;
  }
  const c = await prisma.campaign.findFirst({ where: { id: scope.id, businessId }, select: { id: true, name: true, type: true } });
  return c ? { scope, name: c.name, label: CAMPAIGN_TYPE_LABEL[c.type], albumHref: `/dashboard/knowledge/campaigns/${c.id}`, subjectId: c.id } : null;
}

/** One subject's posts under the filters, newest first (or by date when filtering on scheduled/posted), paged. */
export async function loadSubjectPosts(businessId: string, scope: ContentScope, filters: ContentFilters, zone: string, now: Date) {
  const where = contentWhere(businessId, filters, { zone, now, scope });
  const orderBy: Prisma.PostOrderByWithRelationInput[] =
    filters.dateField === "planned" && filters.range ? [{ scheduledAt: "asc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }, { id: "asc" }];
  const [rows, total] = await Promise.all([prisma.post.findMany({ where, orderBy, take: filters.limit + 1, include: postInclude }), prisma.post.count({ where })]);
  const hasMore = rows.length > filters.limit;
  return { posts: await toContentPosts(businessId, rows.slice(0, filters.limit)), total, hasMore };
}

/** One post by id for `?post=` links (the summary email), when it is this business's and not in the list already. */
export async function loadOnePost(businessId: string, postId: string): Promise<ContentPost | null> {
  const row = await prisma.post.findFirst({ where: { id: postId, businessId }, include: postInclude });
  return row ? (await toContentPosts(businessId, [row]))[0] : null;
}

/**
 * Posts made for an app that was not connected, still waiting or scheduled, whose app now has an account BuPulse posts
 * to: the "publish them automatically" offer.
 */
export async function switchableByHand(businessId: string): Promise<string[]> {
  const accounts = await prisma.connection.findMany({ where: { businessId, kind: "SOCIAL", postingMode: "AUTO", status: { in: ["ACTIVE", "EXPIRING"] } }, select: { provider: true } });
  const networks = [...new Set(accounts.map((a) => a.provider))];
  if (networks.length === 0) return [];
  const rows = await prisma.post.findMany({
    where: { businessId, remindOnly: true, connectionId: null, network: { in: networks }, status: { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED"] }, lockedAt: null },
    select: { id: true },
    take: 200,
  });
  return rows.map((r) => r.id);
}

/**
 * Apps posts are made for that have no usable account: reminder posts not posted yet, and apps Autopilot was told to
 * write for while not connected. The "Connect your apps" notice lists them until each is connected.
 */
export async function missingApps(businessId: string): Promise<Network[]> {
  const [rows, accounts, autopilot] = await Promise.all([
    prisma.post.groupBy({ by: ["network"], where: { businessId, remindOnly: true, connectionId: null, status: { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "NEEDS_ACTION"] } } }),
    prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, select: { provider: true, status: true, postingMode: true } }),
    prisma.autopilotSettings.findUnique({ where: { businessId }, select: { enabled: true, connectionIds: true } }),
  ]);
  const wanted = new Set<string>(rows.map((r) => r.network));
  if (autopilot?.enabled) for (const id of autopilot.connectionIds) if (id.startsWith("network:")) wanted.add(id.slice("network:".length));
  const connected = new Set(accounts.filter((a) => a.status === "ACTIVE" || a.status === "EXPIRING").map((a) => a.provider));
  return NETWORKS.filter((n) => wanted.has(n) && !connected.has(n));
}

