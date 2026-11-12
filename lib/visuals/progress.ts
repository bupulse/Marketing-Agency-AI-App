// How far a day's shared set is (lib/content-flow/day-set.ts), for the loading screen (owner decision, 11 November
// 2026: a percentage ring, the current step in words, each picture fading in the moment it is ready). Read from the
// database only, so it is right whoever draws (the server, the job loop, the browser) and survives a closed page.
//
// Shape (SetProgress): { groupId, step, label, done, total, percent, ready, failed, error, images: [...], reel }
// - step: "captions" -> "images" -> "reel" -> "music" -> "ready" (the words: Writing captions, Designing images,
//   Making the reel, Adding music, Ready). The captions are written before the set exists, so a set read here has
//   them done.
// - done / total: units of work. Captions 1; each AI picture 3 (plan, paint, check; 4 while the Editor fixes it);
//   each own photo 1; the reel 2 (planned from the pictures, then rendered with its music). percent = done / total.
// - images[i]: { index, status: "waiting" | "working" | "ready" | "skipped", stage, path, url? } in the set's order;
//   stage is "planning" | "painting" | "checking" | "fixing" | null.
// - reel: null when the day has no reel made by BuPulse; else { status: "waiting" (for the pictures) | "pending" |
//   "rendering" | "ready" | "failed", visualId, path, url?, music, error }.
import "server-only";
import { prisma } from "@/lib/db";
import { readImagePlan } from "./direction";
import { readItems } from "./service";
import type { VisualSlide } from "./types";
import { readVideoPlan } from "./video-plan";

export type SetStep = "captions" | "images" | "reel" | "music" | "ready";
export const SET_STEP_LABEL: Record<SetStep, string> = { captions: "Writing captions", images: "Designing images", reel: "Making the reel", music: "Adding music", ready: "Ready" };

export type SetImageProgress = { index: number; status: "waiting" | "working" | "ready" | "skipped"; stage: "planning" | "painting" | "checking" | "fixing" | null; path: string | null; url?: string };
export type SetReelProgress = { status: "waiting" | "pending" | "rendering" | "ready" | "failed"; visualId: string | null; path: string | null; url?: string; music: string | null; error: string | null };
export type SetProgress = {
  groupId: string;
  step: SetStep;
  label: string;
  done: number;
  total: number;
  /** 0 to 100, the real share of the work done (the screen animates its own ring over it). */
  percent: number;
  ready: boolean;
  failed: boolean;
  error: string | null;
  images: SetImageProgress[];
  reel: SetReelProgress | null;
};

type ConceptStage = { status: string };

/** Pure: one picture's units done and total, and what the screen shows for it. */
export function imageUnits(slide: VisualSlide, concept: ConceptStage | null): { done: number; total: number; image: Omit<SetImageProgress, "index"> } {
  if (slide.skipped) return { done: 0, total: 0, image: { status: "skipped", stage: null, path: null } };
  const ai = slide.source === "ai" && !slide.aiPhotoPath;
  if (slide.path) {
    const units = slide.source === "ai" ? 3 : 1;
    return { done: units, total: units, image: { status: "ready", stage: null, path: slide.path } };
  }
  if (!ai) return { done: 0, total: 1, image: { status: "waiting", stage: null, path: null } };
  if (!slide.conceptId || !concept) return { done: 0, total: 3, image: { status: slide.conceptId ? "working" : "waiting", stage: slide.conceptId ? "planning" : null, path: null } };
  switch (concept.status) {
    case "planned":
    case "painting":
      return { done: 1, total: 3, image: { status: "working", stage: "painting", path: null } };
    case "painted":
      return { done: 2, total: 3, image: { status: "working", stage: "checking", path: null } };
    case "fixing":
    case "edited":
      return { done: 3, total: 4, image: { status: "working", stage: "fixing", path: null } };
    default:
      // Done or failed in the engine: the next drawing step puts it on the slide (or the owner's photo instead).
      return { done: 3, total: 3, image: { status: "working", stage: null, path: null } };
  }
}

