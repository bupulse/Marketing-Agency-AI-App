// Studio content becomes posts to review (docs/CONTENT.md): when content is written or edited for a product or
// campaign, BuPulse drafts one post per connected app, written for that app, with the content's picture or video.
// They wait as "Needs review" (or are scheduled on their own where Content -> Settings says so). The content itself
// stays on the product's or campaign's page as before.
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

type ContentText = { caption: string; hashtags: string[]; videoScript: string; variants: unknown };

/** The text, hashtags and format of one app's post, from the content and its per-network versions. Pure. */
export function draftFor(network: Network, content: ContentText): { text: string; hashtags: string[]; format: "POST" | "SCRIPT" } {
  const rules = getProvider(network).rules;
  if (rules.videoOnly) return { text: content.videoScript.trim() || content.caption, hashtags: content.hashtags.slice(0, rules.maxHashtags ?? 30), format: "SCRIPT" };
  const variant = parseVariants(content.variants).find((v) => v.network === network);
  const hashtags = (variant?.hashtags ?? content.hashtags).slice(0, rules.maxHashtags ?? 30);
  return { text: (variant?.caption ?? content.caption).trim(), hashtags, format: "POST" };
}

export type DraftResult = AutoResult & { created: number; replaced: number };

/**
 * Drafts the posts of one content version for every usable connected app. Earlier drafts of the same product or
 * campaign that still wait for review are replaced (a rewrite or an edit makes them out of date), unless the owner
 * edited them; posts the owner approved, scheduled or made by hand are never touched. Does nothing without scheduling in the plan.
 */
export async function draftPostsFromContent(owner: { businessId: string }, contentId: string, now = new Date()): Promise<DraftResult> {
  const none: DraftResult = { created: 0, replaced: 0, scheduled: 0, waiting: 0 };
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
  if (connections.length === 0) return none;

  const subject = content.productId ? { productId: content.productId } : { campaignId: content.campaignId as string };
  const visual = await readyMedia(owner.businessId, { contentId: content.id });
  const groupId = globalThis.crypto.randomUUID();
  const rows = connections.map((c) => {
    const network = c.provider as Network;
    const rules = getProvider(network).rules;
    const draft = draftFor(network, content);
    const media = mediaForPost({ network, format: draft.format, rules, images: visual.images, video: visual.video });
    return {
      businessId: owner.businessId,
      connectionId: c.id,
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
  // Replacing and drafting in one transaction: never the old drafts gone and no new ones. Drafts the owner edited stay.
  const [removed, ...created] = (await prisma.$transaction([
    prisma.post.deleteMany({ where: { businessId: owner.businessId, ...subject, source: "STUDIO", status: "PENDING_APPROVAL", ownerEditedAt: null, NOT: { contentId: content.id } } }),
    ...rows.map((data) => prisma.post.create({ data, select: { id: true } })),
  ])) as [{ count: number }, ...{ id: string }[]];
  const replaced = removed.count;
  const auto = await autoSchedule(owner.businessId, created.map((p) => p.id), now);
  return { created: created.length, replaced, ...auto };
}
