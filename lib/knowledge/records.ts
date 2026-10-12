// Knowledge base part 2, server side: personas, competitors, FAQs and reviews (ordered lists of rows), and the JSON
// sections on Business (audience notes, positioning, policies). Every query is scoped to the company, so another
// company's id is simply "not found".
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { MAX_PERSONAS, type PersonaData } from "./audience";
import { MAX_COMPETITORS, type CompetitorData, type Positioning } from "./competitors";
import { MAX_FAQS, type Policies } from "./policies";
import { MAX_REVIEWS, type ReviewData } from "./reviews";
import { KnowledgeError } from "./service";

export type ListKind = "persona" | "competitor" | "faq";

const NOT_FOUND: Record<ListKind | "review", string> = {
  persona: "We could not find that persona.",
  competitor: "We could not find that competitor.",
  faq: "We could not find that question.",
  review: "We could not find that review.",
};

/** The next position at the end of a list, checking the cap under the company's advisory lock (no race past it). */
async function nextPosition(tx: Prisma.TransactionClient, kind: ListKind, businessId: string, cap: number, full: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`knowledge:${kind}:${businessId}`}))`;
  const where = { businessId };
  const [count, last] =
    kind === "persona"
      ? await Promise.all([tx.persona.count({ where }), tx.persona.findFirst({ where, orderBy: { position: "desc" }, select: { position: true } })])
      : kind === "competitor"
        ? await Promise.all([tx.competitor.count({ where }), tx.competitor.findFirst({ where, orderBy: { position: "desc" }, select: { position: true } })])
        : await Promise.all([tx.knowledgeFaq.count({ where }), tx.knowledgeFaq.findFirst({ where, orderBy: { position: "desc" }, select: { position: true } })]);
  if (count >= cap) throw new KnowledgeError(full);
  return (last?.position ?? -1) + 1;
}

// ---- Personas and audience notes --------------------------------------------------------------------------------

export function listPersonas(businessId: string) {
  return prisma.persona.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: MAX_PERSONAS });
}

export async function createPersona(businessId: string, data: PersonaData): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const position = await nextPosition(tx, "persona", businessId, MAX_PERSONAS, `You can describe up to ${MAX_PERSONAS} personas.`);
    return (await tx.persona.create({ data: { businessId, position, ...data }, select: { id: true } })).id;
  });
}

export async function updatePersona(businessId: string, id: string, data: PersonaData): Promise<void> {
  const { count } = await prisma.persona.updateMany({ where: { id, businessId }, data });
  if (!count) throw new KnowledgeError(NOT_FOUND.persona);
}

export async function saveAudienceNotes(businessId: string, notes: string | null): Promise<void> {
  await prisma.business.update({ where: { id: businessId }, data: { audienceNotes: notes } });
}

// ---- Competitors and positioning --------------------------------------------------------------------------------

export function listCompetitors(businessId: string) {
  return prisma.competitor.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: MAX_COMPETITORS });
}

export async function createCompetitor(businessId: string, data: CompetitorData): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const position = await nextPosition(tx, "competitor", businessId, MAX_COMPETITORS, `You can add up to ${MAX_COMPETITORS} competitors.`);
    return (await tx.competitor.create({ data: { businessId, position, ...data }, select: { id: true } })).id;
  });
}

export async function updateCompetitor(businessId: string, id: string, data: CompetitorData): Promise<void> {
  const { count } = await prisma.competitor.updateMany({ where: { id, businessId }, data });
  if (!count) throw new KnowledgeError(NOT_FOUND.competitor);
}

export async function savePositioning(businessId: string, positioning: Positioning): Promise<void> {
  await prisma.business.update({ where: { id: businessId }, data: { positioning: positioning as Prisma.InputJsonValue } });
}

// ---- FAQs and policies ------------------------------------------------------------------------------------------

export function listFaqs(businessId: string) {
  return prisma.knowledgeFaq.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: MAX_FAQS });
}

export async function createFaq(businessId: string, data: { question: string; answer: string }): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const position = await nextPosition(tx, "faq", businessId, MAX_FAQS, `You can add up to ${MAX_FAQS} questions.`);
    return (await tx.knowledgeFaq.create({ data: { businessId, position, ...data }, select: { id: true } })).id;
  });
}

export async function updateFaq(businessId: string, id: string, data: { question: string; answer: string }): Promise<void> {
  const { count } = await prisma.knowledgeFaq.updateMany({ where: { id, businessId }, data });
  if (!count) throw new KnowledgeError(NOT_FOUND.faq);
}

export async function savePolicies(businessId: string, policies: Policies): Promise<void> {
  await prisma.business.update({ where: { id: businessId }, data: { policies: policies as Prisma.InputJsonValue } });
}

// ---- Shared: delete and reorder ---------------------------------------------------------------------------------

export async function deleteListItem(kind: ListKind, businessId: string, id: string): Promise<void> {
  const where = { id, businessId };
  const { count } =
    kind === "persona" ? await prisma.persona.deleteMany({ where }) : kind === "competitor" ? await prisma.competitor.deleteMany({ where }) : await prisma.knowledgeFaq.deleteMany({ where });
  if (!count) throw new KnowledgeError(NOT_FOUND[kind]);
}

/**
 * Puts the company's rows in the order given. The ids must be exactly the company's rows of that kind (a stale page
 * that misses a new row, or another company's id, is refused), so positions stay 0..n-1 without gaps.
 */
export async function reorderList(kind: ListKind, businessId: string, ids: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`knowledge:${kind}:${businessId}`}))`;
    const where = { businessId };
    const rows =
      kind === "persona"
        ? await tx.persona.findMany({ where, select: { id: true } })
        : kind === "competitor"
          ? await tx.competitor.findMany({ where, select: { id: true } })
          : await tx.knowledgeFaq.findMany({ where, select: { id: true } });
    const own = new Set(rows.map((r) => r.id));
    if (ids.length !== own.size || new Set(ids).size !== ids.length || ids.some((id) => !own.has(id))) {
      throw new KnowledgeError("The list changed in the meantime. Reload the page and try again.");
    }
    for (const [position, id] of ids.entries()) {
      const data = { position };
      if (kind === "persona") await tx.persona.updateMany({ where: { id, businessId }, data });
      else if (kind === "competitor") await tx.competitor.updateMany({ where: { id, businessId }, data });
      else await tx.knowledgeFaq.updateMany({ where: { id, businessId }, data });
    }
  });
}

