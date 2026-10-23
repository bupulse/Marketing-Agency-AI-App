// Images for a post group (owner decision, 23 October 2026: no templates): a finished ad from the image engine
// (lib/image-engine paintOne, its own idea, words and prompt) when the owner allows AI pictures, else the gallery or
// project photo as it is. Failing to make an image never fails the post group.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { RateLimitError } from "@/lib/rate-limit";
import { UsageLimitError } from "@/lib/usage";
import { createPhotoDesign, DesignError } from "@/lib/designs/service";
import { EngineError, paintOne } from "@/lib/image-engine/engine";
import type { Network } from "@/lib/social/types";
import type { PlannedGroup } from "./planner";
import type { ImageText } from "./writer";

type Aspect = "1:1" | "4:5";

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
  /** Owner allows AI pictures (uses image credits). */
  useAiImages: boolean;
  /** The service key does the Storage work (cron has no session). */
  service: boolean;
}

export interface GroupImages {
  /** Design file path per aspect ratio. */
  designs: Partial<Record<Aspect, string>>;
  /** Image credits ran out (or AI pictures failed): do not try AI again this run. */
  aiStopped: boolean;
  /** Friendly notes for the run, e.g. that the owner's photos were used. */
  notes: string[];
  /** Whether an AI picture was made (image credits were used). */
  aiUsed: boolean;
}

/** Every feed post (a picture or a carousel) shows a picture; articles and scripts to film have none. */
function needsPicture(group: PlannedGroup): boolean {
  return !!group.idea.template || group.posts.some((p) => p.format === "POST" || p.format === "CAROUSEL");
}

/** Remembers which photo a design used, so the next plans prefer photos that were not used recently. */
async function markPhoto(designId: string, path: string | undefined) {
  if (!path) return;
  await prisma.design.update({ where: { id: designId }, data: { prompt: `${PHOTO_MARK}${path}` } }).catch(() => {});
}

export async function makeGroupImages(group: PlannedGroup, image: ImageText, ctx: ImageContext, options: { aiStopped?: boolean; caption?: string | null } = {}): Promise<GroupImages> {
  const result: GroupImages = { designs: {}, aiStopped: !!options.aiStopped, notes: [], aiUsed: false };
  if (!needsPicture(group)) return result;
  const cover = group.photos[0];
  const owner = { userId: ctx.userId, businessId: ctx.businessId, subjectId: group.project?.id ?? null, service: ctx.service };
  const aspects = [...new Set(group.networks.filter((n) => n !== "tiktok" && n !== "youtube").map(aspectFor))];
  if (aspects.length === 0) return result;

  // An AI picture: one for the whole group, used for every size.
  if (ctx.useAiImages && !result.aiStopped) {
    try {
      const made = await paintOne(owner, {
        source: "autopilot",
        subjectId: owner.subjectId,
        aspectRatio: "4:5",
        photoPath: cover?.path ?? null,
        brief: [group.idea.name, image.headline].filter(Boolean).join(": ") || null,
        caption: options.caption ?? null,
      });
      if (made) {
        for (const a of aspects) result.designs[a] = made.path;
        result.aiUsed = true;
        return result;
      }
    } catch (error) {
      if (error instanceof EngineError || error instanceof UsageLimitError) {
        result.aiStopped = true;
        result.notes.push("You ran out of AI image credits, so the remaining posts use your own photos.");
      } else if (error instanceof RateLimitError) {
        result.aiStopped = true;
      } else if (!(error instanceof DesignError)) {
        await logError(error, { source: "autopilot.image.ai", userId: ctx.userId, businessId: ctx.businessId });
      }
    }
  }

  // The owner's own photo, as it is.
  if (!cover) return result;
  for (const aspect of aspects) {
    try {
      const made = await createPhotoDesign({ ...owner, photoPath: cover.path, aspectRatio: aspect });
      result.designs[aspect] = made.path;
      await markPhoto(made.id, cover.path);
    } catch (error) {
      if (!(error instanceof DesignError) && !(error instanceof RateLimitError)) {
        await logError(error, { source: "autopilot.image.photo", userId: ctx.userId, businessId: ctx.businessId });
      }
    }
  }
  return result;
}
