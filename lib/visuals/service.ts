// Content visuals on the server (docs/CONTENT_VISUALS.md): plan them with the content, draw the slides with the
// designs engine a few at a time, let the owner change them, and take the video the browser rendered.
// A visual never fails the content it belongs to: every step falls back to something free.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { companyCallAllowed, companySpendThisMonth } from "@/lib/ai/budget";
import { AIProviderError } from "@/lib/ai/types";
import { createAiDesign, createTemplateDesign, DesignError } from "@/lib/designs/service";
import { isOwnDesignPath, isOwnPhotoPath } from "@/lib/designs/assets";
import { isPackId } from "@/lib/designs/packs";
import { buildSceneBrief } from "@/lib/designs/photo-scene";
import { isTemplateId } from "@/lib/designs/templates/registry";
import { featureStatus, hasFeature } from "@/lib/entitlements";
import { KnowledgeError } from "@/lib/knowledge/service";
import { assertPlatformRoom, MediaError, mediaUsage } from "@/lib/media/service";
import { quotaProblem, type MediaUsage } from "@/lib/media/rules";
import { RateLimitError } from "@/lib/rate-limit";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { createSignedUploadUrl } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeUsage, getUsageSummary, UsageLimitError } from "@/lib/usage";
import { directVisual } from "./art-director";
import { chooseSources, fallbackPlan, listItems, PHOTO_TEMPLATES, readImagePlan, slideText, type DirectionContext } from "./direction";
import { mediaForPost } from "./post-media";
import { billableSeconds } from "./timeline";
import { VIDEO_LIMITS, VISUAL_LIMITS, type ImagePlan, type VideoPlan, type VisualItem, type VisualKind, type VisualSlide } from "./types";
import { videoDurationMs } from "./duration";
import { assignDesigns, chooseLook, recentChoices, slideHasPhoto, usableDesign } from "./designs";
import { moodFor } from "@/lib/music/tracks";
import { trackForVideo } from "@/lib/music/service";
import type { Audience } from "./people";
import { buildVideoPlan, readVideoPlan, withSceneTexts } from "./video-plan";

/** A problem the owner can read and act on (a KnowledgeError, so the content actions show its message). */
export class VisualError extends KnowledgeError {}

export type Owner = {
  userId: string;
  businessId: string;
  /** Background jobs (Autopilot's cron) have no session: Storage goes through the service key. */
  service?: boolean;
};

const json = (value: unknown) => value as Prisma.InputJsonValue;

// ---- what is allowed ----

/**
 * Whether an AI photo may be made now: the aiPhotos feature, an image credit left and the company's AI allowance not
 * reached. Checked before asking for one, so the art director plans free pictures instead; the paid call still
 * checks everything again (consumeUsage, withLedger), so a race only costs a fallback.
 */
export async function aiPhotosAvailable(owner: Owner): Promise<boolean> {
  return (await aiPhotosStatus(owner)).allowed;
}

/** The 1st of next month, 00:00 UTC: when the company AI allowance starts again. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** "AI images for this month used — next refill on 1 November." */
export function aiExhaustedNote(refillAt: string | null): string {
  if (!refillAt) return "AI images for this month used. Your real photos and brand designs are used instead.";
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(refillAt));
  return `AI images for this month used — next refill on ${day}. Your real photos and brand designs are used instead.`;
}

/**
 * Like aiPhotosAvailable, with the reason: the visual says when the plan's AI images are used up (and when they come
 * back), so the owner knows why the post shows a designed picture.
 */
export async function aiPhotosStatus(owner: Owner): Promise<{ allowed: boolean; exhausted: { refillAt: string | null } | null }> {
  try {
    if (!(await hasFeature(owner.businessId, "aiPhotos"))) return { allowed: false, exhausted: null };
    const [usage, spend] = await Promise.all([getUsageSummary(owner.userId), companySpendThisMonth(owner.businessId)]);
    if (usage.used.image >= usage.limits.image) return { allowed: false, exhausted: { refillAt: usage.resetsAt ? new Date(usage.resetsAt).toISOString() : null } };
    // The company's dollar allowance can stop images before the count does: the same message, refilled on the 1st.
    if (!companyCallAllowed(spend, "image")) return { allowed: false, exhausted: { refillAt: nextMonthStart(new Date()).toISOString() } };
    return { allowed: true, exhausted: null };
  } catch {
    return { allowed: false, exhausted: null };
  }
}

/** The company's country and first personas, so the people in AI photos look like its customers. */
export async function audienceFor(businessId: string): Promise<Audience | undefined> {
  try {
    const [business, personas] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId }, select: { country: true } }),
      prisma.persona.findMany({ where: { businessId }, orderBy: { position: "asc" }, take: 3, select: { ageRange: true, gender: true, location: true, occupation: true } }),
    ]);
    return { country: business?.country ?? null, personas: personas ?? [] };
  } catch {
    return undefined;
  }
}

/** Whether the company's plan has video: the `video` feature and some video seconds a month. */
export async function videoAvailable(businessId: string): Promise<boolean> {
  try {
    if ((await featureStatus(businessId, "video")) !== "ok") return false;
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { userId: true } });
    return !!business && (await getUsageSummary(business.userId)).limits.videoSeconds > 0;
  } catch {
    return false;
  }
}

/** Whether one of the company's connected networks publishes carousels. With none connected yet: yes (Instagram and Facebook do). */
export async function carouselNetworks(businessId: string): Promise<boolean> {
  const connections = await prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, select: { provider: true }, take: 50 });
  if (connections.length === 0) return true;
  return connections.some((c) => isNetwork(c.provider) && getProvider(c.provider).rules.formats.includes("CAROUSEL"));
}

// ---- planning ----

export interface PlanInput {
  owner: Owner;
  /** The GeneratedContent the visuals belong to, or an Autopilot post group. */
  target: { contentId: string } | { groupId: string };
  subjectId?: string | null;
  business: { name: string; tone: string | null; industry: string | null; brandColors: string[] };
  subjectType: string;
  title: string;
  price?: string | null;
  caption: string;
  headlines: string[];
  videoScript?: string | null;
  /** Album photo paths, cover first. */
  photos: string[];
  /** Plan the image or carousel (default true). */
  image?: boolean;
  /** Make a video plan too (the content is a video, or has a script, and the plan has video). */
  video: boolean;
  carouselAllowed: boolean;
  aiAllowed: boolean;
  maxSlides?: number;
  /** The company's country and personas, for the people in AI photos. */
  audience?: Audience;
  /** AI images ran out this month: the plan says so (and when they come back). */
  aiExhausted?: { refillAt: string | null };
  /** A content pack post's angle (lib/studio/angles.ts): what it says and what its people photo shows. */
  angle?: { id?: string; label: string; people: string } | null;
  /** The image plan, when the caller already asked the art director (content packs make all their plans first). */
  precomputed?: ImagePlan;
  /** Skip the AI art director (the rules choose). */
  rulesOnly?: boolean;
}

