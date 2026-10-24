// The visual of an Autopilot post group (docs/CONTENT_VISUALS.md): a single branded image as before (images.ts), or
// a short carousel when the idea is a list or the product has several photos and a network takes carousels, plus a
// video plan for video ideas (rendered in the owner's browser when they open it). Every choice is recorded as a
// ContentVisual on the group, so the owner can change it like Studio content. Never fails the group.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { recommendPack } from "@/lib/designs/packs";
import { moodFor } from "@/lib/music/tracks";
import { trackForVideo } from "@/lib/music/service";
import { getProvider } from "@/lib/social/registry";
import { directVisual } from "@/lib/visuals/art-director";
import type { Audience } from "@/lib/visuals/people";
import { shouldCarousel } from "@/lib/visuals/direction";
import { assignDesigns, chooseLook } from "@/lib/visuals/designs";
import { directionContext, drawSlide, itemsOf, recentVisualChoices, type DrawState } from "@/lib/visuals/service";
import { VISUAL_LIMITS, type ImagePlan } from "@/lib/visuals/types";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { videoGetsAiClips, type VideoQuality } from "@/lib/visuals/video-quality";
import { hasShortRequestLimit } from "@/lib/platform/limits";
import { makeGroupImages, PHOTO_MARK, type GroupImages, type ImageContext } from "./images";
import type { PlannedGroup } from "./planner";
import type { WrittenGroup } from "./writer";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export interface VisualContext extends ImageContext {
  business: { name: string; tone: string | null; industry: string | null; brandColors: string[] };
  /** The plan has video: video ideas get a video plan. */
  videoAllowed: boolean;
  /** The owner's video quality (Autopilot settings): "ai" or "mix" mark video plans for AI clips. Simple when missing. */
  videoQuality?: VideoQuality;
  /** The company's country and personas, for the people in AI photos. */
  audience?: Audience;
}

/** Shared by every group of one run, so the caps hold for the whole week. */
export interface RunVisualState {
  aiMade: number;
  renders: number;
  aiStopped: boolean;
}

export const newRunState = (): RunVisualState => ({ aiMade: 0, renders: 0, aiStopped: false });

export interface GroupVisuals extends GroupImages {
  /** Carousel slide paths, in order, when the group got a carousel. */
  carousel: string[] | null;
}

const FEED_FORMATS = new Set(["POST", "CAROUSEL"]);

/** The feed text the art director reads: Instagram's, else Facebook's, else the first version's. */
function feedText(written: Pick<WrittenGroup, "versions">): string {
  for (const network of ["instagram", "facebook", "linkedin"]) {
    const version = written.versions.find((v) => v.network === network);
    if (version) return version.text;
  }
  return written.versions[0]?.text ?? "";
}

