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
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { featureStatus } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { readKnowledge } from "@/lib/brand/schemas";
import { getVoice } from "@/lib/brand/voices";
import { colorName } from "@/lib/designs/prompt";
import { createEngineDesign, deleteDesign, DesignError } from "@/lib/designs/service";
import type { AspectRatio } from "@/lib/designs/layout";
import { formatPrice } from "@/lib/knowledge/products";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeUsage, getUsageSummary, refundUsage } from "@/lib/usage";
import { knownCountry, safePhrase } from "@/lib/visuals/people";
import { captionBatch } from "./captioner";
import { checkPicture } from "./check";
import { chooseTiers, creditsOf, directBatch, patternsFromBrief, postTier, PRO_EVERY, TIER_CREDITS, type Quality, type Tier } from "./director";
import { painterPrompt } from "./painter-prompt";
import { writeConcepts } from "./planner";
import type { Treatment } from "./patterns";
import { fixImageWords, type BusinessFacts, type PlannerInput, type SubjectFacts } from "./prompter";
import { labLanguage } from "@/lib/training-lab/language-reader";
import { labFor } from "@/lib/training-lab/reader";
import { sectorFromText } from "@/lib/video-engine/brain/select";

export class EngineError extends Error {}

type Owner = { userId: string; businessId: string; service?: boolean };
export type BatchSource = "designs" | "content" | "daily" | "autopilot";
export type BatchRequest = { source: BatchSource; subjectId?: string | null; brief?: string | null; count: number; quality: Quality; aspectRatio: AspectRatio };

/** How long one step holds a picture: the longest step is one image (120 s budget). */
export const PAINT_LEASE_MS = 6 * 60 * 1000;
export const MAX_BATCH = 20;

/** The Painter's model for each tier (env to change them). */
export function tierModel(tier: Tier): string {
  return tier === "pro" ? (process.env.GEMINI_IMAGE_PRO_MODEL || "gemini-3-pro-image") : (process.env.GEMINI_IMAGE_LITE_MODEL || "gemini-3.1-flash-image");
}

/** The AI image credits the company has left this period. */
export async function creditsLeft(userId: string): Promise<number> {
  const usage = await getUsageSummary(userId);
  return Math.max(0, (usage.limits.image ?? 0) - (usage.used.image ?? 0));
}

export async function loadFacts(owner: Owner, subjectId: string | null | undefined) {
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
    const recent = await prisma.imageConcept.findMany({ where: { businessId: owner.businessId }, orderBy: { createdAt: "desc" }, take: 60, select: { pattern: true, shot: true, light: true, layout: true, camera: true, title: true, scene: true } });
    const slots = directBatch({ tiers, recent, photoCount: loaded.photos.length, facts: { reviews: loaded.reviews.length > 0, price: loaded.hasPrice }, seed: batchId, prefer: patternsFromBrief(request.brief) });
    // What the owner's Training Lab teaches for this kind of business and language: picture examples for the Prompter,
    // posts and Kinyarwanda recordings for the Captioner. An empty Lab or an error changes nothing. The image engine has
    // no sector of its own; it is read from the facts the way the reel engine does.
    const sector = sectorFromText([loaded.facts.industry, loaded.facts.description, loaded.subject?.name, loaded.subject?.description].filter(Boolean).join(" "));
    const [lab, captionLab, languageExtra] = await Promise.all([
      labFor({ engine: "image", kinds: ["image"], sector, language: loaded.facts.language }),
      labFor({ engine: "post", kinds: ["image", "voice"], sector, language: loaded.facts.language }),
      labLanguage(loaded.facts.language),
    ]);
    const input: PlannerInput = { business: loaded.facts, subject: loaded.subject, brief: request.brief?.trim() || null, reviews: loaded.reviews, slots, recent: recent.slice(0, 30).map((r) => `${r.title}: ${r.scene}`.slice(0, 200)), lab: { examples: lab.examples, avoid: lab.avoid } };
    // The run log keeps which Lab examples each writer read and the batch they were for (the Team page, ratings).
    const concepts = await writeConcepts(owner, input, { exampleIds: lab.exampleIds, resultRef: `batch:${batchId}` });
    const captions = await captionBatch(owner, {
      businessName: loaded.facts.name,
      language: loaded.facts.language,
      voice: loaded.facts.voice,
      facts: [loaded.subject?.price, loaded.subject?.description, ...(loaded.subject?.sellingPoints ?? []), loaded.facts.description, request.brief],
      concepts,
      lab: { examples: captionLab.examples, avoid: captionLab.avoid, phrases: captionLab.phrases },
    }, { exampleIds: captionLab.exampleIds, resultRef: `batch:${batchId}` });
    // The owner's Kinyarwanda spellings fixed in the words on the picture and in the captions (free: no rewrite, no retry).
    const polished = fixImageWords(concepts, captions, languageExtra, [loaded.facts.name, loaded.subject?.name]);
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
        camera: slot.camera,
        treatment: slot.treatment,
        title: polished.concepts[i].title,
        scene: polished.concepts[i].scene,
        headline: polished.concepts[i].headline,
        subline: polished.concepts[i].subline,
        cta: polished.concepts[i].cta,
        prompt: polished.concepts[i].prompt,
        planner: polished.concepts[i].planner,
        photoPath: slot.photoIndex === null ? null : loaded.photos[slot.photoIndex],
        tier: slot.tier,
        aspectRatio: request.aspectRatio,
        credits: TIER_CREDITS[slot.tier],
        creditPeriod: periodStart,
        caption: polished.captions[i] ?? null,
      })),
    });
  } catch (error) {
    await refundUsage(owner.userId, "image", periodStart, credits).catch((e) => logError(e, { source: "image-engine.refund", businessId: owner.businessId }));
    throw error;
  }
  return { batchId, count: tiers.length, credits, pro: tiers.filter((t) => t === "pro").length };
}