const mimeOf = (path: string) => (/\.png$/i.test(path) ? "image/png" : /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : null);

export function directionContext(input: Omit<PlanInput, "owner" | "target" | "video" | "image" | "subjectId" | "aiExhausted" | "precomputed">): DirectionContext {
  return {
    subjectType: input.subjectType,
    title: input.title,
    price: input.price,
    caption: input.caption,
    headlines: input.headlines,
    business: input.business,
    photos: input.photos.map((path) => ({ path, mimeType: mimeOf(path) })),
    carouselAllowed: input.carouselAllowed,
    aiAllowed: input.aiAllowed,
    maxSlides: input.maxSlides,
    audience: input.audience,
    angle: input.angle,
  };
}

function kindOf(plan: ImagePlan): VisualKind {
  return plan.slides.length > 1 ? "carousel" : "image";
}

/** Designs and video looks of the business's latest visuals, newest first (never fails: none on error). */
export async function recentVisualChoices(businessId: string): Promise<{ designs: string[]; looks: string[] }> {
  try {
    const rows = await prisma.contentVisual.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 24, select: { plan: true } });
    return recentChoices((rows ?? []).map((r) => r.plan));
  } catch {
    return { designs: [], looks: [] };
  }
}

/**
 * Plans the visuals of new content: the art director's image or carousel, and a video plan when asked. Saves them as
 * "pending"; the slides are drawn by renderImageStep (the content screen calls it, Autopilot right away).
 * Never throws: a failure is logged and the content simply has no visual yet ("Make the picture" on the screen).
 */
export async function planVisuals(input: PlanInput): Promise<{ image: string | null; video: string | null }> {
  const out = { image: null as string | null, video: null as string | null };
  try {
    const ctx = directionContext(input);
    const directed = input.precomputed ?? (input.rulesOnly || input.image === false ? fallbackPlan(ctx) : await directVisual(ctx, input.owner));
    // BuPulse picks each slide's design and the video's look, avoiding the ones the business used lately.
    const recent = await recentVisualChoices(input.owner.businessId);
    const seed = "contentId" in input.target ? input.target.contentId : input.target.groupId;
    const plan = assignDesigns(directed, { recent: recent.designs, seed });
    if (input.aiExhausted) {
      plan.aiExhausted = input.aiExhausted;
      plan.notes = [aiExhaustedNote(input.aiExhausted.refillAt), ...plan.notes];
    }
    if (input.image !== false) {
      const row = await prisma.contentVisual.create({
        data: { businessId: input.owner.businessId, ...input.target, kind: kindOf(plan), status: "pending", plan: json(plan), items: json([]) },
        select: { id: true },
      });
      out.image = row.id;
    }
    if (input.video) {
      const video = buildVideoPlan({
        script: input.videoScript ?? "",
        hook: input.headlines[0] || input.title,
        businessName: input.business.name,
        photos: input.photos,
        pack: plan.pack,
        colors: input.business.brandColors,
        look: chooseLook({ pack: plan.pack, template: plan.slides[0]?.template, tips: listItems(input.caption).length >= 3, hasPhoto: input.photos.length > 0, recent: recent.looks, seed }),
      });
      // Music from the library, by the art director's mood (else the angle's or the brand voice's). Empty library: none.
      const mood = plan.mood ?? moodFor({ angle: input.angle?.id, tone: input.business.tone });
      video.mood = mood;
      video.music = await trackForVideo(mood, "contentId" in input.target ? input.target.contentId : input.target.groupId);
      const v = await prisma.contentVisual.create({
        data: { businessId: input.owner.businessId, ...input.target, kind: "video", status: "pending", plan: json(video), items: json([]) },
        select: { id: true },
      });
      out.video = v.id;
    }
  } catch (error) {
    await logError(error, { source: "visuals.plan", level: "warn", businessId: input.owner.businessId });
  }
  return out;
}

// ---- drawing ----

async function ownVisual(businessId: string, id: string) {
  const row = await prisma.contentVisual.findFirst({ where: { id, businessId } });
  if (!row) throw new VisualError("We could not find that picture.");
  return row;
}

/** The subject (product or campaign) a visual's designs are filed under. */
async function subjectOf(row: { contentId: string | null; groupId: string | null; businessId: string }): Promise<string | null> {
  if (row.contentId) {
    const c = await prisma.generatedContent.findFirst({ where: { id: row.contentId, businessId: row.businessId }, select: { productId: true, campaignId: true } });
    return c?.productId ?? c?.campaignId ?? null;
  }
  if (row.groupId) {
    const p = await prisma.post.findFirst({ where: { groupId: row.groupId, businessId: row.businessId }, select: { productId: true, campaignId: true } });
    return p?.productId ?? p?.campaignId ?? null;
  }
  return null;
}

/** Why an AI photo was not made, for the slide's note. */
function aiNote(error: unknown): string {
  if (error instanceof UsageLimitError) return "AI images for this month used, so this slide uses your photo or a brand design.";
  if (error instanceof AIProviderError) return error.message.includes("allowance") ? error.message : "AI photos are paused for a short while, so this slide uses a free design.";
  if (error instanceof RateLimitError) return "You made many AI photos this hour, so this slide uses a free design.";
  return "The AI photo could not be made, so this slide uses a free design.";
}

/** The slide's library design, or one that fits when it has none of this style or it needs the photo that failed. */
function designFor(plan: ImagePlan, slide: VisualSlide, hasPhoto: boolean): string {
  const kept = usableDesign(slide, plan.pack, hasPhoto);
  if (kept) return kept;
  const found = plan.slides.findIndex((s) => s === slide || (s.headline === slide.headline && s.template === slide.template));
  const at = found >= 0 ? found : 0;
  const base = found >= 0 ? plan.slides : [slide];
  const slides = base.map((s, i) => (i === at ? { ...slide, ...(hasPhoto ? {} : { source: "text" as const, aiPhotoPath: null, photoPath: null }) } : s));
  return assignDesigns({ ...plan, slides }, { recent: [], seed: `${slide.headline}#${at}`, only: new Set([at]) }).slides[at].design!;
}