// ---- Reviews ----------------------------------------------------------------------------------------------------

export function listReviews(businessId: string) {
  return prisma.testimonial.findMany({
    where: { businessId },
    orderBy: [{ receivedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: MAX_REVIEWS,
    include: { product: { select: { id: true, name: true } } },
  });
}

/** The product a review is about must be the company's own; null otherwise. */
async function ownProduct(businessId: string, productId: string | null): Promise<string | null> {
  if (!productId) return null;
  const found = await prisma.product.findFirst({ where: { id: productId, businessId }, select: { id: true } });
  if (!found) throw new KnowledgeError("Choose one of your own products.");
  return found.id;
}

function reviewColumns(data: ReviewData, productId: string | null) {
  return {
    quote: data.quote,
    customerName: data.customerName,
    source: data.source,
    rating: data.rating,
    receivedOn: data.receivedOn ? new Date(`${data.receivedOn}T00:00:00.000Z`) : null,
    productId,
    canPublish: data.canPublish,
  };
}

export async function createReview(businessId: string, data: ReviewData): Promise<string> {
  const productId = await ownProduct(businessId, data.productId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`knowledge:review:${businessId}`}))`;
    if ((await tx.testimonial.count({ where: { businessId } })) >= MAX_REVIEWS) throw new KnowledgeError(`You can keep up to ${MAX_REVIEWS} reviews.`);
    return (await tx.testimonial.create({ data: { businessId, ...reviewColumns(data, productId) }, select: { id: true } })).id;
  });
}

export async function updateReview(businessId: string, id: string, data: ReviewData): Promise<void> {
  const productId = await ownProduct(businessId, data.productId);
  const { count } = await prisma.testimonial.updateMany({ where: { id, businessId }, data: reviewColumns(data, productId) });
  if (!count) throw new KnowledgeError(NOT_FOUND.review);
}

export async function setReviewPermission(businessId: string, id: string, canPublish: boolean): Promise<void> {
  const { count } = await prisma.testimonial.updateMany({ where: { id, businessId }, data: { canPublish } });
  if (!count) throw new KnowledgeError(NOT_FOUND.review);
}

export async function deleteReview(businessId: string, id: string): Promise<void> {
  const { count } = await prisma.testimonial.deleteMany({ where: { id, businessId } });
  if (!count) throw new KnowledgeError(NOT_FOUND.review);
}
