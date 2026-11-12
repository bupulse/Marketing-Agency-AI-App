// "New pictures" on a day's shared set (lib/content-flow/day-set.ts). The set hangs from its posts' group
// (ContentVisual.groupId = Post.groupId, no content row), so it is made again by group, never per post: the same
// pictures' words and ideas, drawn afresh (AI pictures use image credits, as when the set was first made), then a new
// reel from the new pictures. The posts of the group take them when they are ready (attachToGroup), exactly as the
// first time; until then they keep what they have.
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { consumeUsage, UsageLimitError } from "@/lib/usage";
import { readImagePlan } from "@/lib/visuals/direction";
import { removeVisual, VisualError, type Owner } from "@/lib/visuals/service";
import { VISUAL_LIMITS, type ImagePlan, type VisualSlide } from "@/lib/visuals/types";
import { startSets } from "./set-worker";

/**
 * Pure: the set's plan to draw again. Each slide keeps its words, idea and photo; the first `maxAi` are AI pictures
 * again (as planned: lib/content-flow/service.ts planDaySets), the others the owner's photos as they are. Nothing
 * drawn, no reel yet.
 */
export function remadeSetPlan(plan: ImagePlan): ImagePlan {
  if (!plan.daySet) throw new VisualError("That picture is not a day's set.");
  const maxAi = Math.max(0, Math.min(VISUAL_LIMITS.maxDaySetImages, plan.daySet.maxAi));
  const slides: VisualSlide[] = plan.slides.map((s, i) => ({
    template: s.template,
    headline: s.headline,
    subline: s.subline,
    chip: s.chip,
    ...(s.kicker !== undefined ? { kicker: s.kicker } : {}),
    source: i < maxAi ? "ai" : "album",
    photoPath: s.photoPath,
    ...(s.scene ? { scene: s.scene } : {}),
    designId: null,
    path: null,
  }));
  return { ...plan, slides, notes: [], aiExhausted: undefined, daySet: { groupId: plan.daySet.groupId, maxAi, reel: plan.daySet.reel } };
}

/**
 * Makes a day's set again, by its group: a new picture visual (drawn on the server right away, like Create), the old
 * one removed (designs a post still uses stay), and the old reel let go (a reel still on a post waiting to go out stays
 * there until the new reel replaces it). Returns the new picture visual's id.
 */
export async function remakeDaySetVisuals(owner: Owner, groupId: string, now = new Date()): Promise<{ groupId: string; visualId: string }> {
  const rows = await prisma.contentVisual.findMany({ where: { businessId: owner.businessId, groupId, contentId: null }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, plan: true, createdAt: true, renderingUntil: true } });
  const picture = rows.find((r) => r.kind !== "video");
  const plan = picture ? readImagePlan(picture.plan) : null;
  if (!picture || !plan?.daySet) throw new VisualError("We could not find that day's pictures.");
  if (picture.renderingUntil && picture.renderingUntil > now) throw new VisualError("These pictures are still being drawn. Try again in a moment.");
  const next = remadeSetPlan(plan);
  // Reserved now, like the first time, so another run cannot use them meanwhile; a slide that ends up without its AI
  // picture gives its credit back when drawn.
  const aiCount = next.slides.filter((s) => s.source === "ai").length;
  if (aiCount > 0) {
    try {
      const { periodStart } = await consumeUsage(owner.userId, "image", aiCount);
      for (const s of next.slides) if (s.source === "ai") s.prepaidAi = periodStart.toISOString();
    } catch (error) {
      // No credits left: the slides try when drawn and fall back to the owner's photos.
      if (!(error instanceof UsageLimitError)) throw error;
    }
  }
  const created = await prisma.contentVisual.create({
    data: { businessId: owner.businessId, groupId, kind: next.slides.length > 1 ? "carousel" : "image", status: "pending", plan: next as unknown as Prisma.InputJsonValue, items: [] },
    select: { id: true },
  });
  // The set's own reel (made from the old pictures); older reels were already let go by an earlier remake.
  const old = [picture, ...rows.filter((r) => r.kind === "video" && r.createdAt >= picture.createdAt)];
  for (const r of old) await removeVisual(owner, r.id).catch(() => undefined);
  await startSets(owner.businessId, [groupId], now);
  return { groupId, visualId: created.id };
}