/**
 * How long one drawing call holds a visual: longer than the slowest call can run (the Gemini image request alone may
 * take up to 120 s, then the template and the saves), so a second call never pays for the same AI photo; a crashed
 * call frees it a few minutes later.
 */
export const RENDER_LEASE_MS = 4 * 60 * 1000;

export type DrawState = { aiAllowed: boolean; aiMade: number; maxAi: number };

/**
 * Draws one slide: makes its AI photo first when it needs one (1 image credit, once: the photo is kept for
 * re-styling), then the template. A photo that cannot be drawn falls back to the text design; only a text design
 * that cannot be drawn either is an error.
 */
export async function drawSlide(
  owner: Owner,
  subjectId: string | null,
  plan: ImagePlan,
  slide: VisualSlide,
  state: DrawState,
  /** Saves the slide as soon as its AI photo is paid for, so a failed template draw never loses the photo. */
  onAiPhoto?: (slide: VisualSlide) => Promise<void>,
): Promise<VisualSlide> {
  const next: VisualSlide = { ...slide };
  // A designed carousel slide shows the cover's photo (its AI photo, or its album photo when AI was not possible).
  const cover = plan.slides[0];
  const coverPhoto = slide.useCoverPhoto && cover !== slide ? (cover?.aiPhotoPath ?? (cover?.source === "album" ? cover.photoPath : null)) : null;
  let photo: string | null = slide.source === "album" ? slide.photoPath : slide.source === "ai" ? (slide.aiPhotoPath ?? null) : coverPhoto;
  if (slide.source === "ai" && !slide.aiPhotoPath) {
    if (state.aiAllowed && state.aiMade < state.maxAi) {
      try {
        const scene = buildSceneBrief({ template: slide.template, aspectRatio: plan.aspectRatio, scene: slide.scene, headline: slide.headline });
        const made = await createAiDesign({ ...owner, subjectId, prompt: scene, aspectRatio: plan.aspectRatio, usePhotoPath: slide.photoPath, includePeople: true });
        state.aiMade += 1;
        next.aiPhotoPath = made.path;
        photo = made.path;
        await onAiPhoto?.({ ...next, source: "ai", designId: null, path: null });
      } catch (error) {
        if (error instanceof UsageLimitError || error instanceof RateLimitError || error instanceof AIProviderError) state.aiAllowed = false;
        else if (!(error instanceof DesignError)) await logError(error, { source: "visuals.ai-photo", level: "warn", businessId: owner.businessId });
        next.note = aiNote(error);
        photo = slide.photoPath;
      }
    } else {
      next.note = "AI photos are not available right now, so this slide uses your photo or a free design.";
      photo = slide.photoPath;
    }
    if (!next.aiPhotoPath) next.source = photo ? "album" : "text";
  }

  const draw = (photoPath: string | null) =>
    createTemplateDesign({
      ...owner,
      subjectId,
      template: !photoPath && PHOTO_TEMPLATES.includes(next.template) ? "announcement" : next.template,
      aspectRatio: plan.aspectRatio,
      headline: next.headline,
      subline: next.subline || null,
      chip: next.chip || null,
      kicker: next.kicker,
      photoPath,
      pack: plan.pack,
      design: (next.design = designFor(plan, slide, !!photoPath)),
      step: next.step ?? null,
    });
  let made;
  try {
    made = await draw(photo);
  } catch (error) {
    if (!(error instanceof DesignError) || !photo) throw error;
    made = await draw(null);
    next.note = "That photo could not be drawn (templates need a JPG or PNG), so this slide is a text design.";
  }
  return { ...next, designId: made.id, path: made.path };
}

/** The ordered rendered items of an image plan. */
export function itemsOf(plan: ImagePlan): VisualItem[] {
  return plan.slides.flatMap((s) => (s.path ? [{ designId: s.designId, path: s.path }] : []));
}

/**
 * Draws the slides that are not drawn yet, until done or the time budget is used (Netlify stops a function at 60 s);
 * the screen calls it again while the visual is pending. Ready when every slide is drawn.
 */
export async function renderImageStep(owner: Owner, visualId: string, options: { budgetMs?: number; state?: DrawState } = {}) {
  const first = await ownVisual(owner.businessId, visualId);
  if (first.kind === "video") throw new VisualError("That is a video. Open it to make it.");
  if (!readImagePlan(first.plan)) {
    await prisma.contentVisual.update({ where: { id: first.id }, data: { status: "failed", error: "This picture's plan is damaged. Make it again." } });
    return { status: "failed" as const, plan: null };
  }
  const started = Date.now();
  const budget = options.budgetMs ?? VISUAL_LIMITS.renderStepMs;
  // One drawer at a time (two tabs, a double click): the lease is taken atomically, so an AI photo is paid once.
  const leaseUntil = new Date(started + RENDER_LEASE_MS);
  const { count: claimed } = await prisma.contentVisual.updateMany({
    where: { id: first.id, businessId: owner.businessId, OR: [{ renderingUntil: null }, { renderingUntil: { lt: new Date(started) } }] },
    data: { renderingUntil: leaseUntil },
  });
  if (claimed === 0) return { status: "rendering" as const, plan: readImagePlan(first.plan), items: [], error: "This picture is already being drawn." };
  try {
    return await drawClaimed(owner, visualId, started, budget, options.state);
  } finally {
    // Normally released by the final save; this frees it after an unexpected error too.
    await prisma.contentVisual.updateMany({ where: { id: first.id, renderingUntil: leaseUntil }, data: { renderingUntil: null } }).catch(() => {});
  }
}