async function carouselFor(group: PlannedGroup, written: WrittenGroup, ctx: VisualContext, run: RunVisualState): Promise<string[] | null> {
  const carouselAllowed = group.posts.some((p) => FEED_FORMATS.has(p.format) && getProvider(p.network).rules.formats.includes("CAROUSEL"));
  if (!carouselAllowed || run.renders + VISUAL_LIMITS.minCarouselSlides > VISUAL_LIMITS.maxRendersPerRun) return null;
  const dctx = directionContext({
    subjectType: group.project?.type ?? "service",
    title: group.project?.title ?? written.image.headline ?? ctx.businessName,
    price: group.project?.price,
    caption: feedText(written),
    headlines: [written.image.headline].filter(Boolean),
    business: ctx.business,
    photos: group.photos.map((p) => p.path),
    carouselAllowed,
    // On Netlify (60 s a request) a carousel uses the owner's photos: its AI cover would be painted in this call.
    aiAllowed: ctx.useAiImages && !run.aiStopped && run.aiMade < VISUAL_LIMITS.maxAiPhotosPerRun && !hasShortRequestLimit(),
    maxSlides: VISUAL_LIMITS.autopilotMaxSlides,
    audience: ctx.audience,
  });
  // The art director is asked only when a carousel is likely; single images keep the playbook's own template.
  if (!shouldCarousel(dctx)) return null;
  const directed: ImagePlan = await directVisual(dctx, { userId: ctx.userId, businessId: ctx.businessId });
  if (directed.slides.length < 2) return null;
  const recent = await recentVisualChoices(ctx.businessId);
  const plan = assignDesigns(directed, { recent: recent.designs, seed: group.groupId });
  // The writer's image text is the cover, so the carousel opens like the single image would.
  plan.slides[0] = { ...plan.slides[0], headline: written.image.headline || plan.slides[0].headline, subline: written.image.subline || plan.slides[0].subline, chip: written.image.chip || plan.slides[0].chip, kicker: written.image.kicker };
  const state: DrawState = { aiAllowed: dctx.aiAllowed, aiMade: run.aiMade, maxAi: VISUAL_LIMITS.maxAiPhotosPerRun };
  const owner = { userId: ctx.userId, businessId: ctx.businessId, service: ctx.service };
  try {
    for (let i = 0; i < plan.slides.length; i++) {
      // Counted before drawing: a draw that throws still used the run's budget (and maybe an AI photo).
      run.renders += 1;
      const slide = (plan.slides[i] = await drawSlide(owner, group.project?.id ?? null, plan, plan.slides[i], state, undefined, { source: "autopilot", brief: group.idea.name, caption: feedText(written) }));
      // Remembered like the single images, so the next weeks prefer photos that were not used recently.
      if (slide.source === "album" && slide.photoPath && slide.designId) await prisma.design.update({ where: { id: slide.designId }, data: { prompt: `${PHOTO_MARK}${slide.photoPath}` } }).catch(() => {});
    }
  } finally {
    // The run's caps hold even when a slide failed half-way (its AI photo was still paid for).
    run.aiMade = state.aiMade;
    if (!state.aiAllowed && dctx.aiAllowed) run.aiStopped = true;
  }
  const items = itemsOf(plan);
  if (items.length === 0) return null;
  // Designed slides are no more (no templates): with fewer than two pictures left it is a single image.
  await prisma.contentVisual.create({ data: { businessId: ctx.businessId, groupId: group.groupId, kind: items.length > 1 ? "carousel" : "image", status: "ready", plan: json(plan), items: json(items), renderedAt: new Date() } });
  return items.map((i) => i.path);
}

/** Records the single image the playbook template made, so the owner can restyle it like Studio content. */
async function recordImage(group: PlannedGroup, written: WrittenGroup, ctx: VisualContext, path: string) {
  const template = group.idea.template ?? "announcement";
  const plan: ImagePlan = {
    version: 1,
    pack: recommendPack(ctx.business),
    aspectRatio: "4:5",
    directedBy: "rules",
    notes: [],
    slides: [
      {
        template,
        headline: written.image.headline || group.project?.title || ctx.businessName,
        subline: written.image.subline,
        chip: written.image.chip,
        kicker: written.image.kicker,
        source: group.photos[0] ? "album" : "text",
        photoPath: group.photos[0]?.path ?? null,
        designId: (await prisma.design.findFirst({ where: { businessId: ctx.businessId, path }, select: { id: true } }))?.id ?? null,
        path,
      },
    ],
  };
  await prisma.contentVisual.create({ data: { businessId: ctx.businessId, groupId: group.groupId, kind: "image", status: "ready", plan: json(plan), items: json(itemsOf(plan)), renderedAt: new Date() } });
}

/**
 * The group's AI picture, left for later (hosts with a short request limit: docs/CONTENT_VISUALS.md "Autopilot on
 * Netlify"): a pending visual the late-pictures sweep makes one step at a time. `standIns` are the owner's photo pictures
 * the posts got meanwhile; the AI picture replaces only those.
 */
async function recordLatePicture(group: PlannedGroup, written: WrittenGroup, ctx: VisualContext, standIns: string[]) {
  const plan: ImagePlan = {
    version: 1,
    pack: recommendPack(ctx.business),
    aspectRatio: "4:5",
    directedBy: "rules",
    notes: [],
    deferredFrom: [...new Set(standIns)],
    slides: [
      {
        template: group.idea.template ?? "announcement",
        headline: written.image.headline || group.project?.title || ctx.businessName,
        subline: written.image.subline,
        chip: written.image.chip,
        kicker: written.image.kicker,
        source: "ai",
        photoPath: group.photos[0]?.path ?? null,
        designId: null,
        path: null,
      },
    ],
  };
  await prisma.contentVisual.create({ data: { businessId: ctx.businessId, groupId: group.groupId, kind: "image", status: "pending", plan: json(plan), items: json([]) } });
}

