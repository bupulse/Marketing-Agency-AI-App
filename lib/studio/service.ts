import "server-only";
import { prisma } from "@/lib/db";
import { getTextProvider } from "@/lib/ai";
import { withLedger } from "@/lib/ai/ledger";
import { generateMarketingContent } from "@/lib/ai/marketing";
import { readKnowledge } from "@/lib/brand/schemas";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/errors";
import { consumeUsage, refundUsage } from "@/lib/usage";
import { buildVariants, type VariantSource } from "./variants";

export class StudioNotFoundError extends Error {
  constructor() {
    super("Project not found");
  }
}

export type GenerateFeature = "content" | "regenerate";

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
}) {
  const { userId, businessId, projectId, instruction, feature } = args;

  // Scoped to the business, so another account's project is simply "not found".
  const project = await prisma.project.findFirst({
    where: { id: projectId, businessId },
    include: { business: true, contents: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!project) throw new StudioNotFoundError();
  const { business } = project;

  const reservation = await consumeUsage(userId, "text");
  try {
    const knowledge = readKnowledge(business.knowledge);
    const configured = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();
    const result = await withLedger(
      { userId, businessId, feature },
      { provider: configured, model: "unknown" },
      () =>
        generateMarketingContent(
          getTextProvider(),
          {
            businessName: business.name,
            industry: business.industry,
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

    return await prisma.generatedContent.create({
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
  } catch (error) {
    try {
      await refundUsage(userId, "text", reservation.periodStart);
    } catch (refundError) {
      await logError(refundError, { source: "studio.refund", level: "error" });
    }
    throw error;
  }
}
