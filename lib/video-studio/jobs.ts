import "server-only";
import { prisma } from "@/lib/db";
import { assertServiceEnabled, ServiceDisabledError } from "@/lib/admin/switch";
import { withLedger } from "@/lib/ai/ledger";
import { consumeUsage, refundUsage } from "@/lib/usage";
import { scoreCaption } from "@/lib/video-engine/brain/score";
import { brainBriefFromDesign, brainContext, brainFor } from "@/lib/video-engine/brain/select";
import { CLAUDE_VIDEO_CREDITS } from "@/lib/video-engine/credits";
import { DESIGNER_MODEL, DesignError, apiTransport, designVideo, recipeForBrief, type BriefClip, type ClaudeTransport, type DesignBrief, type DesignMode, type Platform } from "@/lib/video-engine/designer";
import { recipeWhy, type ViralRecipe } from "@/lib/video-engine/brain/viral";
import { isViralStyle } from "@/lib/video-engine/templates";
import { VIDEO_LEDGER_FEATURES } from "@/lib/video-engine/ledger-features";
import type { MotionSpec, Ratio } from "@/lib/video-engine/spec";
import { BriefError, choosePhotos, loadBriefFacts, readPhotos, type StoredPhoto } from "./brief";

// Video Studio jobs in the app (docs/VIDEO_APP_INTEGRATION.md, task 5): a Motion design is a VideoJob. The credits are
// reserved first (consumeUsage "videoCredits"), the job rows are written next, then Claude designs each version
// through the API key ONLY (never the lab's subscription transport), every call recorded by withLedger
// ("video-design"). A version that fails gives its credits back. The browser draws and encodes the MP4 later.

/**
 * How long a design may run before the sweep (/api/cron/video-jobs) may fail it and give the credits back: longer than
 * the route's 300 s, so a request still working is never swept.
 */
export const DESIGN_LEASE_MS = 10 * 60_000;

export class VideoStudioError extends Error {
  constructor(
    message: string,
    public code: "unavailable" | "not_found" | "invalid",
    public status: number,
  ) {
    super(message);
    this.name = "VideoStudioError";
  }
}

/** What a design request asks for (already validated by the route). */
export type DesignJobInput = {
  productId: string;
  /** Gallery photo paths; empty or absent: the product's album. */
  photoPaths?: string[];
  templateId: string;
  hookId: string;
  ratio: Ratio;
  seconds: number;
  note?: string | null;
  mode: Exclude<DesignMode, "edit" | "extend"> | "edit" | "extend";
  /** The job an edit or extend changes. */
  parentId?: string | null;
  fixedLens?: boolean;
  cartoonId?: string | null;
  platform?: Platform | null;
  /** 1 to 4 versions, each a job, each charged. */
  versions?: number;
  /** Whether the video will get a voice-over (the score then checks the spoken lines). */
  voice?: boolean;
  /** An opening line the owner picked from the Brain's suggestions (lib/video-studio/library.ts openingLines). */
  chosenHook?: { hookId: string; line: string } | null;
  /** An ad (the default) or an organic post on the business's own page: no price or contact hooks, a quieter caption. */
  purpose?: "ad" | "post";
  /** Video clips the design may place (the client's phone clips, AI clips), already checked as the business's own. */
  clips?: BriefClip[];
  /** The AI clip step is on: a viral recipe may ask for AI clips (the veo step makes them). */
  aiClips?: boolean;
  /** What the AI clips in `clips` were asked for and cost (the studio's video-lab/ai-clips.ts), kept in the job's brief. */
  aiClipsRecord?: object | null;
  /** The viral recipe the AI clips were made for (video-lab/ai-clips.ts aiClipRecipe): version 1 follows it. */
  aiClipRecipe?: ViralRecipe | null;
};

