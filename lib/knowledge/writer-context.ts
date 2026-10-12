// The Knowledge base part 2 blocks for the AI writers (Studio, Autopilot): customers, positioning, permitted reviews,
// policies and the approved brand voice, loaded in one go. The blocks themselves are pure (lib/knowledge/context.ts).
import "server-only";
import { prisma } from "@/lib/db";
import { audienceContext, policiesContext, positioningContext, reviewsContext, voiceProfileContext } from "./context";

export type WriterKnowledge = {
  /** CUSTOMERS, POSITIONING, CUSTOMER REVIEWS and POLICIES, fenced, joined; null when the owner added none. */
  knowledgeBase: string | null;
  /** BRAND VOICE PROFILE once approved; replaces the voice preset in the prompt. */
  voiceProfile: string | null;
};

export async function writerKnowledge(businessId: string): Promise<WriterKnowledge> {
  const [business, personas, competitors, reviews] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { audienceNotes: true, positioning: true, policies: true, marketingProfile: true } }),
    prisma.persona.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 4 }),
    prisma.competitor.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 5, select: { name: true, link: true, strengths: true, weaknesses: true, pricePosition: true } }),
    // Only reviews the customer agreed to have quoted ever reach the AI.
    prisma.testimonial.findMany({
      where: { businessId, canPublish: true },
      orderBy: [{ receivedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 5,
      select: { quote: true, customerName: true, source: true, rating: true, canPublish: true, product: { select: { name: true } } },
    }),
  ]);
  if (!business) return { knowledgeBase: null, voiceProfile: null };
  const blocks = [
    audienceContext(personas, business.audienceNotes),
    positioningContext(business.positioning, competitors),
    reviewsContext(reviews.map((r) => ({ ...r, product: r.product?.name ?? null }))),
    policiesContext(business.policies),
  ].filter(Boolean);
  return { knowledgeBase: blocks.length ? blocks.join("\n\n") : null, voiceProfile: voiceProfileContext(business.marketingProfile) };
}
