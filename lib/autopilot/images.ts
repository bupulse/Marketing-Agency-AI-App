// Images for a post group: a gallery or project photo in a free brand template, or (when the owner
// allows it) an AI photo with the same layout. Failing to make an image never fails the post group.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { RateLimitError } from "@/lib/rate-limit";
import { UsageLimitError } from "@/lib/usage";
import { createAiPhotoDesign, createTemplateDesign, DesignError } from "@/lib/designs/service";
import type { TemplateId } from "@/lib/designs/templates/registry";
import type { Network } from "@/lib/social/types";
import type { PlannedGroup } from "./planner";
import type { ImageText } from "./writer";

type Aspect = "1:1" | "4:5";

/** Templates built around a photo; without one the plain announcement layout looks better. */
const PHOTO_TEMPLATES: TemplateId[] = ["new-arrival", "just-listed", "project-done"];

// Satori cannot draw these scripts, so the image carries only the business name.
const UNDRAWABLE = /hindi|chinese|japanese|korean|thai|hebrew/i;

export const PHOTO_MARK = "photo:";

/** The size an image gets on a network: Instagram is portrait, the rest are square. */
export function aspectFor(network: Network): Aspect {
  return network === "instagram" ? "4:5" : "1:1";
}

export interface ImageContext {
  userId: string;
  businessId: string;
  businessName: string;
  language: string;
  /** Owner allows AI photos (uses image credits). */
  useAiImages: boolean;
  /** The service key does the Storage work (cron has no session). */
  service: boolean;
}

export interface GroupImages {
  /** Design file path per aspect ratio. */
  designs: Partial<Record<Aspect, string>>;
  /** Image credits ran out (or AI images failed): do not try AI again this run. */
  aiStopped: boolean;
  /** Friendly notes for the run, e.g. that free templates were used. */
  notes: string[];
  /** Whether an AI photo was made (an image credit was used). */
  aiUsed: boolean;
}

function templateFor(group: PlannedGroup, hasPhoto: boolean): TemplateId | null {
  const id = group.idea.template;
  if (!id) return null;
  return !hasPhoto && PHOTO_TEMPLATES.includes(id) ? "announcement" : id;
}

/** Text for the image, always with a headline (the writer may have dropped an unsafe one). */
function imageText(group: PlannedGroup, image: ImageText, ctx: ImageContext) {
  if (UNDRAWABLE.test(ctx.language)) return { headline: ctx.businessName, subline: null, chip: null, kicker: "" };
  return {
    headline: image.headline || group.project?.title || ctx.businessName,
    subline: image.subline || null,
    chip: image.chip || null,
    // "" means no kicker; undefined would fall back to the English default.
    kicker: image.kicker,
  };
}

/** Remembers which photo a design used, so the next plans prefer photos that were not used recently. */
async function markPhoto(designId: string, path: string | undefined) {
  if (!path) return;
  await prisma.design.update({ where: { id: designId }, data: { prompt: `${PHOTO_MARK}${path}` } }).catch(() => {});
}

export async function makeGroupImages(group: PlannedGroup, image: ImageText, ctx: ImageContext, options: { aiStopped?: boolean } = {}): Promise<GroupImages> {
  const result: GroupImages = { designs: {}, aiStopped: !!options.aiStopped, notes: [], aiUsed: false };
  const cover = group.photos[0];
  const template = templateFor(group, !!cover);
  if (!template) return result;

  const owner = { userId: ctx.userId, businessId: ctx.businessId, projectId: group.project?.id ?? null, service: ctx.service };
  const text = imageText(group, image, ctx);
  const aspects = [...new Set(group.networks.filter((n) => n !== "tiktok" && n !== "youtube").map(aspectFor))];
  if (aspects.length === 0) return result;

  // AI photo: one image credit for the whole group, used for every size.
  let aiDone = false;
  if (ctx.useAiImages && !result.aiStopped && template !== "quote") {
    try {
      const made = await createAiPhotoDesign({
        ...owner,
        template,
        aspectRatio: "4:5",
        headline: text.headline,
        subline: text.subline,
        chip: text.chip,
        kicker: text.kicker,
        usePhotoPath: cover?.path ?? null,
      });
      for (const a of aspects) result.designs[a] = made.path;
      result.aiUsed = true;
      aiDone = true;
    } catch (error) {
      if (error instanceof UsageLimitError) {
        result.aiStopped = true;
        result.notes.push("You ran out of image credits, so the remaining posts use your free templates.");
      } else if (error instanceof RateLimitError || error instanceof DesignError) {
        result.aiStopped = error instanceof RateLimitError;
      } else {
        await logError(error, { source: "autopilot.image.ai", userId: ctx.userId, businessId: ctx.businessId });
      }
    }
  }
  if (aiDone) return result;

  // Free template, with the photo when it can be drawn (JPG or PNG), else on the brand backdrop.
  const draw = async (aspect: Aspect, photoPath: string | null) =>
    createTemplateDesign({
      ...owner,
      template,
      aspectRatio: aspect,
      headline: text.headline,
      subline: text.subline,
      chip: text.chip,
      kicker: text.kicker,
      photoPath,
    });
  for (const aspect of aspects) {
    try {
      const made = await draw(aspect, cover?.path ?? null).catch(async (error) => {
        if (!(error instanceof DesignError) || !cover) throw error;
        return draw(aspect, null);
      });
      result.designs[aspect] = made.path;
      await markPhoto(made.id, cover?.path);
    } catch (error) {
      if (!(error instanceof DesignError) && !(error instanceof RateLimitError)) {
        await logError(error, { source: "autopilot.image.template", userId: ctx.userId, businessId: ctx.businessId });
      }
    }
  }
  return result;
}
