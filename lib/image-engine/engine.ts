// The image engine (docs/IMAGE_ENGINE.md): a team of agents that makes unique, finished advert pictures.
//   Director (director.ts, rules)  -> patterns, shots, lights, layouts, photos, Pro or Lite, from the company's memory
//   Prompter (planner.ts, Claude + Gemini) -> each picture's idea, words and own image prompt
//   Captioner (captioner.ts, Gemini) -> the post caption for each picture
//   Painter (painter-prompt.ts + createEngineDesign, Nano Banana Pro or Lite) -> the finished advert, words included
//   Checker (check.ts + checker.ts, Gemini vision) -> are the words right, no invented numbers, product visible
//   Editor (createEngineDesign editOf) -> one fix after a failed check, or the owner's "change this"
// planBatch plans a batch and reserves its credits (Lite 1, Pro 4); paintNext paints one picture per call, so a server
// that stops a request after 60 s (Netlify) never loses one; the screen calls it until the batch is done.
import "server-only";
import { prisma } from "@/lib/db";
import { featureStatus } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { readKnowledge } from "@/lib/brand/schemas";
import { getVoice } from "@/lib/brand/voices";
import { colorName } from "@/lib/designs/prompt";
import { createEngineDesign, deleteDesign, DesignError } from "@/lib/designs/service";
import type { AspectRatio } from "@/lib/designs/layout";
import { DEFAULT_GEMINI_IMAGE_MODEL } from "@/lib/ai/gemini-image";
import { formatPrice } from "@/lib/knowledge/products";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeUsage, getUsageSummary, refundUsage } from "@/lib/usage";
import { knownCountry, safePhrase } from "@/lib/visuals/people";
import { captionBatch } from "./captioner";
import { checkPicture } from "./check";
import { chooseTiers, creditsOf, directBatch, patternsFromBrief, TIER_CREDITS, type Quality, type Tier } from "./director";
import { painterPrompt } from "./painter-prompt";
import { writeConcepts } from "./planner";
import type { Treatment } from "./patterns";
import type { BusinessFacts, PlannerInput, SubjectFacts } from "./prompter";

export class EngineError extends Error {}

type Owner = { userId: string; businessId: string; service?: boolean };
export type BatchSource = "designs" | "content" | "daily" | "autopilot";
export type BatchRequest = { source: BatchSource; subjectId?: string | null; brief?: string | null; count: number; quality: Quality; aspectRatio: AspectRatio };

/** How long one painting call holds a picture: the image (120 s budget), the check and one fix fit inside. */
export const PAINT_LEASE_MS = 6 * 60 * 1000;
export const MAX_BATCH = 20;

/** The Painter's model for each tier (env to change them). */
export function tierModel(tier: Tier): string {
  return tier === "pro" ? (process.env.GEMINI_IMAGE_PRO_MODEL ?? "gemini-3-pro-image") : (process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_GEMINI_IMAGE_MODEL);
}

/** The AI image credits the company has left this period. */
export async function creditsLeft(userId: string): Promise<number> {
  const usage = await getUsageSummary(userId);
  return Math.max(0, (usage.limits.image ?? 0) - (usage.used.image ?? 0));
}

async function loadFacts(owner: Owner, subjectId: string | null | undefined) {
  const business = await prisma.business.findUnique({
    where: { id: owner.businessId },
    select: { id: true, userId: true, name: true, industry: true, description: true, audience: true, tone: true, contentLanguage: true, country: true, knowledge: true, brandColors: true, logoUrl: true },
  });
  if (!business || business.userId !== owner.userId) throw new EngineError("We could not find your business.");
  const product = subjectId
    ? await prisma.product.findFirst({
        where: { id: subjectId, businessId: business.id },
        select: { id: true, name: true, summary: true, description: true, priceModel: true, priceAmount: true, currency: true, priceNote: true, usps: true, photos: { orderBy: { position: "asc" }, select: { asset: { select: { path: true, kind: true } } } } },
      })
    : null;
  if (subjectId && !product) throw new EngineError("We could not find that product.");
  const reviews = await prisma.testimonial.findMany({ where: { businessId: business.id, canPublish: true, ...(product ? { OR: [{ productId: product.id }, { productId: null }] } : {}) }, select: { quote: true }, take: 5, orderBy: { createdAt: "desc" } }).catch(() => []);
  const area = safePhrase(readKnowledge(business.knowledge).area, 80);
  const facts: BusinessFacts = {
    name: business.name,
    industry: business.industry,
    description: business.description,
    audience: business.audience,
    place: [area, knownCountry(business.country)].filter(Boolean).join(", ") || null,
    language: business.contentLanguage || "English",
    voice: getVoice(business.tone)?.label ?? null,
    colors: [...new Set(business.brandColors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3).map(colorName))],
  };
  const subject: SubjectFacts | null = product
    ? {
        name: product.name,
        description: [product.summary, product.description].filter(Boolean).join(" ").slice(0, 700) || null,
        price: product.priceAmount != null || product.priceNote ? formatPrice(product) : null,
        sellingPoints: product.usps.filter(Boolean).slice(0, 5),
      }
    : null;
  const photos = (product?.photos ?? []).map((p) => p.asset).filter((a) => a.kind === "photo").map((a) => a.path);
  return { business, facts, subject, photos, reviews: reviews.map((r) => r.quote).filter(Boolean), hasPrice: product?.priceAmount != null };
}