/** Pure: the whole set's progress from its picture visual, its slides' engine stages and its reel. */
export function setProgressOf(input: {
  groupId: string;
  picture: { status: string; error: string | null; plan: unknown } | null;
  concepts: ReadonlyMap<string, ConceptStage>;
  reel: { id: string; status: string; error: string | null; items: unknown; plan: unknown; renderingUntil: Date | null } | null;
  now: Date;
}): SetProgress {
  const plan = input.picture ? readImagePlan(input.picture.plan) : null;
  let done = 1;
  let total = 1;
  const images: SetImageProgress[] = (plan?.slides ?? []).map((slide, index) => {
    const u = imageUnits(slide, slide.conceptId ? (input.concepts.get(slide.conceptId) ?? null) : null);
    done += u.done;
    total += u.total;
    return { index, ...u.image };
  });
  const wantsReel = !!plan?.daySet?.reel || !!input.reel;
  let reel: SetReelProgress | null = null;
  if (wantsReel) {
    total += 2;
    const video = input.reel ? readVideoPlan(input.reel.plan) : null;
    const path = input.reel ? (readItems(input.reel.items)[0]?.path ?? null) : null;
    const rendering = !!input.reel && input.reel.status === "pending" && !!input.reel.renderingUntil && input.reel.renderingUntil > input.now;
    const status: SetReelProgress["status"] = !input.reel ? "waiting" : input.reel.status === "ready" ? "ready" : input.reel.status === "failed" ? "failed" : rendering ? "rendering" : "pending";
    if (input.reel) done += 1;
    if (status === "ready" || status === "failed") done += 1;
    reel = { status, visualId: input.reel?.id ?? null, path, music: video?.music?.title ?? null, error: input.reel?.error ?? null };
  }
  // A set with nothing to draw (no AI picture, no photo) has only its reel, made on the brand backdrop.
  const picturesDone = input.picture ? input.picture.status === "ready" || input.picture.status === "failed" : !!input.reel;
  const failed = input.picture?.status === "failed" && (!reel || reel.status === "failed" || reel.status === "waiting");
  const ready = !failed && picturesDone && (!reel || reel.status === "ready" || reel.status === "failed");
  const step: SetStep = !input.picture && !input.reel ? "captions" : ready || failed ? "ready" : !picturesDone ? "images" : reel?.status === "rendering" && reel.music ? "music" : "reel";
  if (ready || failed) done = total;
  return {
    groupId: input.groupId,
    step,
    label: SET_STEP_LABEL[step],
    done,
    total,
    percent: Math.round((100 * done) / Math.max(1, total)),
    ready,
    failed: !!failed,
    error: failed ? (input.picture?.error ?? "The pictures could not be made.") : null,
    images,
    reel,
  };
}

/** The progress of a business's sets (Post.groupId), read in three small queries. Unknown ids come back as "captions". */
export async function setProgress(businessId: string, groupIds: readonly string[], now = new Date()): Promise<SetProgress[]> {
  const ids = [...new Set(groupIds)].slice(0, 20);
  if (ids.length === 0) return [];
  const visuals = await prisma.contentVisual.findMany({
    where: { businessId, groupId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { id: true, groupId: true, kind: true, status: true, error: true, plan: true, items: true, renderingUntil: true, createdAt: true },
  });
  const conceptIds = visuals.flatMap((v) => (v.kind === "video" ? [] : (readImagePlan(v.plan)?.slides ?? []).flatMap((s) => (s.conceptId ? [s.conceptId] : []))));
  const concepts = conceptIds.length ? await prisma.imageConcept.findMany({ where: { businessId, id: { in: conceptIds } }, select: { id: true, status: true } }) : [];
  const stages = new Map(concepts.map((c) => [c.id, { status: c.status }]));
  return ids.map((groupId) => {
    const mine = visuals.filter((v) => v.groupId === groupId);
    const picture = mine.find((v) => v.kind !== "video") ?? null;
    // A remade day's set (lib/content-flow/set-remake.ts) gets a new reel from its new pictures: an older reel still on
    // a post waiting to go out is not this set's reel.
    const daySet = !!picture && !!readImagePlan(picture.plan)?.daySet;
    const reel = mine.find((v) => v.kind === "video" && (!daySet || !picture?.createdAt || !v.createdAt || v.createdAt >= picture.createdAt)) ?? null;
    return setProgressOf({ groupId, picture, concepts: stages, reel, now });
  });
}