/** The drawing itself, once the lease is held. The plan is read again: it may have changed while waiting. */
async function drawClaimed(owner: Owner, visualId: string, started: number, budget: number, given?: DrawState) {
  const row = await ownVisual(owner.businessId, visualId);
  const plan = readImagePlan(row.plan);
  if (!plan) {
    await prisma.contentVisual.update({ where: { id: row.id }, data: { status: "failed", error: "This picture's plan is damaged. Make it again." } });
    return { status: "failed" as const, plan: null };
  }
  const needsAi = plan.slides.some((s) => s.source === "ai" && !s.aiPhotoPath && !s.path);
  const state = given ?? { aiAllowed: needsAi ? await aiPhotosAvailable(owner) : false, aiMade: 0, maxAi: VISUAL_LIMITS.maxAiPhotosPerVisual };
  const subjectId = await subjectOf(row);
  let error: string | null = null;

  for (let i = 0; i < plan.slides.length; i++) {
    if (plan.slides[i].path) continue;
    if (Date.now() - started > budget) break;
    const index = i;
    const keepPhoto = async (slide: VisualSlide) => {
      plan.slides[index] = slide;
      await prisma.contentVisual.update({ where: { id: row.id }, data: { plan: json(plan) } });
    };
    try {
      plan.slides[i] = await drawSlide(owner, subjectId, plan, plan.slides[i], state, keepPhoto);
    } catch (e) {
      if (e instanceof RateLimitError) error = "You made a lot of designs this hour. Try again in a little while.";
      else if (e instanceof DesignError) error = e.message;
      else {
        await logError(e, { source: "visuals.render", businessId: owner.businessId });
        error = "We could not draw this picture. Please try again.";
      }
      break;
    }
  }

  const done = plan.slides.every((s) => s.path);
  const status = done ? "ready" : error ? "failed" : "pending";
  const items = itemsOf(plan);
  await prisma.contentVisual.update({
    where: { id: row.id },
    data: { plan: json(plan), items: json(items), kind: kindOf(plan), status, error, renderingUntil: null, ...(done ? { renderedAt: new Date() } : {}) },
  });
  // An Autopilot group's posts take the redrawn picture.
  if (done && row.groupId) await attachToGroup(owner.businessId, row.groupId, { feed: true }).catch((e) => logError(e, { source: "visuals.attach", level: "warn", businessId: owner.businessId }));
  // Studio's drafted posts of this content take it too (docs/CONTENT.md).
  if (done && row.contentId) await attachToContent(owner.businessId, row.contentId, { feed: true }).catch((e) => logError(e, { source: "visuals.attach", level: "warn", businessId: owner.businessId }));
  // A video planned without photos shows the AI photo once there is one.
  const aiPhoto = plan.slides.find((s) => s.aiPhotoPath)?.aiPhotoPath;
  if (aiPhoto) await lendPhotoToVideo(row, aiPhoto).catch(() => {});
  return { status, plan, items, error };
}

async function lendPhotoToVideo(row: { businessId: string; contentId: string | null; groupId: string | null }, photo: string) {
  const sibling = await prisma.contentVisual.findFirst({ where: { businessId: row.businessId, kind: "video", status: "pending", ...(row.contentId ? { contentId: row.contentId } : { groupId: row.groupId }) } });
  const plan = sibling && readVideoPlan(sibling.plan);
  if (!sibling || !plan || plan.scenes.some((s) => s.photoPath === photo)) return;
  // The people photo opens the video and fills scenes without a photo; the product photos keep the rest (no extra
  // AI image is made for the video).
  const scenes = plan.scenes.map((s, i) => (i === 0 || (!s.photoPath && s.role !== "cta") ? { ...s, photoPath: photo } : s));
  await prisma.contentVisual.update({ where: { id: sibling.id }, data: { plan: json({ ...plan, scenes }) } });
}

// ---- the owner's changes ----

/** Files a post still uses must stay. */
async function inUse(businessId: string, path: string) {
  return (await prisma.post.count({ where: { businessId, mediaPaths: { has: path } } })) > 0;
}

/** Removes slide designs nothing uses any more (AI photos are kept: they were paid for and stay in Designs). */
async function dropDesigns(owner: Owner, slides: VisualSlide[]) {
  const admin = createAdminClient();
  for (const s of slides) {
    if (!s.designId || !s.path || !isOwnDesignPath(owner.userId, s.path)) continue;
    if (await inUse(owner.businessId, s.path)) continue;
    await prisma.design.deleteMany({ where: { id: s.designId, businessId: owner.businessId } }).catch(() => {});
    await admin.storage.from("designs").remove([s.path, `${s.path}.jpg`]).catch(() => {});
  }
}

export interface ImageChanges {
  pack?: string;
  /** The template for every slide (the cover keeps a photo template when it has a photo). */
  template?: string;
  /** New texts per slide, by index. */
  slides?: { index: number; headline?: string; subline?: string; chip?: string }[];
  /** Another album or gallery photo for one slide. */
  swap?: { index: number; photoPath: string };
  /** "New design": every slide gets a different design of the same style; photos (AI ones too) are reused. */
  redesign?: boolean;
}

