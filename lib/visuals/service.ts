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
import { quotaProblem } from "@/lib/media/rules";
import { RateLimitError } from "@/lib/rate-limit";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { createSignedUploadUrl } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeUsage, getUsageSummary, UsageLimitError } from "@/lib/usage";
import { directVisual } from "./art-director";
import { chooseSources, fallbackPlan, PHOTO_TEMPLATES, readImagePlan, slideText, type DirectionContext } from "./direction";
import { mediaForPost } from "./post-media";
import { billableSeconds } from "./timeline";
import { VIDEO_LIMITS, VISUAL_LIMITS, type ImagePlan, type VideoPlan, type VisualItem, type VisualKind, type VisualSlide } from "./types";
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
  try {
    if (!(await hasFeature(owner.businessId, "aiPhotos"))) return false;
    const [usage, spend] = await Promise.all([getUsageSummary(owner.userId), companySpendThisMonth(owner.businessId)]);
    if (usage.used.image >= usage.limits.image) return false;
    return companyCallAllowed(spend, "image");
  } catch {
    return false;
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
  /** Skip the AI art director (the rules choose). */
  rulesOnly?: boolean;
}

const mimeOf = (path: string) => (/\.png$/i.test(path) ? "image/png" : /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : null);

export function directionContext(input: Omit<PlanInput, "owner" | "target" | "video" | "image" | "subjectId">): DirectionContext {
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
  };
}

function kindOf(plan: ImagePlan): VisualKind {
  return plan.slides.length > 1 ? "carousel" : "image";
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
    const plan = input.rulesOnly || input.image === false ? fallbackPlan(ctx) : await directVisual(ctx, input.owner);
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
      });
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
  if (error instanceof UsageLimitError) return "Your image credits are used up, so this slide uses your photo or a free design.";
  if (error instanceof AIProviderError) return error.message.includes("allowance") ? error.message : "AI photos are paused for a short while, so this slide uses a free design.";
  if (error instanceof RateLimitError) return "You made many AI photos this hour, so this slide uses a free design.";
  return "The AI photo could not be made, so this slide uses a free design.";
}

export type DrawState = { aiAllowed: boolean; aiMade: number; maxAi: number };

/**
 * Draws one slide: makes its AI photo first when it needs one (1 image credit, once: the photo is kept for
 * re-styling), then the template. A photo that cannot be drawn falls back to the text design; only a text design
 * that cannot be drawn either is an error.
 */
