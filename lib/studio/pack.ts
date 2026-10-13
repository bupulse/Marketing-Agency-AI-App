// Content packs on the server (docs/CONTENT_PACKS.md): "Write content" for a product or campaign makes a pack of
// different posts. Angles are chosen and rotated per subject, spread over the company's apps in each app's format,
// written in one AI call, and every post gets its own visual with people (one AI image each while the plan's images
// and AI allowance last, then designed posts from the real photos). One text credit per post written.
import "server-only";
import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import { getTextProvider } from "@/lib/ai";
import { withLedger } from "@/lib/ai/ledger";
import { writePack, type PackSlot } from "@/lib/ai/pack";
import { holidaysBetween } from "@/lib/autopilot/calendar";
import { readKnowledge } from "@/lib/brand/schemas";
import { knowledgeFacts } from "@/lib/business-info/facts";
import { getContentSettings } from "@/lib/content-board/settings-service";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { GeneratedContent } from "@/lib/generated/prisma/client";
import { industryContext } from "@/lib/industry-context";
import { profileContext } from "@/lib/knowledge/context";
import { subjectColumns, writingSubject, type Subject } from "@/lib/knowledge/service";
import { writerKnowledge } from "@/lib/knowledge/writer-context";
import { accountUsable } from "@/lib/publishing/service";
import { isNetwork } from "@/lib/social/registry";
import type { Network } from "@/lib/social/types";
import { queueWebhookEvent } from "@/lib/webhooks/emit";
import { contentData } from "@/lib/webhooks/events";
import { consumeUsage, getUsageSummary, refundUsage, UsageLimitError } from "@/lib/usage";
import { directVisual } from "@/lib/visuals/art-director";
import { diversifyPack } from "@/lib/visuals/direction";
import { aiPhotosStatus, audienceFor, directionContext, planVisuals, videoAvailable } from "@/lib/visuals/service";
import { ANGLES, chooseAngles, spreadNetworks, type AngleFacts } from "./angles";
import { configuredModel, pruneVersions, StudioNotFoundError, variantsJson, type GenerateFeature } from "./service";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The pack's apps: the company's usable connected accounts, else the defaults (lib/studio/angles.ts). */
async function packNetworks(businessId: string): Promise<Network[]> {
  const connections = await prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } });
  return [...new Set(connections.filter((c) => isNetwork(c.provider) && accountUsable(c)).map((c) => c.provider as Network))];
}

/** Angles this subject had, newest first (for the rotation). */
async function recentAngles(businessId: string, subject: Subject): Promise<string[]> {
  const rows = await prisma.generatedContent.findMany({ where: { businessId, ...subjectColumns(subject), angle: { not: null } }, orderBy: { createdAt: "desc" }, take: 40, select: { angle: true } });
  return rows.flatMap((r) => (r.angle ? [r.angle] : []));
}

/** What the subject offers the angles: a price, something new, competitors, FAQs, a local moment soon. */
async function angleFacts(businessId: string, subject: Subject, item: { type: string; price?: string | null }, country: string | null, now: Date): Promise<AngleFacts> {
  const [product, campaign, competitors, faqs] = await Promise.all([
    subject.kind === "product" ? prisma.product.findFirst({ where: { id: subject.id, businessId }, select: { createdAt: true } }) : null,
    subject.kind === "campaign" ? prisma.campaign.findFirst({ where: { id: subject.id, businessId }, select: { type: true } }) : null,
    prisma.competitor.count({ where: { businessId } }),
    prisma.knowledgeFaq.count({ where: { businessId } }),
  ]);
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 21 * DAY_MS).toISOString().slice(0, 10);
  const moment = holidaysBetween(country, today, soon).find((h) => !h.sensitive);
  return {
    subjectType: item.type,
    hasPrice: !!item.price?.trim(),
    isNew: !!campaign || (!!product && now.getTime() - product.createdAt.getTime() < 30 * DAY_MS),
    hasCompetitors: competitors > 0,
    hasFaqs: faqs > 0,
    moment: moment ? `${moment.name} (${moment.date})` : null,
  };
}

/**
 * Reserves one text credit per post, as many as the plan has left (at least one, or UsageLimitError): a pack of 5
 * with 3 credits left becomes a pack of 3.
 */
async function reserveCredits(userId: string, wanted: number): Promise<{ periodStart: Date; count: number }> {
  try {
    const { periodStart } = await consumeUsage(userId, "text", wanted);
    return { periodStart, count: wanted };
  } catch (error) {
    if (!(error instanceof UsageLimitError) || error.reason !== "limit_reached") throw error;
    const usage = await getUsageSummary(userId);
    const left = Math.min(wanted, usage.limits.text - usage.used.text);
    if (left < 1) throw error;
    const { periodStart } = await consumeUsage(userId, "text", left);
    return { periodStart, count: left };
  }
}

/** AI images this pack may use: the plan's images left this month (and none when they or the allowance are out). */
async function aiImagesLeft(owner: { userId: string; businessId: string }): Promise<{ count: number; exhausted: { refillAt: string | null } | null }> {
  const status = await aiPhotosStatus(owner);
  if (!status.allowed) return { count: 0, exhausted: status.exhausted };
  try {
    const usage = await getUsageSummary(owner.userId);
    return { count: Math.max(0, usage.limits.image - usage.used.image), exhausted: null };
  } catch {
    return { count: 0, exhausted: null };
  }
}

export interface PackResult {
  packId: string;
  contents: GeneratedContent[];
}