/** Applies the owner's changes to the plan and marks the changed slides to be drawn again (free templates only). */
export async function updateImageVisual(owner: Owner, visualId: string, changes: ImageChanges) {
  const row = await ownVisual(owner.businessId, visualId);
  const before = readImagePlan(row.plan);
  if (!before || row.kind === "video") throw new VisualError("We could not change that picture.");
  // A drawing in progress would save its plan over these changes.
  if (row.renderingUntil && row.renderingUntil > new Date()) throw new VisualError("This picture is still being drawn. Try again in a moment.");
  const plan: ImagePlan = structuredClone(before);
  const changed = new Set<number>();
  if (changes.pack && isPackId(changes.pack) && changes.pack !== plan.pack) {
    plan.pack = changes.pack;
    plan.slides.forEach((_, i) => changed.add(i));
  }
  if (changes.template) {
    if (!isTemplateId(changes.template)) throw new VisualError("Pick one of the templates.");
    plan.slides.forEach((s, i) => {
      const hasPhoto = !!(s.aiPhotoPath || (s.source === "album" && s.photoPath));
      const template = changes.template === "quote" && s.source === "ai" ? s.template : !hasPhoto && PHOTO_TEMPLATES.includes(changes.template as never) ? "announcement" : changes.template!;
      if (template !== s.template) {
        plan.slides[i] = { ...s, template: template as VisualSlide["template"] };
        changed.add(i);
      }
    });
  }
  for (const edit of changes.slides ?? []) {
    const s = plan.slides[edit.index];
    if (!s) continue;
    const headline = edit.headline === undefined ? s.headline : slideText(edit.headline, VISUAL_LIMITS.headline);
    if (!headline) throw new VisualError("Each slide needs a headline.");
    plan.slides[edit.index] = {
      ...s,
      headline,
      subline: edit.subline === undefined ? s.subline : slideText(edit.subline, VISUAL_LIMITS.subline),
      chip: edit.chip === undefined ? s.chip : slideText(edit.chip, VISUAL_LIMITS.chip),
    };
    changed.add(edit.index);
  }
  if (changes.swap) {
    const s = plan.slides[changes.swap.index];
    if (!s) throw new VisualError("We could not find that slide.");
    if (!isOwnPhotoPath(owner.userId, changes.swap.photoPath)) throw new VisualError("That photo could not be used.");
    const [chosen] = chooseSources([{ source: "album", template: s.template }], { photos: [{ path: changes.swap.photoPath, mimeType: mimeOf(changes.swap.photoPath) }], aiAllowed: false });
    if (chosen.source !== "album") throw new VisualError("Templates need a JPG or PNG photo. Please pick a different one.");
    const template = s.template === "announcement" && changes.swap.index === 0 ? "new-arrival" : s.template;
    plan.slides[changes.swap.index] = { ...s, source: "album", photoPath: changes.swap.photoPath, aiPhotoPath: null, useCoverPhoto: false, template, note: undefined };
    changed.add(changes.swap.index);
    // Designed slides show the cover's photo: a new cover photo redraws them too.
    if (changes.swap.index === 0) plan.slides.forEach((x, i) => x.useCoverPhoto && changed.add(i));
  }
  if (changes.redesign) plan.slides.forEach((_, i) => changed.add(i));
  if (changed.size === 0) return { status: row.status, plan };
  // A new style, template or photo gets a fresh design for the changed slides (text edits keep theirs).
  const redesign = new Set([...changed].filter((i) => {
    const was = before.slides[i];
    const now = plan.slides[i];
    return !!changes.redesign || plan.pack !== before.pack || now.template !== was.template || slideHasPhoto(now) !== slideHasPhoto(was) || !usableDesign(now, plan.pack, slideHasPhoto(now));
  }));
  if (redesign.size) {
    const recent = await recentVisualChoices(owner.businessId);
    // The designs being replaced are avoided too, so "New design" always looks different.
    const current = before.slides.flatMap((s) => (s.design ? [s.design] : []));
    Object.assign(plan, assignDesigns(plan, { recent: [...current, ...recent.designs], seed: `${row.id}:${Date.now()}`, only: redesign }));
  }
  const old = [...changed].map((i) => before.slides[i]);
  for (const i of changed) plan.slides[i] = { ...plan.slides[i], designId: null, path: null };
  await prisma.contentVisual.update({ where: { id: row.id }, data: { plan: json(plan), items: json(itemsOf(plan)), status: "pending", error: null } });
  await dropDesigns(owner, old);
  return { status: "pending" as const, plan };
}

/** Removes a visual: its slide designs (unless a post uses them) and its video file. AI photos stay in Designs. */
export async function removeVisual(owner: Owner, visualId: string) {
  const row = await ownVisual(owner.businessId, visualId);
  await releaseRows(owner, [row]);
}

/** Posts that have not gone out yet: a video they use must stay. */
export const WAITING_STATUSES = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PUBLISHING"] as const;

/**
 * Lets a video file go when its visual goes. A post still waiting to go out keeps it: the visual is moved to that
 * post's group (so the 30-day clean-up finds it later) instead of being deleted. Otherwise the file is removed, even
 * when a published post used it (the post stays, the video stays on the social account). True when the row may go.
 */
async function releaseVideo(businessId: string, row: { id: string; items: unknown }): Promise<boolean> {
  const paths = readItems(row.items).map((i) => i.path).filter((p) => p.split("/")[1] === "videos");
  for (const path of paths) {
    const waiting = await prisma.post.findFirst({ where: { businessId, mediaPaths: { has: path }, status: { in: [...WAITING_STATUSES] } }, select: { groupId: true, id: true } });
    if (waiting) {
      await prisma.contentVisual.update({ where: { id: row.id }, data: { contentId: null, groupId: waiting.groupId ?? waiting.id } });
      return false;
    }
  }
  if (paths.length) await createAdminClient().storage.from("media").remove(paths).catch(() => {});
  return true;
}

async function releaseRows(owner: Owner, rows: { id: string; kind: string; plan: unknown; items: unknown }[]) {
  for (const row of rows) {
    if (row.kind === "video") {
      if (!(await releaseVideo(owner.businessId, row))) continue;
    } else {
      const plan = readImagePlan(row.plan);
      if (plan) await dropDesigns(owner, plan.slides);
    }
    await prisma.contentVisual.deleteMany({ where: { id: row.id, businessId: owner.businessId } });
  }
}

/**
 * A product or campaign is about to be deleted: its content's video files go with it (the rows follow by cascade).
 * Slide designs stay, like the subject's other designs.
 */
export async function releaseSubjectVideos(businessId: string, subject: { productId: string } | { campaignId: string }) {
  const rows = await prisma.contentVisual.findMany({ where: { businessId, kind: "video", content: subject }, select: { id: true, items: true } });
  for (const row of rows) await releaseVideo(businessId, row);
}

/** Before content versions are deleted (pruning): their videos and unused slide designs go too. */
export async function releaseContentVisuals(owner: Owner, contentIds: string[]) {
  if (contentIds.length === 0) return;
  const rows = await prisma.contentVisual.findMany({ where: { businessId: owner.businessId, contentId: { in: contentIds } } });
  await releaseRows(owner, rows);
}

/**
 * An Autopilot group was removed: its video files and visual rows go once no post of the group is left. Its designs
 * stay in Designs, as they always did.
 */
export async function releaseGroupVisuals(owner: Owner, groupId: string) {
  if ((await prisma.post.count({ where: { businessId: owner.businessId, groupId } })) > 0) return;
  const rows = await prisma.contentVisual.findMany({ where: { businessId: owner.businessId, groupId } });
  await releaseRows(owner, rows.map((r) => (r.kind === "video" ? r : { ...r, plan: null })));
}

export function readItems(value: unknown): VisualItem[] {
  return Array.isArray(value) ? value.filter((i): i is VisualItem => !!i && typeof i === "object" && typeof (i as VisualItem).path === "string") : [];
}

// ---- video ----

const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm" } as const;
type VideoType = keyof typeof VIDEO_TYPES;

export function isVideoType(value: unknown): value is VideoType {
  return typeof value === "string" && value in VIDEO_TYPES;
}

/** The first bytes of an MP4 ("ftyp" at offset 4) or a WebM (EBML header). */
export function sniffVideo(head: Uint8Array): VideoType | null {
  if (head.length >= 8 && String.fromCharCode(...head.subarray(4, 8)) === "ftyp") return "video/mp4";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  return null;
}

/** Where a rendered video lives in the media bucket. A new name per render, so a cached old copy is never shown. */
export function videoPath(userId: string, visualId: string, type: VideoType, n = Date.now()): string {
  return `${userId}/videos/${visualId}-${n.toString(36)}.${VIDEO_TYPES[type]}`;
}