/**
 * Plans a batch: the Director's slots within the credits left, the Prompter's concepts and the Captioner's captions,
 * saved as planned pictures with their credits reserved. Throws EngineError with a message the owner can read.
 */
export async function planBatch(owner: Owner, request: BatchRequest): Promise<{ batchId: string; count: number; credits: number; pro: number }> {
  if ((await featureStatus(owner.businessId, "aiPhotos")) !== "ok") throw new EngineError("AI pictures are not in your plan. Free designs still work.");
  await rateLimit(`imagebatch:${owner.userId}`, RATE_LIMITS.imageBatch);
  const count = Math.max(1, Math.min(MAX_BATCH, Math.floor(request.count)));
  const loaded = await loadFacts(owner, request.subjectId);
  const tiers = chooseTiers(count, await creditsLeft(owner.userId), request.quality);
  if (!tiers.length) throw new EngineError("You have no AI image credits left this month. They come back when your plan renews.");
  const credits = creditsOf(tiers);
  // Reserved first, so two batches at once can never spend the same credits; given back if planning fails.
  const { periodStart } = await consumeUsage(owner.userId, "image", credits);
  const batchId = globalThis.crypto.randomUUID();
  try {
    const recent = await prisma.imageConcept.findMany({ where: { businessId: owner.businessId }, orderBy: { createdAt: "desc" }, take: 60, select: { pattern: true, shot: true, light: true, layout: true, title: true, scene: true } });
    const slots = directBatch({ tiers, recent, photoCount: loaded.photos.length, facts: { reviews: loaded.reviews.length > 0, price: loaded.hasPrice }, seed: batchId, prefer: patternsFromBrief(request.brief) });
    const input: PlannerInput = { business: loaded.facts, subject: loaded.subject, brief: request.brief?.trim() || null, reviews: loaded.reviews, slots, recent: recent.slice(0, 30).map((r) => `${r.title}: ${r.scene}`.slice(0, 200)) };
    const concepts = await writeConcepts(owner, input);
    const captions = await captionBatch(owner, {
      businessName: loaded.facts.name,
      language: loaded.facts.language,
      voice: loaded.facts.voice,
      facts: [loaded.subject?.price, loaded.subject?.description, ...(loaded.subject?.sellingPoints ?? []), loaded.facts.description, request.brief],
      concepts,
    });
    await prisma.imageConcept.createMany({
      data: slots.map((slot, i) => ({
        businessId: owner.businessId,
        batchId,
        source: request.source,
        subjectId: request.subjectId ?? null,
        pattern: slot.pattern,
        shot: slot.shot,
        light: slot.light,
        layout: slot.layout,
        treatment: slot.treatment,
        title: concepts[i].title,
        scene: concepts[i].scene,
        headline: concepts[i].headline,
        subline: concepts[i].subline,
        cta: concepts[i].cta,
        prompt: concepts[i].prompt,
        planner: concepts[i].planner,
        photoPath: slot.photoIndex === null ? null : loaded.photos[slot.photoIndex],
        tier: slot.tier,
        aspectRatio: request.aspectRatio,
        credits: TIER_CREDITS[slot.tier],
        creditPeriod: periodStart,
        caption: captions[i] ?? null,
      })),
    });
  } catch (error) {
    await refundUsage(owner.userId, "image", periodStart, credits).catch((e) => logError(e, { source: "image-engine.refund", businessId: owner.businessId }));
    throw error;
  }
  return { batchId, count: tiers.length, credits, pro: tiers.filter((t) => t === "pro").length };
}


/**
 * Paints the next planned picture of the batch (one per call; two calls at once paint two different pictures):
 * Painter, then Checker, then at most one Editor fix. Returns null when nothing is left to paint.
 */