/** A video plan for a group with a video idea (a SCRIPT post), from its script and photos. Made later in the browser. */
async function planGroupVideo(group: PlannedGroup, written: WrittenGroup, ctx: VisualContext) {
  const scriptPost = group.posts.find((p) => p.format === "SCRIPT");
  if (!scriptPost || !ctx.videoAllowed) return;
  // A feed video post has its scenes apart from its caption; a TikTok / YouTube post's text is the script.
  const version = written.versions.find((v) => v.network === scriptPost.network);
  const script = version?.videoScript || version?.text || "";
  const plan = buildVideoPlan({
    script,
    hook: written.image.headline || group.project?.title || ctx.businessName,
    businessName: ctx.businessName,
    photos: group.photos.map((p) => p.path),
    pack: recommendPack(ctx.business),
    colors: ctx.business.brandColors,
    look: chooseLook({ pack: recommendPack(ctx.business), template: group.idea.template ?? null, hasPhoto: group.photos.length > 0, recent: (await recentVisualChoices(ctx.businessId)).looks, seed: group.groupId }),
  });
  plan.mood = moodFor({ tone: ctx.business.tone });
  plan.music = await trackForVideo(plan.mood, group.groupId);
  if (videoGetsAiClips(ctx.videoQuality, group.groupId)) plan.quality = "ai";
  // A video marked for AI clips waits for them (lib/visuals/ai-clips.ts) before it is rendered.
  await prisma.contentVisual.create({ data: { businessId: ctx.businessId, groupId: group.groupId, kind: "video", status: "pending", plan: json(plan), items: json([]), ...(plan.quality === "ai" ? { clipState: "waiting" } : {}) } });
}

export async function makeGroupVisuals(group: PlannedGroup, written: WrittenGroup, ctx: VisualContext, run: RunVisualState): Promise<GroupVisuals> {
  let carousel: string[] | null = null;
  try {
    carousel = await carouselFor(group, written, ctx, run);
  } catch (error) {
    await logError(error, { source: "autopilot.visuals.carousel", level: "warn", businessId: ctx.businessId });
  }
  // A carousel left with one picture (its visual is already recorded as an image) is that picture.
  if (carousel && carousel.length < 2) {
    await planGroupVideo(group, written, ctx).catch((error) => logError(error, { source: "autopilot.visuals.record", level: "warn", businessId: ctx.businessId }));
    return { designs: { "4:5": carousel[0], "1:1": carousel[0] }, aiStopped: run.aiStopped, notes: [], aiUsed: false, carousel: null };
  }
  // The single image is still made when a feed network has no carousels (in every size the networks need).
  const needsSingle = !carousel || group.posts.some((p) => FEED_FORMATS.has(p.format) && !getProvider(p.network).rules.formats.includes("CAROUSEL"));
  let images: GroupImages;
  // On Netlify (60 s a request; one AI picture takes 40 to 100 s) the single image's AI picture is made later by the
  // late-pictures sweep: the posts get the owner's photo now. The Mac and Cloudflare paint it at once.
  const aiNow = ctx.useAiImages && !run.aiStopped && run.aiMade < VISUAL_LIMITS.maxAiPhotosPerRun;
  const later = !carousel && aiNow && hasShortRequestLimit();
  if (needsSingle) {
    images = await makeGroupImages(group, written.image, { ...ctx, useAiImages: aiNow && !later }, { aiStopped: run.aiStopped, caption: feedText(written) });
    run.renders += Object.keys(images.designs).length;
    if (images.aiUsed) run.aiMade += 1;
    if (images.aiStopped) run.aiStopped = true;
  } else {
    images = { designs: { "4:5": carousel![0], "1:1": carousel![0] }, aiStopped: run.aiStopped, notes: [], aiUsed: false };
  }
  try {
    const cover = images.designs["4:5"] ?? images.designs["1:1"];
    if (later) {
      await recordLatePicture(group, written, ctx, Object.values(images.designs).filter((p): p is string => !!p));
      run.aiMade += 1;
    } else if (!carousel && cover) await recordImage(group, written, ctx, cover);
    await planGroupVideo(group, written, ctx);
  } catch (error) {
    await logError(error, { source: "autopilot.visuals.record", level: "warn", businessId: ctx.businessId });
  }
  return { ...images, carousel };
}