export function isOwnVideoPath(userId: string, visualId: string, path: string): boolean {
  return new RegExp(`^${userId.replace(/[^A-Za-z0-9-]/g, "")}/videos/${visualId.replace(/[^A-Za-z0-9-]/g, "")}-[a-z0-9]{4,16}\\.(mp4|webm)$`).test(path);
}

async function videoRow(owner: Owner, visualId: string) {
  const row = await ownVisual(owner.businessId, visualId);
  const plan = row.kind === "video" ? readVideoPlan(row.plan) : null;
  if (!plan) throw new VisualError("We could not find that video.");
  return { row, plan };
}

/** Uploads a company may have allowed and not yet confirmed at once. */
export const MAX_OPEN_UPLOADS = 3;
/** How long an allowed upload is held (and counted) before the clean-up lets it go. */
export const UPLOAD_RESERVATION_MS = 60 * 60 * 1000;

/**
 * The company's media usage without this visual's own video and open reservation: replacing a video must not count
 * the old file (or the reservation being replaced) on top of the new one.
 */
function usageOwnBytes(row: { bytes: number; uploadBytes: number; uploadExpiresAt: Date | null }, now: Date) {
  return row.bytes + (row.uploadExpiresAt && row.uploadExpiresAt > now ? row.uploadBytes : 0);
}

export function usageWithoutOwn(usage: MediaUsage, row: { bytes: number; uploadBytes: number; uploadExpiresAt: Date | null }, now: Date): MediaUsage {
  const reserved = row.uploadExpiresAt && row.uploadExpiresAt > now ? row.uploadBytes : 0;
  const count = (row.bytes > 0 ? 1 : 0) + (reserved > 0 ? 1 : 0);
  return { count: Math.max(0, usage.count - count), bytes: Math.max(0, usage.bytes - row.bytes - reserved) };
}

/** Video seconds left this month (plan limit minus what was used). */
async function secondsLeft(userId: string): Promise<number> {
  const usage = await getUsageSummary(userId);
  return Math.max(0, usage.limits.videoSeconds - usage.used.videoSeconds);
}

/**
 * The seconds a remake of this visual does not pay again: those of the video it already has (billed when it was
 * made). A remake replaces that video and pays only the extra seconds when the new one is longer. Nothing when the
 * visual has no video (never made, or its file was removed by the 30-day clean-up).
 */
export function remakeCredit(row: { kind: string; items: unknown; seconds: number }): number {
  return row.kind === "video" && readItems(row.items)[0]?.path ? Math.max(0, row.seconds) : 0;
}

/**
 * Before a video that already exists is made again (captions, photos, music, voice, "Make it again"): refused, with
 * the old video kept, when the remake would need more seconds than the plan has left this month.
 */
export async function assertRemakeAllowed(businessId: string, row: { kind: string; items: unknown; seconds: number }, plan: VideoPlan) {
  const credit = remakeCredit(row);
  if (credit === 0) return;
  const extra = billableSeconds(plan.totalMs) - credit;
  if (extra <= 0) return;
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { userId: true } });
  const left = business ? await secondsLeft(business.userId) : 0;
  if (extra > left) throw new VisualError(`Making this video again needs ${extra} more seconds than your current video, and your plan has ${left} left this month. Your current video is kept.`);
}

/**
 * Checks a video the browser is about to upload (plan feature, length, size, video seconds left, media quota) and
 * gives it a signed upload URL. The seconds are counted when the upload is confirmed (finalizeVideo).
 */
export async function prepareVideoUpload(owner: Owner, visualId: string, file: { bytes: number; mimeType: string; durationMs: number }) {
  if (!(await videoAvailable(owner.businessId))) throw new VisualError("Videos are not in your plan. Add video to your plan to make them.");
  const { row, plan } = await videoRow(owner, visualId);
  if (!isVideoType(file.mimeType)) throw new VisualError("The video must be an MP4 or WebM file.");
  if (!(file.bytes > 0) || file.bytes > VIDEO_LIMITS.maxBytes) throw new VisualError("The video is larger than 8 MB. Try fewer scenes or shorter captions.");
  if (!(file.durationMs > 0) || file.durationMs > VIDEO_LIMITS.maxMs + 1000) throw new VisualError("Videos can be at most 30 seconds long.");
  const seconds = billableSeconds(Math.max(file.durationMs, plan.totalMs));
  // A remake pays only the seconds beyond the video it replaces.
  const extra = Math.max(0, seconds - remakeCredit(row));
  if (extra > 0 && (await secondsLeft(owner.userId)) < extra) {
    throw new VisualError(remakeCredit(row) ? "Your plan does not have enough video seconds left this month for a longer video. Your current video is kept." : "Your plan's video seconds for this month are used up. Use the picture instead, or add more video to your plan.");
  }
  const now = new Date();
  const open = await prisma.contentVisual.count({ where: { businessId: owner.businessId, kind: "video", uploadExpiresAt: { gt: now }, id: { not: visualId } } });
  if (open >= MAX_OPEN_UPLOADS) throw new VisualError("Other videos are being saved right now. Wait for them to finish, then try again.");
  // The reservation is counted at the most a video may weigh, whatever size the browser announced.
  const problem = quotaProblem(usageWithoutOwn(await mediaUsage(owner.businessId), row, now), { count: 1, bytes: VIDEO_LIMITS.maxBytes });
  if (problem) throw new VisualError(problem);
  try {
    await assertPlatformRoom(Math.max(0, VIDEO_LIMITS.maxBytes - usageOwnBytes(row, now)));
  } catch (error) {
    if (error instanceof MediaError) throw new VisualError(error.message);
    throw error;
  }
  const path = videoPath(owner.userId, visualId, file.mimeType);
  // The video robot has no session (owner.service): its upload URL is made with the service key, in the owner's folder.
  const target = await createSignedUploadUrl("media", path, { service: !!owner.service });
  // One open upload per visual: a newer one replaces it (the clean-up deletes a file nobody confirmed).
  await prisma.contentVisual.update({ where: { id: visualId }, data: { uploadPath: target.path, uploadBytes: VIDEO_LIMITS.maxBytes, uploadExpiresAt: new Date(now.getTime() + UPLOAD_RESERVATION_MS) } });
  return { path: target.path, token: target.token, signedUrl: target.signedUrl, seconds };
}

