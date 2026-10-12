// The visual of an Autopilot post group (docs/CONTENT_VISUALS.md): a single branded image as before (images.ts), or
// a short carousel when the idea is a list or the product has several photos and a network takes carousels, plus a
// video plan for video ideas (rendered in the owner's browser when they open it). Every choice is recorded as a
// ContentVisual on the group, so the owner can change it like Studio content. Never fails the group.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { recommendPack } from "@/lib/designs/packs";
import { getProvider } from "@/lib/social/registry";
import { directVisual } from "@/lib/visuals/art-director";
import { shouldCarousel } from "@/lib/visuals/direction";
import { directionContext, drawSlide, itemsOf, type DrawState } from "@/lib/visuals/service";
import { VISUAL_LIMITS, type ImagePlan } from "@/lib/visuals/types";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { makeGroupImages, PHOTO_MARK, type GroupImages, type ImageContext } from "./images";
import type { PlannedGroup } from "./planner";
import type { WrittenGroup } from "./writer";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export interface VisualContext extends ImageContext {
  business: { name: string; tone: string | null; industry: string | null; brandColors: string[] };
  /** The plan has video: video ideas get a video plan. */
  videoAllowed: boolean;
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
    aiAllowed: ctx.useAiImages && !run.aiStopped && run.aiMade < VISUAL_LIMITS.maxAiPhotosPerRun,
    maxSlides: VISUAL_LIMITS.autopilotMaxSlides,
  });
  // The art director is asked only when a carousel is likely; single images keep the playbook's own template.
  if (!shouldCarousel(dctx)) return null;
  const plan: ImagePlan = await directVisual(dctx, { userId: ctx.userId, businessId: ctx.businessId });
  if (plan.slides.length < 2) return null;
  // The writer's image text is the cover, so the carousel opens like the single image would.
  plan.slides[0] = { ...plan.slides[0], headline: written.image.headline || plan.slides[0].headline, subline: written.image.subline || plan.slides[0].subline, chip: written.image.chip || plan.slides[0].chip, kicker: written.image.kicker };
  const state: DrawState = { aiAllowed: dctx.aiAllowed, aiMade: run.aiMade, maxAi: VISUAL_LIMITS.maxAiPhotosPerRun };
  const owner = { userId: ctx.userId, businessId: ctx.businessId, service: ctx.service };
  for (let i = 0; i < plan.slides.length; i++) {
    const slide = (plan.slides[i] = await drawSlide(owner, group.project?.id ?? null, plan, plan.slides[i], state));
    run.renders += 1;
    // Remembered like the single images, so the next weeks prefer photos that were not used recently.
    if (slide.source === "album" && slide.photoPath && slide.designId) await prisma.design.update({ where: { id: slide.designId }, data: { prompt: `${PHOTO_MARK}${slide.photoPath}` } }).catch(() => {});
  }
  run.aiMade = state.aiMade;
  if (!state.aiAllowed && dctx.aiAllowed) run.aiStopped = true;
  const items = itemsOf(plan);
  await prisma.contentVisual.create({ data: { businessId: ctx.businessId, groupId: group.groupId, kind: "carousel", status: "ready", plan: json(plan), items: json(items), renderedAt: new Date() } });
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

/** A video plan for a group with a video idea (a SCRIPT post), from its script and photos. Made later in the browser. */
async function planGroupVideo(group: PlannedGroup, written: WrittenGroup, ctx: VisualContext) {
  const scriptPost = group.posts.find((p) => p.format === "SCRIPT");
  if (!scriptPost || !ctx.videoAllowed) return;
  const script = written.versions.find((v) => v.network === scriptPost.network)?.text ?? "";
  const plan = buildVideoPlan({
    script,
    hook: written.image.headline || group.project?.title || ctx.businessName,
    businessName: ctx.businessName,
    photos: group.photos.map((p) => p.path),
    pack: recommendPack(ctx.business),
    colors: ctx.business.brandColors,
  });
  await prisma.contentVisual.create({ data: { businessId: ctx.businessId, groupId: group.groupId, kind: "video", status: "pending", plan: json(plan), items: json([]) } });
}

export async function makeGroupVisuals(group: PlannedGroup, written: WrittenGroup, ctx: VisualContext, run: RunVisualState): Promise<GroupVisuals> {
  let carousel: string[] | null = null;
  try {
    carousel = await carouselFor(group, written, ctx, run);
  } catch (error) {
    await logError(error, { source: "autopilot.visuals.carousel", level: "warn", businessId: ctx.businessId });
  }
  // The single image is still made when a feed network has no carousels (in every size the networks need).
  const needsSingle = !carousel || group.posts.some((p) => FEED_FORMATS.has(p.format) && !getProvider(p.network).rules.formats.includes("CAROUSEL"));
  let images: GroupImages;
  if (needsSingle) {
    images = await makeGroupImages(group, written.image, { ...ctx, useAiImages: ctx.useAiImages && !run.aiStopped && run.aiMade < VISUAL_LIMITS.maxAiPhotosPerRun }, { aiStopped: run.aiStopped });
    run.renders += Object.keys(images.designs).length;
    if (images.aiUsed) run.aiMade += 1;
    if (images.aiStopped) run.aiStopped = true;
  } else {
    images = { designs: { "4:5": carousel![0], "1:1": carousel![0] }, aiStopped: run.aiStopped, notes: [], aiUsed: false };
  }
  try {
    const cover = images.designs["4:5"] ?? images.designs["1:1"];
    if (!carousel && cover) await recordImage(group, written, ctx, cover);
    await planGroupVideo(group, written, ctx);
  } catch (error) {
    await logError(error, { source: "autopilot.visuals.record", level: "warn", businessId: ctx.businessId });
  }
  return { ...images, carousel };
}