/**
 * The steps of one picture, one AI call each, so no server call runs long (bupulse.com answers within 60 s on
 * Netlify; a Pro picture alone takes about 40 s): planned, then "painting" (the Painter), "painted" (the Checker),
 * "fixing" (the Editor's one try, when the check asked for a fix), "edited" (the Checker on the fix), then done or
 * failed. Each step saves the row, so the next call (or another painter) carries on from the database.
 */
export const WORKING_STATUSES = ["planned", "painting", "painted", "fixing", "edited"] as const;

/** Whether a picture is still being made (any step before done or failed). */
export function isWorking(status: string): boolean {
  return (WORKING_STATUSES as readonly string[]).includes(status);
}

/**
 * Takes the next step of the batch's next unfinished picture that no other call holds (two calls at once work on two
 * different pictures). Returns null when no picture is free to step: all done, or the rest held by other calls.
 */
export async function paintNext(owner: Owner, batchId: string, now: Date = new Date()): Promise<{ id: string; status: "done" | "failed" | "working" } | null> {
  const row = await prisma.imageConcept.findFirst({
    where: { batchId, businessId: owner.businessId, status: { in: [...WORKING_STATUSES] }, OR: [{ paintingUntil: null }, { paintingUntil: { lt: now } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!row) return null;
  const status = row.status === "planned" ? "painting" : row.status;
  const { count: claimed } = await prisma.imageConcept.updateMany({
    where: { id: row.id, status: row.status, paintingUntil: row.paintingUntil },
    data: { status, paintingUntil: new Date(now.getTime() + PAINT_LEASE_MS) },
  });
  if (claimed === 0) return paintNext(owner, batchId, now);
  const { outcome } = await stepRow(owner, { ...row, status });
  return { id: row.id, status: outcome };
}

type ConceptRow = NonNullable<Awaited<ReturnType<typeof prisma.imageConcept.findFirst>>>;
type StoredCheck = { ok: boolean; problems: string[]; ran: boolean; fix?: string | null; edit?: { id: string; path: string } | null };

/** A painted picture's bytes, for the Checker in a later step. */
async function designBytes(path: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const { data, error } = await createAdminClient().storage.from("designs").download(path);
  if (error || !data) throw new EngineError("This picture could not be read back to check it. Its credits were given back.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, mimeType: bytes[0] === 0x89 ? "image/png" : bytes[0] === 0x52 ? "image/webp" : "image/jpeg" };
}

/**
 * One step of a picture whose step the caller holds (see WORKING_STATUSES): saves the row and frees it for the next
 * step. A failure gives the picture's credits back. Never throws.
 */
async function stepRow(owner: Owner, row: ConceptRow): Promise<{ outcome: "done" | "failed" | "working"; row: ConceptRow }> {
  const save = async (data: Prisma.ImageConceptUpdateInput) => (await prisma.imageConcept.update({ where: { id: row.id }, data: { paintingUntil: null, ...data } })) as ConceptRow;
  try {
    const loaded = await loadFacts(owner, row.subjectId);
    const model = tierModel(row.tier as Tier);
    const aspectRatio = row.aspectRatio as AspectRatio;
    const owned = { userId: owner.userId, businessId: owner.businessId, subjectId: row.subjectId, service: owner.service };
    const expected = { headline: row.headline, subline: row.subline, cta: row.cta, productShown: !!row.photoPath && row.treatment !== "line", product: loaded.subject?.name ?? loaded.facts.name };
    const check = (row.check ?? null) as StoredCheck | null;
    const finish = (designId: string, path: string, verdict: StoredCheck, fixed: boolean) =>
      save({ status: "done", designId, path, check: { ok: verdict.ok, problems: verdict.problems, ran: verdict.ran }, fixed });

    if (row.status === "painting") {
      // The Painter.
      const prompt = painterPrompt({
        businessName: loaded.facts.name,
        aspectRatio,
        concept: row,
        layout: row.layout,
        camera: row.camera || "a 35mm documentary photo (available light)",
        treatment: row.treatment as Treatment,
        hasPhoto: !!row.photoPath,
        hasLogo: !!loaded.business.logoUrl,
        productText: loaded.subject ? `${loaded.subject.name}: ${loaded.subject.description ?? ""}` : loaded.facts.description,
        colors: loaded.facts.colors,
      });
      const made = await createEngineDesign({ ...owned, prompt, model, aspectRatio, usePhotoPath: row.photoPath, useLogo: true });
      return { outcome: "working", row: await save({ status: "painted", designId: made.id, path: made.path }) };
    }
    if (row.status === "painted") {
      // The Checker: a picture it passes, or one it cannot say how to fix, is done.
      const verdict = await checkPicture(owner, await designBytes(row.path!), expected);
      if (verdict.ok || !verdict.fix) return { outcome: "done", row: await finish(row.designId!, row.path!, verdict, false) };
      return { outcome: "working", row: await save({ status: "fixing", check: { ok: false, problems: verdict.problems, ran: verdict.ran, fix: verdict.fix } }) };
    }
    if (row.status === "fixing") {
      // The Editor's one try; when it fails, the first picture is kept with what the Checker saw.
      try {
        const edited = await createEngineDesign({ ...owned, prompt: `Edit this advert. ${check?.fix ?? ""}`, model, aspectRatio, editOf: row.path });
        return { outcome: "working", row: await save({ status: "edited", check: { ...check!, edit: { id: edited.id, path: edited.path } } }) };
      } catch (error) {
        await logError(error, { source: "image-engine.editor", level: "warn", businessId: owner.businessId });
        return { outcome: "done", row: await finish(row.designId!, row.path!, check ?? { ok: false, problems: [], ran: true }, false) };
      }
    }
    if (row.status === "edited" && check?.edit) {
      // The Checker on the fix: the better of the two pictures is kept (the other is removed).
      const second = await checkPicture(owner, await designBytes(check.edit.path), expected);
      if (second.problems.length <= check.problems.length) {
        await deleteDesign(owner.userId, row.designId!).catch(() => undefined);
        return { outcome: "done", row: await finish(check.edit.id, check.edit.path, second, true) };
      }
      await deleteDesign(owner.userId, check.edit.id).catch(() => undefined);
      return { outcome: "done", row: await finish(row.designId!, row.path!, check, false) };
    }
    throw new Error(`An image concept in an unknown step: ${row.status}`);
  } catch (error) {
    const message = error instanceof DesignError || error instanceof EngineError ? error.message : "This picture could not be made. Its credits were given back.";
    if (!(error instanceof DesignError)) await logError(error, { source: "image-engine.paint", businessId: owner.businessId });
    const failed = await save({ status: "failed", error: message });
    if (row.creditPeriod) await refundUsage(owner.userId, "image", row.creditPeriod, row.credits).catch((e) => logError(e, { source: "image-engine.refund", businessId: owner.businessId }));
    return { outcome: "failed", row: failed };
  }
}

/**
 * One finished picture for a post (Create post, Daily posts, Studio, Autopilot: lib/visuals drawSlide), no template:
 * the Director picks a pattern, shot, light, layout and camera the company has not had lately, the Prompter writes it
 * from the post (its brief and caption), then the Painter, Checker and Editor. Pro when the credits allow and none of
 * the company's last pictures was Pro, else Lite. Throws EngineError when it cannot start (not in the plan, no credits:
 * the caller then uses the owner's own photo); a picture that fails after that gives its credits back and returns null.
 */
export async function paintOne(owner: Owner, request: { source: BatchSource; subjectId?: string | null; aspectRatio: AspectRatio; photoPath?: string | null; brief?: string | null; caption?: string | null }): Promise<{ id: string; designId: string; path: string } | null> {
  if ((await featureStatus(owner.businessId, "aiPhotos")) !== "ok") throw new EngineError("AI pictures are not in your plan.");
  const loaded = await loadFacts(owner, request.subjectId);
  const recent = await prisma.imageConcept.findMany({ where: { businessId: owner.businessId }, orderBy: { createdAt: "desc" }, take: 60, select: { pattern: true, shot: true, light: true, layout: true, camera: true, title: true, scene: true, tier: true, planner: true } });
  const tier = postTier(await creditsLeft(owner.userId), recent.slice(0, PRO_EVERY - 1).map((r) => r.tier as Tier));
  if (!tier) throw new EngineError("You have no AI image credits left this month.");
  const credits = TIER_CREDITS[tier];
  const { periodStart } = await consumeUsage(owner.userId, "image", credits);
  const photos = request.photoPath ? [request.photoPath] : loaded.photos;
  const batchId = globalThis.crypto.randomUUID();
  try {
    const [slot] = directBatch({ tiers: [tier], recent, photoCount: photos.length, facts: { reviews: loaded.reviews.length > 0, price: loaded.hasPrice }, seed: batchId, prefer: patternsFromBrief(request.brief) });
    const brief = [request.brief?.trim(), request.caption?.trim() ? `The post's caption: ${request.caption.trim().slice(0, 600)}` : null].filter(Boolean).join("\n") || null;
    const input: PlannerInput = { business: loaded.facts, subject: loaded.subject, brief, reviews: loaded.reviews, slots: [slot], recent: recent.slice(0, 30).map((r) => `${r.title}: ${r.scene}`.slice(0, 200)) };
    // Both writers take turns: Claude for one picture, Gemini for the next.
    const [concept] = await writeConcepts(owner, input, { only: recent[0]?.planner === "claude" ? "gemini" : undefined });
    const row = await prisma.imageConcept.create({
      data: {
        businessId: owner.businessId,
        batchId,
        source: request.source,
        subjectId: request.subjectId ?? null,
        pattern: slot.pattern,
        shot: slot.shot,
        light: slot.light,
        layout: slot.layout,
        camera: slot.camera,
        treatment: slot.treatment,
        title: concept.title,
        scene: concept.scene,
        headline: concept.headline,
        subline: concept.subline,
        cta: concept.cta,
        prompt: concept.prompt,
        planner: concept.planner,
        photoPath: slot.photoIndex === null ? null : photos[slot.photoIndex],
        tier,
        aspectRatio: request.aspectRatio,
        credits,
        creditPeriod: periodStart,
        status: "painting",
        paintingUntil: new Date(Date.now() + PAINT_LEASE_MS),
      },
    });
    // Every step in this call (the callers wait for the picture); each step still saves, so the row shows how far it got.
    let step: Awaited<ReturnType<typeof stepRow>> = { outcome: "working", row };
    while (step.outcome === "working") step = await stepRow(owner, { ...step.row, paintingUntil: new Date(Date.now() + PAINT_LEASE_MS) });
    return step.outcome === "done" ? { id: row.id, designId: step.row.designId!, path: step.row.path! } : null;
  } catch (error) {
    // Only before the row exists (stepRow never throws and refunds on its own).
    await refundUsage(owner.userId, "image", periodStart, credits).catch(() => undefined);
    throw error;
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
