// The day's reel made from the day's pictures (owner update, 11 November 2026: Instagram and TikTok get a reel every
// day; on a pictures day it is the "daily slideshow": the day's images, words on screen, a voice-over and a song from
// BuPulse's music library). Planned with the captions (lib/ai/pack.ts, a ReelDraft on the set's picture visual) and
// made into a video plan (lib/visuals/video-plan.ts format) the moment the pictures are ready; the renderer (the
// browser, the video robot, or the server renderer) turns the plan into the MP4 and the posts take it (attachToGroup).
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { recommendPack } from "@/lib/designs/packs";
import { trackForVideo } from "@/lib/music/service";
import { moodFor } from "@/lib/music/tracks";
import { chooseLook, recentChoices } from "@/lib/visuals/designs";
import { VIDEO_LIMITS, type ImagePlan, type ReelDraft, type VideoPlan } from "@/lib/visuals/types";
import { buildVideoPlan, withSceneTexts } from "@/lib/visuals/video-plan";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const sentence = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t && !/[.!?…]$/.test(t) ? `${t}.` : t;
};

/**
 * Pure: the reel's video plan from its draft and the day's ready pictures (designs-bucket paths, in order). The words
 * on screen follow the draft's scenes, each picture in turn; the voice-over script has one line per scene of the plan
 * (the closing line is spoken too).
 */
export function reelPlanFromSet(draft: ReelDraft, images: readonly string[], ctx: { businessName: string; colors: readonly string[]; pack: VideoPlan["pack"]; look?: string | null; groupId: string }): VideoPlan {
  // The writer's words go on screen as they are (the script cleaner would take "40 plants" for a timestamp): the plan's
  // shape comes from placeholder lines, then the scenes get the real words and their timing.
  const words = draft.scenes.map((s) => s.onScreen).filter(Boolean);
  const body = (words.length ? words : [ctx.businessName]).slice(0, VIDEO_LIMITS.maxScenes - 1);
  const cta = draft.cta || ctx.businessName;
  const texts = key(body[body.length - 1]) === key(cta) ? body : [...body.slice(0, VIDEO_LIMITS.maxScenes - 2), cta];
  const shape = buildVideoPlan({
    script: texts.slice(1, -1).map((_, i) => `line${i + 2}`).join("\n"),
    hook: "line1",
    cta: texts.length > 1 ? "lineend" : null,
    businessName: ctx.businessName,
    photos: [...images],
    pack: ctx.pack,
    colors: ctx.colors,
    look: ctx.look,
  });
  const plan = withSceneTexts(shape, texts);
  // Every picture of the day is seen: scenes cycle through them (the closing scene too when there are pictures).
  const scenes = images.length ? plan.scenes.map((s, i) => ({ ...s, photoPath: images[i % images.length] })) : plan.scenes;
  const voiceScript = scenes.map((s) => {
    const match = draft.scenes.find((d) => key(d.onScreen) === key(s.text) || key(s.text).startsWith(key(d.onScreen).slice(0, 40)));
    return sentence(match?.voice || s.text);
  });
  return { ...plan, scenes, voiceScript, videoKind: draft.kind, daySetId: ctx.groupId, ...(draft.kind === "ai-clips" ? { quality: "ai" as const } : {}), ...(draft.language ? { language: draft.language } : {}) };
}

/**
 * Makes the reel of a finished set (once: the picture visual keeps the reel's id). Returns the reel's visual id, or
 * null when the set has no reel. The reel is a pending video like every other (the robot or the browser renders it;
 * a reel marked for AI clips waits for them first).
 */
export async function createSetReel(row: { id: string; businessId: string; groupId: string | null; createdAt?: Date }, plan: ImagePlan, images: readonly string[]): Promise<string | null> {
  const set = plan.daySet;
  if (!set?.reel || !row.groupId) return null;
  if (set.reelVisualId) return set.reelVisualId;
  // Called under the picture visual's drawing lease (one finisher at a time); a reel already there is kept. A reel
  // older than these pictures belongs to the set before a remake ("New pictures", set-remake.ts): a new one is made.
  const existing = await prisma.contentVisual.findFirst({ where: { businessId: row.businessId, groupId: row.groupId, kind: "video", ...(row.createdAt ? { createdAt: { gte: row.createdAt } } : {}) }, select: { id: true } });
  if (existing) return existing.id;
  const business = await prisma.business.findUnique({ where: { id: row.businessId }, select: { name: true, brandColors: true, tone: true, industry: true } });
  if (!business) return null;
  const pack = recommendPack(business);
  const recent = await prisma.contentVisual.findMany({ where: { businessId: row.businessId }, orderBy: { createdAt: "desc" }, take: 24, select: { plan: true } }).then((r) => recentChoices(r.map((x) => x.plan))).catch(() => ({ looks: [] as string[] }));
  const look = chooseLook({ pack, hasPhoto: images.length > 0, recent: recent.looks, seed: row.groupId });
  const video = reelPlanFromSet(set.reel, images, { businessName: business.name, colors: business.brandColors, pack, look, groupId: row.groupId });
  video.mood = set.reel.mood ?? moodFor({ tone: business.tone });
  // The apps the day's posts go to: a track limited to some apps (Meta Sound Collection) only when all of them fit.
  const destinations = await prisma.post.findMany({ where: { businessId: row.businessId, groupId: row.groupId }, distinct: ["network"], select: { network: true } }).then((r) => r.map((p) => p.network)).catch(() => []);
  video.music = await trackForVideo(video.mood, row.groupId, destinations);
  const created = await prisma.contentVisual.create({
    data: { businessId: row.businessId, groupId: row.groupId, kind: "video", status: "pending", plan: json(video), items: json([]), ...(video.quality === "ai" ? { clipState: "waiting" } : {}) },
    select: { id: true },
  });
  return created.id;
}
