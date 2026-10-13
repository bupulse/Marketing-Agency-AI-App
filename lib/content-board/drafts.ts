// Studio content becomes posts to review (docs/CONTENT.md): when content is written or edited for a product or
// campaign, BuPulse drafts one post per connected app, written for that app, with the content's picture or video.
// They wait as "Needs review" (or are scheduled on their own where Content -> Settings says so). The content itself
// stays on the product's or campaign's page as before. Apps the content was written for that are not connected get a
// post too (remindOnly): approved, it becomes a "post it yourself" reminder at its time.
import "server-only";
import { parseVariants } from "@/components/studio/helpers";
import { prisma } from "@/lib/db";
import { companyEntitlements } from "@/lib/entitlements";
import { accountUsable } from "@/lib/publishing/service";
import { getProvider, isNetwork } from "@/lib/social/registry";
import type { Network } from "@/lib/social/types";
import { mediaForPost } from "@/lib/visuals/post-media";
import { readyMedia } from "@/lib/visuals/service";
import { autoSchedule, type AutoResult } from "./auto";
import { draftTargets } from "./by-hand";

type ContentText = { caption: string; hashtags: string[]; videoScript: string; variants: unknown };

/** The text, hashtags and format of one app's post, from the content and its per-network versions. Pure. */
export function draftFor(network: Network, content: ContentText): { text: string; hashtags: string[]; format: "POST" | "SCRIPT" } {
  const rules = getProvider(network).rules;
  if (rules.videoOnly) return { text: content.videoScript.trim() || content.caption, hashtags: content.hashtags.slice(0, rules.maxHashtags ?? 30), format: "SCRIPT" };
  const variant = parseVariants(content.variants).find((v) => v.network === network);
  const hashtags = (variant?.hashtags ?? content.hashtags).slice(0, rules.maxHashtags ?? 30);
  return { text: (variant?.caption ?? content.caption).trim(), hashtags, format: "POST" };
}

export type DraftResult = AutoResult & { created: number; replaced: number; existing: number };

/**
 * Drafts the posts of one content version for every usable connected app. Earlier drafts of the same product or
 * campaign that still wait for review are replaced (a rewrite or an edit makes them out of date), unless the owner
 * edited them; posts the owner approved, scheduled or made by hand are never touched. Does nothing without scheduling in the plan.
 */
export async function draftPostsFromContent(owner: { businessId: string }, contentId: string, now = new Date()): Promise<DraftResult> {
  const none: DraftResult = { created: 0, replaced: 0, existing: 0, scheduled: 0, waiting: 0 };
  const entitlements = await companyEntitlements(owner.businessId);
  if (!entitlements.usable.has("calendar") || entitlements.block) return none;
  const content = await prisma.generatedContent.findFirst({
    where: { id: contentId, businessId: owner.businessId },
    select: { id: true, caption: true, hashtags: true, videoScript: true, variants: true, productId: true, campaignId: true },
  });
  if (!content || (!content.productId && !content.campaignId)) return none;
  const connections = (await prisma.connection.findMany({ where: { businessId: owner.businessId, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } })).filter(
    (c) => isNetwork(c.provider) && accountUsable(c),
  );
  const writtenFor = [...new Set(parseVariants(content.variants).map((v): string => v.network))].filter(isNetwork);
  const targets = draftTargets(connections, writtenFor);
  if (targets.length === 0) return none;

  const subject = content.productId ? { productId: content.productId } : { campaignId: content.campaignId as string };
  const visual = await readyMedia(owner.businessId, { contentId: content.id });
  const groupId = globalThis.crypto.randomUUID();
  const rows = targets.map(({ connection, network }) => {
    const rules = getProvider(network).rules;
    const draft = draftFor(network, content);
    const media = mediaForPost({ network, format: draft.format, rules, images: visual.images, video: visual.video });
    return {
      businessId: owner.businessId,
      connectionId: connection?.id ?? null,
      remindOnly: connection === null,
      network,
      groupId,
      ...subject,
      contentId: content.id,
      status: "PENDING_APPROVAL" as const,
      format: media.format,
      source: "STUDIO" as const,
      text: draft.text,
      hashtags: draft.hashtags,
      mediaPaths: media.mediaPaths,
    };
  });
  // One transaction under a per-content lock: replacing and drafting happen together (never the old drafts gone and no
  // new ones), and two calls at once (two tabs opening the page, a double click) draft once: the second waits for the
  // lock, then finds the first one's drafts and makes none. Drafts the owner edited stay.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-drafts:${content.id}`}))`;
    const existing = await tx.post.count({ where: { businessId: owner.businessId, contentId: content.id, source: "STUDIO", status: { not: "CANCELLED" } } });
    if (existing > 0) return { created: [] as { id: string }[], replaced: 0, existing };
    const { count: replaced } = await tx.post.deleteMany({ where: { businessId: owner.businessId, ...subject, source: "STUDIO", status: "PENDING_APPROVAL", ownerEditedAt: null, NOT: { contentId: content.id } } });
    const created: { id: string }[] = [];
    for (const data of rows) created.push(await tx.post.create({ data, select: { id: true } }));
    await tx.generatedContent.updateMany({ where: { id: content.id, businessId: owner.businessId }, data: { postsDraftedAt: now } });
    return { created, replaced, existing: 0 };
  });
  const auto = await autoSchedule(owner.businessId, outcome.created.map((p) => p.id), now);
  return { created: outcome.created.length, replaced: outcome.replaced, existing: outcome.existing, ...auto };
}

/**
 * The newest content of a product or campaign, and whether it has posts. Content written before drafting existed
 * (postsDraftedAt null) and with no posts yet is drafted now, once (the backfill when its page is opened); content
 * whose drafts the owner rejected is never drafted again on its own.
 */
export async function latestContentPosts(businessId: string, subject: { productId: string } | { campaignId: string }, options: { backfill?: boolean } = {}): Promise<{ contentId: string; hasPosts: boolean } | null> {
  const content = await prisma.generatedContent.findFirst({ where: { businessId, ...subject }, orderBy: { createdAt: "desc" }, select: { id: true, postsDraftedAt: true } });
  if (!content) return null;
  const hasPosts = (await prisma.post.count({ where: { businessId, contentId: content.id } })) > 0;
  if (!hasPosts && !content.postsDraftedAt && options.backfill) {
    const { created, existing } = await draftPostsFromContent({ businessId }, content.id);
    return { contentId: content.id, hasPosts: created + existing > 0 };
  }
  return { contentId: content.id, hasPosts };
}
