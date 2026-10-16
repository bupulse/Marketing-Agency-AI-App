import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import "server-only";
import { prisma } from "@/lib/db";
import { industryContext } from "@/lib/industry-context";
import { getTextProvider } from "@/lib/ai";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";
import { generateMarketingContent } from "@/lib/ai/marketing";
import { readKnowledge } from "@/lib/brand/schemas";
import { knowledgeFacts } from "@/lib/business-info/facts";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/errors";
import { consumeUsage, refundUsage } from "@/lib/usage";
import { queueWebhookEvent } from "@/lib/webhooks/emit";
import { contentData } from "@/lib/webhooks/events";
import { profileContext } from "@/lib/knowledge/context";
import { writerKnowledge } from "@/lib/knowledge/writer-context";
import { subjectColumns, writingSubject, type Subject } from "@/lib/knowledge/service";
import { MAX_VERSIONS_PER_PROJECT } from "./schemas";
import { buildVariants, type VariantSource } from "./variants";
import { planContentVisuals } from "@/lib/visuals/content";
import { releaseContentVisuals } from "@/lib/visuals/service";

export class StudioNotFoundError extends Error {
  constructor() {
    super("Not found");
  }
}

export type GenerateFeature = "content" | "regenerate";

/** The model name the configured provider will use, for ledger rows of calls that fail before a result. */
export function configuredModel(provider: string) {
  return provider === "claude"
    ? (process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5")
    : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL);
}

/**
 * Keeps at most MAX_VERSIONS_PER_PROJECT versions per product or campaign: deletes the oldest ones beyond that. With
 * the owner, their visuals' files go too (videos and slide designs no post uses); the rows follow the content.
 */
export async function pruneVersions(subject: Subject, owner?: { userId: string; businessId: string }) {
  const old = await prisma.generatedContent.findMany({
    // A day's posts (content flow v3, forDate set) are the day view's history, not versions: never pruned here.
    where: subject.kind === "product" ? { productId: subject.id, forDate: null } : { campaignId: subject.id, forDate: null },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS_PER_PROJECT,
    select: { id: true },
  });
  if (old.length === 0) return;
  if (owner) await releaseContentVisuals(owner, old.map((c) => c.id)).catch((e) => logError(e, { source: "studio.prune.visuals", level: "warn" }));
  await prisma.generatedContent.deleteMany({ where: { id: { in: old.map((c) => c.id) } } });
}

export function variantsJson(source: VariantSource) {
  return buildVariants(source) as unknown as Prisma.InputJsonValue;
}

/** Free-text notes live in Project.details as { notes }. */
export function readNotes(details: unknown): string | undefined {
  if (details && typeof details === "object" && "notes" in details) {
    const notes = (details as { notes?: unknown }).notes;
    if (typeof notes === "string" && notes) return notes;
  }
  return undefined;
}

/**
 * Generates a new content version for a product or campaign: reserves 1 text credit, calls the AI through the cost
 * ledger with the product's (or campaign's) full details as a fenced data block, saves the version with its per-network
 * variants, and gives the credit back if anything fails. Throws UsageLimitError (nothing was charged) when the plan
 * blocks it.
 */
export async function generateForSubject(args: {
  userId: string;
  businessId: string;
  subject: Subject;
  instruction?: string;
  feature: GenerateFeature;
  /** A credit the caller already reserved (consumeUsage); it is refunded on any failure here. */
  reservation?: { periodStart: Date };
  /** Plan the content's picture (and video) right away; the content screen draws it. Default true. */
  visuals?: boolean;
}) {
  const { userId, businessId, subject, instruction, feature } = args;
  let reservation = args.reservation;

  // Scoped to the business, so another account's product is simply "not found".
  const [business, item, previous, kb] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, include: { industryRef: true } }),
    writingSubject(businessId, subject),
    prisma.generatedContent.findFirst({ where: { businessId, ...subjectColumns(subject) }, orderBy: { createdAt: "desc" }, select: { caption: true } }),
    writerKnowledge(businessId),
  ]);
  if (!business || !item) {
    if (reservation) await refundUsage(userId, "text", reservation.periodStart).catch(() => {});
    throw new StudioNotFoundError();
  }

  reservation ??= await consumeUsage(userId, "text");
  const reserved = reservation;
  try {
    const knowledge = readKnowledge(business.knowledge);
    const configured = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();
    const result = await withLedger(
      { userId, businessId, feature },
      { provider: configured, model: configuredModel(configured) },
      () =>
        generateMarketingContent(
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
          {
            type: item.type,
            title: item.title,
            price: item.price,
            features: item.features,
            context: item.context,
            instruction,
            previousCaption: previous?.caption,
          },
        ),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );

    const saved = await prisma.generatedContent.create({
      data: {
        businessId,
        ...subjectColumns(subject),
        ...result.content,
        language: business.contentLanguage,
        variants: variantsJson(result.content),
        edited: false,
        provider: result.provider,
        model: result.model,
      },
    });
    await pruneVersions(subject, { userId, businessId }).catch((e) => logError(e, { source: "studio.prune", level: "warn" }));
    // The picture never fails the content: planVisuals logs and gives up on its own.
    if (args.visuals !== false) await planContentVisuals({ userId, businessId }, { business, item, content: saved }).catch((e) => logError(e, { source: "studio.visuals", level: "warn" }));
    await trackEvent(EVENT_NAMES.textGenerated, { userId, businessId: business.id, props: { feature, type: item.type } });
    await queueWebhookEvent(business.id, "content.generated", () => contentData(saved));
    return saved;
  } catch (error) {
    try {
      await refundUsage(userId, "text", reserved.periodStart);
    } catch (refundError) {
      await logError(refundError, { source: "studio.refund", level: "error" });
    }
    throw error;
  }
}