/**
 * Writes a content pack for a product or campaign. Throws UsageLimitError (nothing charged) when the plan has no text
 * credit left, StudioNotFoundError for another company's subject. Credits for posts not written are given back. The
 * visuals never fail the pack.
 */
export async function generatePackForSubject(args: {
  userId: string;
  businessId: string;
  subject: Subject;
  instruction?: string;
  feature: GenerateFeature;
  /** Posts in the pack; Content settings' pack size when missing. */
  size?: number;
  now?: Date;
}): Promise<PackResult> {
  const { userId, businessId, subject, instruction, feature } = args;
  const now = args.now ?? new Date();
  const [business, item, kb, settings, networks, recent] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, include: { industryRef: true } }),
    writingSubject(businessId, subject),
    writerKnowledge(businessId),
    getContentSettings(businessId),
    packNetworks(businessId),
    recentAngles(businessId, subject),
  ]);
  if (!business || !item) throw new StudioNotFoundError();

  const facts = await angleFacts(businessId, subject, item, business.country, now);
  const angles = chooseAngles(facts, recent, args.size ?? settings.packSize);
  let slots: PackSlot[] = spreadNetworks(angles, networks);
  const reserved = await reserveCredits(userId, slots.length);
  slots = slots.slice(0, reserved.count);

  let kept = 0;
  try {
    const knowledge = readKnowledge(business.knowledge);
    const configured = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();
    const written = await withLedger(
      { userId, businessId, feature },
      { provider: configured, model: configuredModel(configured) },
      () =>
        writePack(
          getTextProvider(),
          {
            businessName: business.name,
            industry: business.industry,
            industryContext: industryContext(business),
            description: business.description,
            audience: business.audience,
            tone: business.tone,
            website: business.website,
            contentLanguage: business.contentLanguage,
            knowledge: knowledgeFacts(knowledge),
            profile: profileContext(business.profile),
            ...kb,
          },
          { type: item.type, title: item.title, price: item.price, features: item.features, context: item.context, instruction },
          slots,
          facts.moment,
        ),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );

    const packId = globalThis.crypto.randomUUID();
    const contents: GeneratedContent[] = [];
    for (const post of written.posts) {
      contents.push(
        await prisma.generatedContent.create({
          data: {
            businessId,
            ...subjectColumns(subject),
            caption: post.caption,
            hashtags: post.hashtags,
            videoScript: post.videoScript,
            adHeadlines: post.headline ? [post.headline] : [],
            language: business.contentLanguage,
            variants: variantsJson({ caption: post.caption, hashtags: post.hashtags, videoScript: post.videoScript }),
            edited: false,
            provider: written.provider,
            model: written.model,
            packId,
            angle: post.angle,
            network: post.network,
          },
        }),
      );
    }
    kept = contents.length;
    await pruneVersions(subject, { userId, businessId }).catch((e) => logError(e, { source: "studio.prune", level: "warn" }));
    await trackEvent(EVENT_NAMES.textGenerated, { userId, businessId, props: { feature, type: item.type, pack: kept } });
    for (const saved of contents) await queueWebhookEvent(businessId, "content.generated", () => contentData(saved));
    await planPackVisuals({ userId, businessId }, { business, item, contents, written: written.posts }).catch((e) => logError(e, { source: "studio.pack.visuals", level: "warn", businessId }));
    return { packId, contents };
  } finally {
    // One credit per post kept: the rest go back (all of them when the call failed).
    const unused = reserved.count - kept;
    if (unused > 0) await refundUsage(userId, "text", reserved.periodStart, unused).catch((e) => logError(e, { source: "studio.pack.refund", level: "error" }));
  }
}

/**
 * Every post's visual: the art director is asked for all of them at once (each with its angle), the covers are made
 * to look different from one another, then each plan is saved; video posts get a video plan too. AI images go to the
 * first posts while the plan's images last; the rest are designed from the real photos.
 */
async function planPackVisuals(
  owner: { userId: string; businessId: string },
  input: {
    business: { name: string; tone: string | null; industry: string | null; brandColors: string[] };
    item: { type: string; title: string; price?: string | null; photoPaths: string[] };
    contents: GeneratedContent[];
    written: { angle: keyof typeof ANGLES; format: "image" | "carousel" | "video" }[];
  },
) {
  const { business, item, contents, written } = input;
  const [ai, videoOk, audience] = await Promise.all([aiImagesLeft(owner), videoAvailable(owner.businessId), audienceFor(owner.businessId)]);
  const base = (content: GeneratedContent, i: number) => ({
    business,
    subjectType: item.type,
    title: item.title,
    price: item.price,
    caption: content.caption,
    headlines: content.adHeadlines,
    videoScript: content.videoScript,
    photos: item.photoPaths,
    carouselAllowed: written[i].format === "carousel",
    aiAllowed: i < ai.count,
    audience,
    angle: { id: written[i].angle, label: ANGLES[written[i].angle].label, people: ANGLES[written[i].angle].people },
  });
  const plans = diversifyPack(await Promise.all(contents.map((c, i) => directVisual(directionContext(base(c, i)), owner))), item.type);
  for (const [i, content] of contents.entries()) {
    await planVisuals({
      owner,
      target: { contentId: content.id },
      ...base(content, i),
      precomputed: plans[i],
      video: written[i].format === "video" && videoOk && content.videoScript.trim().length > 0,
      aiExhausted: i >= ai.count && ai.exhausted ? ai.exhausted : undefined,
    });
  }
}