export async function drawSlide(owner: Owner, subjectId: string | null, plan: ImagePlan, slide: VisualSlide, state: DrawState): Promise<VisualSlide> {
  const next: VisualSlide = { ...slide };
  let photo: string | null = slide.source === "album" ? slide.photoPath : slide.source === "ai" ? (slide.aiPhotoPath ?? null) : null;
  if (slide.source === "ai" && !slide.aiPhotoPath) {
    if (state.aiAllowed && state.aiMade < state.maxAi) {
      try {
        const scene = buildSceneBrief({ template: slide.template, aspectRatio: plan.aspectRatio, scene: slide.scene, headline: slide.headline });
        const made = await createAiDesign({ ...owner, subjectId, prompt: scene, aspectRatio: plan.aspectRatio, usePhotoPath: slide.photoPath, includePeople: true });
        state.aiMade += 1;
        next.aiPhotoPath = made.path;
        photo = made.path;
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
  const row = await ownVisual(owner.businessId, visualId);
  if (row.kind === "video") throw new VisualError("That is a video. Open it to make it.");
  const plan = readImagePlan(row.plan);
  if (!plan) {
    await prisma.contentVisual.update({ where: { id: row.id }, data: { status: "failed", error: "This picture's plan is damaged. Make it again." } });
    return { status: "failed" as const, plan: null };
  }
  const started = Date.now();
  const budget = options.budgetMs ?? VISUAL_LIMITS.renderStepMs;
  const needsAi = plan.slides.some((s) => s.source === "ai" && !s.aiPhotoPath && !s.path);
  const state = options.state ?? { aiAllowed: needsAi ? await aiPhotosAvailable(owner) : false, aiMade: 0, maxAi: VISUAL_LIMITS.maxAiPhotosPerVisual };
  const subjectId = await subjectOf(row);
  let error: string | null = null;

  for (let i = 0; i < plan.slides.length; i++) {
    if (plan.slides[i].path) continue;
    if (Date.now() - started > budget) break;
    try {
      plan.slides[i] = await drawSlide(owner, subjectId, plan, plan.slides[i], state);
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
    data: { plan: json(plan), items: json(items), kind: kindOf(plan), status, error, ...(done ? { renderedAt: new Date() } : {}) },
  });
  // An Autopilot group's posts take the redrawn picture.
  if (done && row.groupId) await attachToGroup(owner.businessId, row.groupId, { feed: true }).catch((e) => logError(e, { source: "visuals.attach", level: "warn", businessId: owner.businessId }));
  // A video planned without photos shows the AI photo once there is one.
  const aiPhoto = plan.slides.find((s) => s.aiPhotoPath)?.aiPhotoPath;
  if (aiPhoto) await lendPhotoToVideo(row, aiPhoto).catch(() => {});
  return { status, plan, items, error };
}

async function lendPhotoToVideo(row: { businessId: string; contentId: string | null; groupId: string | null }, photo: string) {
  const sibling = await prisma.contentVisual.findFirst({ where: { businessId: row.businessId, kind: "video", status: "pending", ...(row.contentId ? { contentId: row.contentId } : { groupId: row.groupId }) } });
  const plan = sibling && readVideoPlan(sibling.plan);
  if (!sibling || !plan || plan.scenes.some((s) => s.photoPath)) return;
  const scenes = plan.scenes.map((s) => (s.role === "cta" ? s : { ...s, photoPath: photo }));
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
}

/** Applies the owner's changes to the plan and marks the changed slides to be drawn again (free templates only). */
export async function updateImageVisual(owner: Owner, visualId: string, changes: ImageChanges) {
  const row = await ownVisual(owner.businessId, visualId);
  const before = readImagePlan(row.plan);
  if (!before || row.kind === "video") throw new VisualError("We could not change that picture.");
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
    plan.slides[changes.swap.index] = { ...s, source: "album", photoPath: changes.swap.photoPath, aiPhotoPath: null, template, note: undefined };
    changed.add(changes.swap.index);
  }
  if (changed.size === 0) return { status: row.status, plan };
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

async function releaseRows(owner: Owner, rows: { id: string; kind: string; plan: unknown; items: unknown }[]) {
  const admin = createAdminClient();
  for (const row of rows) {
    if (row.kind === "video") {
      for (const item of readItems(row.items)) {
        if (item.path.startsWith(`${owner.userId}/videos/`) && !(await inUse(owner.businessId, item.path))) await admin.storage.from("media").remove([item.path]).catch(() => {});
      }
    } else {
      const plan = readImagePlan(row.plan);
      if (plan) await dropDesigns(owner, plan.slides);
    }
    await prisma.contentVisual.deleteMany({ where: { id: row.id, businessId: owner.businessId } });
  }
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

/** Video seconds left this month (plan limit minus what was used). */
async function secondsLeft(userId: string): Promise<number> {
  const usage = await getUsageSummary(userId);
  return Math.max(0, usage.limits.videoSeconds - usage.used.videoSeconds);
}

/**
 * Checks a video the browser is about to upload (plan feature, length, size, video seconds left, media quota) and
 * gives it a signed upload URL. The seconds are counted when the upload is confirmed (finalizeVideo).
 */
export async function prepareVideoUpload(owner: Owner, visualId: string, file: { bytes: number; mimeType: string; durationMs: number }) {
  if (!(await videoAvailable(owner.businessId))) throw new VisualError("Videos are not in your plan. Add video to your plan to make them.");
  const { plan } = await videoRow(owner, visualId);
  if (!isVideoType(file.mimeType)) throw new VisualError("The video must be an MP4 or WebM file.");
  if (!(file.bytes > 0) || file.bytes > VIDEO_LIMITS.maxBytes) throw new VisualError("The video is larger than 8 MB. Try fewer scenes or shorter captions.");
  if (!(file.durationMs > 0) || file.durationMs > VIDEO_LIMITS.maxMs + 1000) throw new VisualError("Videos can be at most 30 seconds long.");
  const seconds = billableSeconds(Math.max(file.durationMs, plan.totalMs));
  if ((await secondsLeft(owner.userId)) < seconds) throw new VisualError("Your plan's video seconds for this month are used up. Use the picture instead, or add more video to your plan.");
  const problem = quotaProblem(await mediaUsage(owner.businessId), { count: 1, bytes: file.bytes });
  if (problem) throw new VisualError(problem);
  try {
    await assertPlatformRoom(file.bytes);
  } catch (error) {
    if (error instanceof MediaError) throw new VisualError(error.message);
    throw error;
  }
  const path = videoPath(owner.userId, visualId, file.mimeType);
  const target = await createSignedUploadUrl("media", path);
  return { path: target.path, token: target.token, seconds };
}

async function readHead(path: string): Promise<Uint8Array | null> {
  try {
    const { data } = await createAdminClient().storage.from("media").createSignedUrl(path, 60);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl, { headers: { Range: "bytes=0-31" } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer()).subarray(0, 32);
  } catch {
    return null;
  }
}

/**
 * Confirms an uploaded video: the file exists, is an MP4 or WebM of at most 8 MB, the seconds fit the plan (counted
 * now), then it replaces the visual's old video and goes on the Autopilot posts of its group. A rejected file is deleted.
 */
export async function finalizeVideo(owner: Owner, visualId: string, input: { path: string; durationMs: number }) {
  const { row, plan } = await videoRow(owner, visualId);
  if (!isOwnVideoPath(owner.userId, visualId, input.path)) throw new VisualError("That upload could not be used.");
  const bucket = createAdminClient().storage.from("media");
  const reject = async (message: string): Promise<never> => {
    await bucket.remove([input.path]).catch(() => {});
    throw new VisualError(message);
  };
  const info = await bucket.info(input.path);
  if (info.error || !info.data) throw new VisualError("We could not find the uploaded video. Please try again.");
  const { size, contentType } = info.data;
  if (!size || size > VIDEO_LIMITS.maxBytes) return reject("The video is larger than 8 MB.");
  const head = await readHead(input.path);
  const sniffed = head && sniffVideo(head);
  if (!sniffed || (contentType && sniffed !== contentType) || !input.path.endsWith(`.${VIDEO_TYPES[sniffed]}`)) return reject("That file is not an MP4 or WebM video.");
  const seconds = billableSeconds(Math.max(Math.min(input.durationMs, VIDEO_LIMITS.maxMs), plan.totalMs));
  try {
    await consumeUsage(owner.userId, "videoSeconds", seconds);
  } catch (error) {
    if (error instanceof UsageLimitError) return reject("Your plan's video seconds for this month are used up.");
    throw error;
  }
  const previous = readItems(row.items);
  await prisma.contentVisual.update({
    where: { id: row.id },
    data: { status: "ready", error: null, items: json([{ path: input.path }]), bytes: size, seconds, renderedAt: new Date() },
  });
  for (const old of previous) {
    if (old.path !== input.path && !(await inUse(owner.businessId, old.path))) await bucket.remove([old.path]).catch(() => {});
  }
  if (row.groupId) await attachToGroup(owner.businessId, row.groupId).catch((e) => logError(e, { source: "visuals.attach", level: "warn", businessId: owner.businessId }));
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
  await prisma.contentVisual.update({ where: { id: row.id }, data: { plan: json(next), status: "pending", error: null } });
  return next;
}

/** Marks a video as not renderable in this browser, so the screen shows the picture version and a reason. */
export async function markVideoFailed(owner: Owner, visualId: string, message: string) {
  const { row } = await videoRow(owner, visualId);
  if (row.status === "ready") return;
  await prisma.contentVisual.update({ where: { id: row.id }, data: { status: "failed", error: slideText(message, 300) || "The video could not be made." } });
}

// ---- posts ----

/** The ready picture slides and video of a content version or group, as storage paths (for posts). */
export async function readyMedia(businessId: string, key: { contentId: string } | { groupId: string }): Promise<{ images: string[]; video: string | null }> {
  const rows = await prisma.contentVisual.findMany({ where: { businessId, ...key, status: "ready" }, orderBy: { createdAt: "desc" } });
  const image = rows.find((v) => v.kind !== "video");
  const video = rows.find((v) => v.kind === "video");
  return { images: image ? readItems(image.items).map((i) => i.path) : [], video: video ? (readItems(video.items)[0]?.path ?? null) : null };
}

// ---- Autopilot posts ----

/**
 * Puts a group's ready visuals on its posts that have not gone out: carousels and images on feed posts, the video on
 * video ideas (a real video post on Instagram and Facebook, the script reminder's attachment on TikTok and YouTube).
 */
export async function attachToGroup(businessId: string, groupId: string, options: { feed?: boolean } = {}) {
  const { images, video: videoFile } = await readyMedia(businessId, { groupId });
  const posts = await prisma.post.findMany({ where: { businessId, groupId, status: { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED"] }, lockedAt: null }, select: { id: true, network: true, format: true, mediaPaths: true, status: true, lastError: true } });
  for (const post of posts) {
    if (!isNetwork(post.network)) continue;
    const rules = getProvider(post.network).rules;
    const planned = post.format;
    // Feed posts change when their picture was redrawn (options.feed), or when they had none.
    if (planned === "THREAD" || (planned !== "SCRIPT" && !(images.length && (options.feed || post.mediaPaths.length === 0)))) continue;
    const { format, mediaPaths } = mediaForPost({ network: post.network, format: planned, rules, images, video: videoFile });
    if (format === post.format && mediaPaths.join("|") === post.mediaPaths.join("|")) continue;
    const fixesDraft = post.status === "DRAFT" && post.lastError?.startsWith("This post needs a picture") && mediaPaths.length > 0;
    await prisma.post.updateMany({ where: { id: post.id, lockedAt: null }, data: { format, mediaPaths, ...(fixesDraft ? { lastError: null } : {}) } });
  }
}