export type VideoJobView = {
  id: string;
  status: string;
  engine: string;
  spec: MotionSpec | null;
  caption: string;
  hashtags: string[];
  warnings: unknown;
  score: unknown;
  captionScore: unknown;
  credits: number;
  error: string | null;
  parentId: string | null;
  productId: string | null;
  templateId: string | null;
  platform: string | null;
  ratio: string;
  seconds: number;
  /** The MP4 in the Gallery, once the browser made it (status "ready"). */
  videoPath: string | null;
  /** Whether the owner asked for a voice-over (the MP4 step then records it). */
  voice: boolean;
  /** The library track in the MP4 (its title, and the credit line its licence asks for, if any). */
  music: { trackId: string; title: string; credit: string | null } | null;
  /** A viral video's "Why this video" lines (plain English, no names) and the viral ids its techniques came from. */
  viral: { why: string[]; sources: string[] } | null;
  createdAt: string;
};

/** The company account (Business.userId, whose credits are used), the person, and the business. */
export type StudioOwner = { userId: string; actorId: string; businessId: string };

/** Claude with the API key, each call through the cost ledger (and so the Claude switch and the platform cap). */
export function ledgeredClaude(apiKey: string, owner: StudioOwner, fetchImpl?: typeof fetch): ClaudeTransport {
  const send = apiTransport(apiKey, fetchImpl);
  return (call) =>
    withLedger({ userId: owner.actorId, businessId: owner.businessId, feature: VIDEO_LEDGER_FEATURES.design }, { provider: "claude", model: call.model }, () => send(call), (r) => ({ provider: "claude", model: r.usage.model, usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens } }));
}

/** Why design cannot run right now (no API key, or Claude switched off), before anything is charged; null when it can. */
export async function designUnavailable(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY?.trim()) return "Video design is not available right now: it is waiting for its AI key. Please try again later.";
  try {
    await assertServiceEnabled("claude");
  } catch (error) {
    if (error instanceof ServiceDisabledError) return "Video design is paused right now. Please try again later.";
    throw error;
  }
  return null;
}

export type JobRow = { id: string; status: string; engine: string; spec: unknown; caption: string; hashtags: string[]; warnings: unknown; score: unknown; captionScore: unknown; credits: number; error: string | null; parentId: string | null; productId?: string | null; templateId?: string | null; platform?: string | null; ratio?: string; seconds?: number; videoPath?: string | null; brief?: unknown; music?: unknown; createdAt: Date };

function musicOf(v: unknown): VideoJobView["music"] {
  const m = v as { trackId?: unknown; title?: unknown; attribution?: unknown; owned?: unknown } | null | undefined;
  if (!m || typeof m.trackId !== "string" || typeof m.title !== "string") return null;
  return { trackId: m.trackId, title: m.title, credit: m.owned === false && typeof m.attribution === "string" && m.attribution.trim() ? m.attribution : null };
}

export const view = (j: JobRow): VideoJobView => ({
  id: j.id,
  status: j.status,
  engine: j.engine,
  spec: (j.spec as MotionSpec | null) ?? null,
  caption: j.caption,
  hashtags: j.hashtags,
  warnings: j.warnings,
  score: j.score,
  captionScore: j.captionScore,
  credits: j.credits,
  error: j.error,
  parentId: j.parentId,
  productId: j.productId ?? null,
  templateId: j.templateId ?? null,
  platform: j.platform ?? null,
  ratio: j.ratio ?? "9:16",
  seconds: j.seconds ?? 15,
  videoPath: j.videoPath ?? null,
  voice: (j.brief as { voice?: unknown } | null | undefined)?.voice !== false,
  music: musicOf(j.music),
  viral: viralOf(j.brief),
  createdAt: j.createdAt.toISOString(),
});

/** The recipe a job's brief keeps (styleId "viral"), or null. */
export function recipeOf(brief: unknown): ViralRecipe | null {
  const r = (brief as { recipe?: ViralRecipe } | null | undefined)?.recipe;
  return r && r.version === 1 && Array.isArray(r.sources) && Array.isArray(r.beats) ? r : null;
}
function viralOf(brief: unknown): VideoJobView["viral"] {
  const r = recipeOf(brief);
  return r ? { why: recipeWhy(r), sources: r.sources.map((s) => s.id) } : null;
}

/** How many of the business's recent recipes a new one avoids (another opening, layout and beat order). */
export const RECENT_RECIPES = 5;