/**
 * Confirms an uploaded video: the file exists, is an MP4 or WebM of at most 8 MB, the seconds fit the plan (counted
 * now), then it replaces the visual's old video and goes on the Autopilot posts of its group. A rejected file is deleted.
 */
export async function finalizeVideo(owner: Owner, visualId: string, input: { path: string; durationMs: number }, options: { robotJob?: string } = {}) {
  const { row } = await videoRow(owner, visualId);
  if (!isOwnVideoPath(owner.userId, visualId, input.path)) throw new VisualError("That upload could not be used.");
  // Asked twice (a lost answer, a double click): the video is already this file, nothing is counted again.
  if (row.status === "ready" && readItems(row.items)[0]?.path === input.path) return { path: input.path, seconds: row.seconds };
  if (!(await videoAvailable(owner.businessId))) throw new VisualError("Videos are not in your plan. Add video to your plan to make them.");
  const bucket = createAdminClient().storage.from("media");
  const reject = async (message: string): Promise<never> => {
    await bucket.remove([input.path]).catch(() => {});
    await prisma.contentVisual.updateMany({ where: { id: row.id, uploadPath: input.path }, data: { uploadPath: null, uploadBytes: 0, uploadExpiresAt: null } }).catch(() => {});
    throw new VisualError(message);
  };
  // Only the upload the server allowed (and counted): a file written straight into the folder is not taken.
  const now = new Date();
  if (row.uploadPath !== input.path || !row.uploadExpiresAt || row.uploadExpiresAt <= now) return reject("That upload could not be used. Please make the video again.");
  const info = await bucket.info(input.path);
  if (info.error || !info.data) throw new VisualError("We could not find the uploaded video. Please try again.");
  const { size, contentType } = info.data;
  if (!size || size > VIDEO_LIMITS.maxBytes) return reject("The video is larger than 8 MB.");
  // The quota again, with the real size, in place of this visual's old video and reservation.
  const problem = quotaProblem(usageWithoutOwn(await mediaUsage(owner.businessId), row, now), { count: 1, bytes: size });
  if (problem) return reject(problem);
  try {
    await assertPlatformRoom(Math.max(0, size - usageOwnBytes(row, now)));
  } catch (error) {
    if (error instanceof MediaError) return reject(error.message);
    throw error;
  }
  const download = await bucket.download(input.path);
  const bytes = download.data ? new Uint8Array(await download.data.arrayBuffer()) : null;
  if (!bytes || bytes.length > VIDEO_LIMITS.maxBytes) return reject("We could not read the uploaded video. Please try again.");
  const sniffed = sniffVideo(bytes.subarray(0, 32));
  if (!sniffed || (contentType && sniffed !== contentType) || !input.path.endsWith(`.${VIDEO_TYPES[sniffed]}`)) return reject("That file is not an MP4 or WebM video.");
  // The length is read from the file and billed as it is; the browser's figure is not trusted.
  const durationMs = videoDurationMs(bytes, sniffed);
  if (durationMs === null || !(durationMs > 0)) return reject("We could not read the video's length. Please make it again.");
  if (durationMs > VIDEO_LIMITS.maxMs + 500) return reject("Videos can be at most 30 seconds long.");
  const seconds = billableSeconds(durationMs);
  // The video robot's file is taken only while it still holds the video: the owner may have taken it over ("Make it
  // now") or the lease ran out while the file was checked. Read again right before billing.
  if (options.robotJob) {
    const held = await prisma.contentVisual.findUnique({ where: { id: row.id }, select: { robotJobId: true, renderingUntil: true } });
    if (held?.robotJobId !== options.robotJob || !held.renderingUntil || held.renderingUntil <= new Date()) return reject("The video was made elsewhere in the meantime.");
  }
  // A remake replaces the video it had: only the seconds beyond those already paid for are counted.
  const extra = Math.max(0, seconds - remakeCredit(row));
  try {
    if (extra > 0) await consumeUsage(owner.userId, "videoSeconds", extra);
  } catch (error) {
    if (error instanceof UsageLimitError) return reject(remakeCredit(row) ? "Your plan does not have enough video seconds left this month for a longer video. Your current video is kept." : "Your plan's video seconds for this month are used up.");
    throw error;
  }
  const previous = readItems(row.items);
  await prisma.contentVisual.update({
    where: { id: row.id },
    data: { status: "ready", error: null, items: json([{ path: input.path }]), bytes: size, seconds, renderedAt: new Date(), uploadPath: null, uploadBytes: 0, uploadExpiresAt: null, renderingUntil: null, robotJobId: null, robotAttempts: 0 },
  });
  for (const old of previous) {
    if (old.path !== input.path && !(await inUse(owner.businessId, old.path))) await bucket.remove([old.path]).catch(() => {});
  }
  if (row.groupId) await attachToGroup(owner.businessId, row.groupId).catch((e) => logError(e, { source: "visuals.attach", level: "warn", businessId: owner.businessId }));
  if (row.contentId) await attachToContent(owner.businessId, row.contentId).catch((e) => logError(e, { source: "visuals.attach", level: "warn", businessId: owner.businessId }));
  return { path: input.path, seconds };
}

/** The owner edited the video's captions (or its photos): the plan changes and the video is made again on open. */
export async function updateVideoPlan(owner: Owner, visualId: string, changes: { texts?: string[]; photos?: (string | null)[] }) {
  const { row, plan } = await videoRow(owner, visualId);
  let next: VideoPlan = changes.texts ? withSceneTexts(plan, changes.texts) : plan;
  if (changes.photos) {
    const photos = changes.photos;
    if (!photos.every((p) => p === null || isOwnPhotoPath(owner.userId, p) || isOwnDesignPath(owner.userId, p))) throw new VisualError("That photo could not be used.");
    next = { ...next, scenes: next.scenes.map((s, i) => (i < photos.length ? { ...s, photoPath: photos[i] } : s)) };
  }
  // The video it has stays (and stays on its posts) until the new one is saved.
  await assertRemakeAllowed(owner.businessId, row, next);
  await prisma.contentVisual.update({ where: { id: row.id }, data: { plan: json(next), status: "pending", error: null, robotAttempts: 0 } });
  return next;
}

/** How long a browser render holds the video, so the video robot does not make the same video meanwhile. */
export const BROWSER_RENDER_LEASE_MS = 10 * 60 * 1000;
/** How long the video robot holds a video it claimed (render, upload, confirm). Longer than the browser's lease. */
export const ROBOT_LEASE_MS = 15 * 60 * 1000;
/** After this long without the robot finishing, the owner's "Make it now" takes the video over. */
export const ROBOT_TAKEOVER_MS = 5 * 60 * 1000;

