import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import "server-only";
import { prisma } from "@/lib/db";
import { industryContext } from "@/lib/industry-context";
import { getTextProvider } from "@/lib/ai";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";
import { generateMarketingContent } from "@/lib/ai/marketing";
import { readKnowledge } from "@/lib/brand/schemas";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/errors";
import { consumeUsage, refundUsage } from "@/lib/usage";
import { queueWebhookEvent } from "@/lib/webhooks/emit";
import { contentData } from "@/lib/webhooks/events";
import { MAX_VERSIONS_PER_PROJECT } from "./schemas";
import { buildVariants, type VariantSource } from "./variants";

export class StudioNotFoundError extends Error {
  constructor() {
    super("Project not found");
  }
}

export type GenerateFeature = "content" | "regenerate";

/** The model name the configured provider will use, for ledger rows of calls that fail before a result. */
export function configuredModel(provider: string) {
  return provider === "claude"
    ? (process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5")
    : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL);
}

/** Keeps at most MAX_VERSIONS_PER_PROJECT versions: deletes the oldest ones beyond that. */
export async function pruneVersions(projectId: string) {
  const old = await prisma.generatedContent.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS_PER_PROJECT,
    select: { id: true },
  });
  if (old.length > 0) await prisma.generatedContent.deleteMany({ where: { id: { in: old.map((c) => c.id) } } });
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
 * Generates a new content version for a project: reserves 1 text credit, calls the AI through
 * the cost ledger, saves the version with its per-network variants, and gives the credit back
 * if anything fails. Throws UsageLimitError (nothing was charged) when the plan blocks it.
 */
export async function generateForProject(args: {
  userId: string;
  businessId: string;
  projectId: string;
  instruction?: string;
  feature: GenerateFeature;
  /** A credit the caller already reserved (consumeUsage); it is refunded on any failure here. */
  reservation?: { periodStart: Date };
}) {
  const { userId, businessId, projectId, instruction, feature } = args;
  let reservation = args.reservation;

  // Scoped to the business, so another account's project is simply "not found".
  const project = await prisma.project.findFirst({
    where: { id: projectId, businessId },
    include: { business: { include: { industryRef: true } }, contents: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!project) {
    if (reservation) await refundUsage(userId, "text", reservation.periodStart).catch(() => {});
    throw new StudioNotFoundError();
  }
  const { business } = project;

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
            knowledge,
          },
          {
            type: project.type,
            title: project.title,
            price: project.price,
            features: project.features,
            extraDetails: readNotes(project.details),
            instruction,
            previousCaption: project.contents[0]?.caption,
          },
        ),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );

    const saved = await prisma.generatedContent.create({
      data: {
        projectId: project.id,
        ...result.content,
        language: business.contentLanguage,
        variants: variantsJson(result.content),
        edited: false,
        provider: result.provider,
        model: result.model,
      },
    });
    await pruneVersions(project.id).catch((e) => logError(e, { source: "studio.prune", level: "warn" }));
    trackEvent(EVENT_NAMES.textGenerated, { userId, businessId: business.id, props: { feature, type: project.type } });
    queueWebhookEvent(business.id, "content.generated", () => contentData(saved));
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