/** The business's last viral recipes, newest first: a new video avoids repeating them. */
export async function recentRecipes(businessId: string): Promise<ViralRecipe[]> {
  const rows = await prisma.videoJob.findMany({ where: { businessId, engine: "motion", templateId: "viral", mode: { notIn: ["edit", "extend"] } }, orderBy: { createdAt: "desc" }, take: RECENT_RECIPES, select: { brief: true } });
  return rows.map((r) => recipeOf(r.brief)).filter((r): r is ViralRecipe => !!r);
}

/**
 * Designs 1 to 4 versions of a Motion video. Order: checks (key, switch, product, photos, parent) → credits reserved →
 * job rows written → Claude → each job saved or failed (and refunded). Throws VideoStudioError before anything is
 * charged; UsageLimitError (lib/usage.ts) when the credits are used up. Never charges a version that failed.
 */
export async function designMotionJobs(owner: StudioOwner, input: DesignJobInput, deps: { env?: Record<string, string | undefined>; transport?: ClaudeTransport; model?: string } = {}): Promise<VideoJobView[]> {
  const env = deps.env ?? process.env;
  const unavailable = await designUnavailable(env);
  if (unavailable) throw new VideoStudioError(unavailable, "unavailable", 503);

  const facts = await loadBriefFacts(owner.businessId, input.productId);
  let base: MotionSpec | null = null;
  let parentPhotos: string[] | null = null;
  let parentRecipe: ViralRecipe | null = null;
  if (input.mode === "edit" || input.mode === "extend") {
    const parent = input.parentId ? await prisma.videoJob.findFirst({ where: { id: input.parentId, businessId: owner.businessId, engine: "motion" }, select: { spec: true, brief: true } }) : null;
    if (!parent?.spec) throw new VideoStudioError("Choose the video to change: it was not found.", "not_found", 404);
    base = parent.spec as unknown as MotionSpec;
    // The design's photo numbers refer to the parent's photos: an edit or extend keeps them, whatever the album says now.
    parentPhotos = ((parent.brief as { photos?: StoredPhoto[] } | null)?.photos ?? []).map((p) => p.path);
    parentRecipe = recipeOf(parent.brief);
  }
  const chosen =
    input.mode === "text"
      ? []
      : await choosePhotos(owner.businessId, facts.productId, parentPhotos ?? input.photoPaths ?? null).catch((error: unknown) => {
          if (parentPhotos && error instanceof BriefError) throw new VideoStudioError("A photo this video uses was deleted from your Gallery, so it cannot be changed. Make a new video instead.", "invalid", 400);
          throw error;
        });
  const photos = await readPhotos(chosen);
  const stored: StoredPhoto[] = chosen.map(({ path, width, height, note }) => ({ path, width, height, note }));

  const versions = Math.min(4, Math.max(1, Math.round(input.versions ?? 1)));
  // A viral video (the default) avoids the business's recent recipes: read before anything is charged.
  const changing = input.mode === "edit" || input.mode === "extend";
  const viral = isViralStyle(input.templateId);
  const recent = viral && !changing ? await recentRecipes(owner.businessId) : [];
  // Credits first: a blocked company leaves nothing behind (no job, no call).
  const reservation = await consumeUsage(owner.userId, "videoCredits", CLAUDE_VIDEO_CREDITS * versions);

  const brief: DesignBrief = {
    business: facts.business,
    product: facts.product,
    photos,
    styleId: input.templateId,
    hookId: input.hookId,
    ratio: base?.ratio ?? input.ratio,
    seconds: input.seconds,
    note: input.note ?? null,
    mode: input.mode,
    base,
    fixedLens: input.fixedLens ?? false,
    cartoonId: input.cartoonId ?? null,
    platform: input.platform ?? null,
    voice: input.voice ?? true,
    purpose: input.purpose === "post" ? "post" : "ad",
    clips: input.mode === "text" ? [] : (input.clips ?? []),
  };
  // A viral video: one recipe per version, each avoiding the business's recent ones and the versions before it. An
  // edit or extend keeps its parent's recipe for "Why this video" but designs from the parent itself.
  const recipes: ViralRecipe[] = [];
  if (viral && !changing) for (let i = 0; i < versions; i++) recipes.push(i === 0 && input.aiClipRecipe ? input.aiClipRecipe : recipeForBrief(brief, { seed: globalThis.crypto.randomUUID(), recent: [...recipes.slice().reverse(), ...recent], aiClips: input.aiClips }));
  // The opening line the owner picked: the Brain's context for it goes in as research (Claude follows it), as in the lab.
  if (input.chosenHook && !changing) brief.research = brainContext(brainBriefFromDesign({ ...brief, recipe: recipes[0] ?? null }), { chosenHook: input.chosenHook, viral: viral });
  // The caption formula the Brain picks for this brief (the one its research block gives Claude): kept with the
  // caption check, so the video's outcome says which formula it was (lib/video-studio/outcomes.ts).
  const captionFormulaId = brainFor(brainBriefFromDesign(brief)).caption.formula.id;
  // The job keeps the brief without the image bytes (photos as their Storage paths).
  const storedBrief = { ...brief, photos: stored, base: undefined, ...(input.aiClipsRecord ? { aiClips: input.aiClipsRecord } : {}) };
  const recipeFor = (i: number) => recipes[i] ?? (viral ? parentRecipe : null);
  const jobs = await prisma.$transaction(
    Array.from({ length: versions }, (_, i) =>
      prisma.videoJob.create({
        data: { businessId: owner.businessId, userId: owner.actorId, productId: facts.productId, parentId: input.parentId ?? null, engine: "motion", mode: input.mode, status: "designing", templateId: input.templateId, hookId: input.hookId, platform: input.platform ?? null, ratio: brief.ratio, seconds: Math.min(30, Math.max(4, Math.round(input.seconds))), brief: { ...storedBrief, ...(recipeFor(i) ? { recipe: recipeFor(i) } : {}) } as object, credits: CLAUDE_VIDEO_CREDITS, periodStart: reservation.periodStart, leaseUntil: new Date(Date.now() + DESIGN_LEASE_MS) },
        select: { id: true },
      }),
    ),
  ).catch(async (error: unknown) => {
    await refundUsage(owner.userId, "videoCredits", reservation.periodStart, CLAUDE_VIDEO_CREDITS * versions).catch(() => {});
    throw error;
  });

  const transport = deps.transport ?? ledgeredClaude(env.ANTHROPIC_API_KEY as string, owner);
  const model = deps.model ?? DESIGNER_MODEL;
  const done = await Promise.all(
    jobs.map(async ({ id }, i) => {
      try {
        const result = await designVideo({ ...brief, recipe: recipes[i] ?? null, variation: versions > 1 ? { index: i + 1, of: versions } : null }, { transport, model });
        const captionScore = scoreCaption(result.spec.caption, result.spec.hashtags, { business: brief.business, product: brief.product, styleId: brief.styleId, seconds: brief.seconds, platform: brief.platform ?? null, note: brief.note ?? null }, { platform: brief.platform ?? null, purpose: brief.purpose ?? "ad" });
        // Finished only if still ours: once the lease passed, the sweep may have failed and refunded it (then it stays so).
        await prisma.videoJob.updateMany({
          where: { id, status: "designing", refundedAt: null },
          data: { status: "designed", spec: result.spec as object, caption: result.spec.caption, hashtags: result.spec.hashtags, warnings: (result.warnings ?? []) as object, score: (result.score ?? null) as object, captionScore: { ...captionScore, formulaId: captionFormulaId } as object, costUsd: result.apiEquivalentUsd, seconds: Math.min(30, Math.max(4, Math.round(result.spec.scenes.reduce((s, x) => s + x.seconds, 0)))), leaseUntil: null, error: null },
        });
        return await prisma.videoJob.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        const message = error instanceof DesignError || error instanceof ServiceDisabledError ? error.message : error instanceof Error && error.name.endsWith("BudgetExceededError") ? error.message : "The design could not be made. Your credits are back; please try again.";
        // Refunded once: only if this request still holds the job (the sweep refunds the ones it took).
        const { count } = await prisma.videoJob.updateMany({ where: { id, status: "designing", refundedAt: null }, data: { status: "failed", error: message, refundedAt: new Date(), leaseUntil: null } });
        if (count === 1) await refundUsage(owner.userId, "videoCredits", reservation.periodStart, CLAUDE_VIDEO_CREDITS).catch(() => {});
        return prisma.videoJob.findUniqueOrThrow({ where: { id } });
      }
    }),
  );
  return done.map(view);
}