/**
 * The owner's browser is about to make the video ("Make it now", or on open): it takes the render lease, unless the
 * video robot claimed it less than 5 minutes ago (docs/VIDEO_ROBOT.md). Past that the owner wins: the robot's job is
 * cancelled, its reserved upload (and any file written there) goes, and its later "complete" is refused.
 * A video that is already made can always be made again.
 */
export async function leaseVideoForBrowser(owner: Owner, visualId: string, now = new Date()) {
  const { row } = await videoRow(owner, visualId);
  if (row.status !== "pending") return;
  // The robot's lease started ROBOT_LEASE_MS before it ends; it is "recent" while it ends later than this.
  const recentRobot = new Date(now.getTime() + ROBOT_LEASE_MS - ROBOT_TAKEOVER_MS);
  const taken = await prisma.contentVisual.updateMany({
    where: { id: row.id, businessId: owner.businessId, robotJobId: row.robotJobId, OR: [{ robotJobId: null }, { renderingUntil: null }, { renderingUntil: { lte: recentRobot } }] },
    data: { renderingUntil: new Date(now.getTime() + BROWSER_RENDER_LEASE_MS), robotJobId: null, ...(row.robotJobId && row.uploadPath ? { uploadPath: null, uploadBytes: 0, uploadExpiresAt: null } : {}) },
  });
  if (taken.count === 0) throw new VisualError("Your video is being made automatically right now. It will be ready in a few minutes.");
  if (row.robotJobId && row.uploadPath) await createAdminClient().storage.from("media").remove([row.uploadPath]).catch(() => {});
}

/**
 * Marks a video as not renderable in this browser, so the screen shows a reason (and the video it already had, which
 * is kept, or else the picture version).
 */
export async function markVideoFailed(owner: Owner, visualId: string, message: string) {
  const { row } = await videoRow(owner, visualId);
  if (row.status === "ready") return;
  await prisma.contentVisual.update({ where: { id: row.id }, data: { status: "failed", error: slideText(message, 300) || "The video could not be made." } });
}

// ---- posts ----

/** The ready picture slides and video of a content version or group, as storage paths (for posts). */
export async function readyMedia(businessId: string, key: { contentId: string } | { groupId: string }): Promise<{ images: string[]; video: string | null; videoCredit?: string | null }> {
  // A video being made again (pending or failed) keeps its current file until the new one is saved.
  const rows = await prisma.contentVisual.findMany({ where: { businessId, ...key, OR: [{ status: "ready" }, { kind: "video" }] }, orderBy: { createdAt: "desc" } });
  const image = rows.find((v) => v.kind !== "video" && v.status === "ready");
  const video = rows.find((v) => v.kind === "video" && readItems(v.items)[0]?.path);
  const videoPath = video ? (readItems(video.items)[0]?.path ?? null) : null;
  // The music's credit line, when its licence asks for one (docs/VOICE_AND_MUSIC.md).
  const music = videoPath && video ? readVideoPlan(video.plan)?.music : null;
  const credit = music && !music.owned ? music.attribution : null;
  return { images: image ? readItems(image.items).map((i) => i.path) : [], video: videoPath, videoCredit: credit || null };
}

/** A video post's text with the music credit line at the end (once). Pure. */
export function withMusicCredit(text: string, credit: string | null | undefined): string {
  const line = credit?.trim();
  // Added unless the exact credit line is already one of the post's lines.
  if (!line || text.split(/\r?\n/).some((l) => l.trim() === line)) return text;
  return `${text.trimEnd()}\n\n${line}`;
}

// ---- Autopilot posts ----

/**
 * Puts a group's ready visuals on its posts that have not gone out: carousels and images on feed posts, the video on
 * video ideas (a real video post on Instagram and Facebook, the script reminder's attachment on TikTok and YouTube).
 */
export async function attachToGroup(businessId: string, groupId: string, options: { feed?: boolean } = {}) {
  await attachVisuals(businessId, { groupId }, { groupId, status: { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED"] } }, options);
}

/**
 * The same for the posts Studio drafted from a content version (source STUDIO, docs/CONTENT.md); posts the owner made
 * in the composer keep the media they chose. Posts that waited only for this picture or video are then auto-approved
 * when their app needs no approval.
 */
export async function attachToContent(businessId: string, contentId: string, options: { feed?: boolean } = {}) {
  // Only drafts still waiting and untouched: a scheduled post or one the owner edited keeps what it has.
  await attachVisuals(businessId, { contentId }, { contentId, source: "STUDIO", status: { in: ["DRAFT", "PENDING_APPROVAL"] }, ownerEditedAt: null }, options);
  const { retryAutoSchedule } = await import("@/lib/content-board/auto");
  await retryAutoSchedule(businessId, { contentId });
}

async function attachVisuals(businessId: string, key: { contentId: string } | { groupId: string }, postWhere: Prisma.PostWhereInput, options: { feed?: boolean }) {
  const { images, video: videoFile, videoCredit } = await readyMedia(businessId, key);
  const posts = await prisma.post.findMany({ where: { businessId, ...postWhere, lockedAt: null }, select: { id: true, network: true, format: true, mediaPaths: true, status: true, lastError: true, updatedAt: true, text: true } });
  for (const post of posts) {
    if (!isNetwork(post.network)) continue;
    const rules = getProvider(post.network).rules;
    const planned = post.format;
    // Feed posts change when their picture was redrawn (options.feed), or when they had none.
    if (planned === "THREAD" || (planned !== "SCRIPT" && !(images.length && (options.feed || post.mediaPaths.length === 0)))) continue;
    const { format, mediaPaths } = mediaForPost({ network: post.network, format: planned, rules, images, video: videoFile });
    if (format === post.format && mediaPaths.join("|") === post.mediaPaths.join("|")) continue;
    const fixesDraft = post.status === "DRAFT" && post.lastError?.startsWith("This post needs a picture") && mediaPaths.length > 0;
    // A post that carries the video credits its music when the licence asks for it.
    const text = videoFile && mediaPaths.includes(videoFile) ? withMusicCredit(post.text, videoCredit) : post.text;
    await prisma.post.updateMany({ where: { ...postWhere, id: post.id, lockedAt: null, updatedAt: post.updatedAt }, data: { format, mediaPaths, ...(text !== post.text ? { text } : {}), ...(fixesDraft ? { lastError: null } : {}) } });
  }
}