export async function paintNext(owner: Owner, batchId: string, now: Date = new Date()): Promise<{ id: string; status: "done" | "failed" } | null> {
  const row = await prisma.imageConcept.findFirst({
    where: { batchId, businessId: owner.businessId, OR: [{ status: "planned" }, { status: "painting", paintingUntil: { lt: now } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!row) return null;
  const { count: claimed } = await prisma.imageConcept.updateMany({
    where: { id: row.id, status: row.status, paintingUntil: row.paintingUntil },
    data: { status: "painting", paintingUntil: new Date(now.getTime() + PAINT_LEASE_MS) },
  });
  if (claimed === 0) return paintNext(owner, batchId, now);

  try {
    const loaded = await loadFacts(owner, row.subjectId);
    const model = tierModel(row.tier as Tier);
    const aspectRatio = row.aspectRatio as AspectRatio;
    const prompt = painterPrompt({
      businessName: loaded.facts.name,
      aspectRatio,
      concept: row,
      layout: row.layout,
      treatment: row.treatment as Treatment,
      hasPhoto: !!row.photoPath,
      hasLogo: !!loaded.business.logoUrl,
      productText: loaded.subject ? `${loaded.subject.name}: ${loaded.subject.description ?? ""}` : loaded.facts.description,
      colors: loaded.facts.colors,
    });
    const owned = { userId: owner.userId, businessId: owner.businessId, subjectId: row.subjectId, service: owner.service };
    let made = await createEngineDesign({ ...owned, prompt, model, aspectRatio, usePhotoPath: row.photoPath, useLogo: true });
    const expected = { headline: row.headline, subline: row.subline, cta: row.cta, productShown: !!row.photoPath && row.treatment !== "line", product: loaded.subject?.name ?? loaded.facts.name };
    let verdict = await checkPicture(owner, made, expected);
    let fixed = false;
    if (!verdict.ok && verdict.fix) {
      // The Editor's one try; the better of the two pictures is kept (the other is removed).
      try {
        const edited = await createEngineDesign({ ...owned, prompt: `Edit this advert. ${verdict.fix}`, model, aspectRatio, editOf: made.path });
        const second = await checkPicture(owner, edited, expected);
        if (second.problems.length <= verdict.problems.length) {
          await deleteDesign(owner.userId, made.id).catch(() => undefined);
          made = edited;
          verdict = second;
          fixed = true;
        } else {
          await deleteDesign(owner.userId, edited.id).catch(() => undefined);
        }
      } catch (error) {
        await logError(error, { source: "image-engine.editor", level: "warn", businessId: owner.businessId });
      }
    }
    await prisma.imageConcept.update({
      where: { id: row.id },
      data: { status: "done", paintingUntil: null, designId: made.id, path: made.path, check: { ok: verdict.ok, problems: verdict.problems, ran: verdict.ran }, fixed },
    });
    return { id: row.id, status: "done" };
  } catch (error) {
    const message = error instanceof DesignError || error instanceof EngineError ? error.message : "This picture could not be made. Its credits were given back.";
    if (!(error instanceof DesignError)) await logError(error, { source: "image-engine.paint", businessId: owner.businessId });
    await prisma.imageConcept.update({ where: { id: row.id }, data: { status: "failed", paintingUntil: null, error: message } });
    if (row.creditPeriod) await refundUsage(owner.userId, "image", row.creditPeriod, row.credits).catch((e) => logError(e, { source: "image-engine.refund", businessId: owner.businessId }));
    return { id: row.id, status: "failed" };
  }
}

export type BatchPicture = {
  id: string;
  status: string;
  pattern: string;
  title: string;
  headline: string;
  tier: string;
  credits: number;
  path: string | null;
  designId: string | null;
  caption: string | null;
  problems: string[];
  fixed: boolean;
  rating: number | null;
  error: string | null;
};

/** A batch's pictures, in order, for the screen. */
export async function batchPictures(businessId: string, batchId: string): Promise<BatchPicture[]> {
  const rows = await prisma.imageConcept.findMany({ where: { businessId, batchId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    pattern: r.pattern,
    title: r.title,
    headline: r.headline,
    tier: r.tier,
    credits: r.credits,
    path: r.path,
    designId: r.designId,
    caption: r.caption,
    problems: Array.isArray((r.check as { problems?: unknown } | null)?.problems) ? ((r.check as { problems: string[] }).problems) : [],
    fixed: r.fixed,
    rating: r.rating,
    error: r.error,
  }));
}

/** Like or dislike a picture: the memory keeps it for the Director (a disliked pattern comes back later). */
export async function ratePicture(businessId: string, id: string, rating: 1 | -1 | null): Promise<void> {
  await prisma.imageConcept.updateMany({ where: { id, businessId }, data: { rating } });
}

/** The owner's "change this": the Editor makes a changed copy (the picture's tier credits; Lite 1, Pro 4). */
export async function editPicture(owner: Owner, id: string, instruction: string): Promise<BatchPicture> {
  const text = instruction.replace(/\s+/g, " ").trim().slice(0, 400);
  if (text.length < 3) throw new EngineError("Say what to change, for example: make the headline bigger.");
  const row = await prisma.imageConcept.findFirst({ where: { id, businessId: owner.businessId, status: "done" } });
  if (!row?.path) throw new EngineError("That picture is not ready yet.");
  const credits = TIER_CREDITS[row.tier as Tier];
  const { periodStart } = await consumeUsage(owner.userId, "image", credits);
  try {
    const made = await createEngineDesign({
      userId: owner.userId,
      businessId: owner.businessId,
      subjectId: row.subjectId,
      service: owner.service,
      prompt: `Edit this advert: ${text}. Keep the product, the brand and everything not mentioned exactly the same. Any words must stay spelled exactly.`,
      model: tierModel(row.tier as Tier),
      aspectRatio: row.aspectRatio as AspectRatio,
      editOf: row.path,
      limited: true,
    });
    await prisma.imageConcept.update({ where: { id: row.id }, data: { designId: made.id, path: made.path } });
    return (await batchPictures(owner.businessId, row.batchId)).find((p) => p.id === row.id)!;
  } catch (error) {
    await refundUsage(owner.userId, "image", periodStart, credits).catch(() => undefined);
    throw error;
  }
}
