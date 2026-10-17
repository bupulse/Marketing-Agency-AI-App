import "server-only";
import { prisma } from "@/lib/db";
import { assertServiceEnabled, ServiceDisabledError } from "@/lib/admin/switch";
import { withLedger } from "@/lib/ai/ledger";
import { consumeUsage, refundUsage } from "@/lib/usage";
import { scoreCaption } from "@/lib/video-engine/brain/score";
import { CLAUDE_VIDEO_CREDITS } from "@/lib/video-engine/credits";
import { DESIGNER_MODEL, DesignError, apiTransport, designVideo, type ClaudeTransport, type DesignBrief, type DesignMode, type Platform } from "@/lib/video-engine/designer";
import { VIDEO_LEDGER_FEATURES } from "@/lib/video-engine/ledger-features";
import type { MotionSpec, Ratio } from "@/lib/video-engine/spec";
import { choosePhotos, loadBriefFacts, readPhotos, type StoredPhoto } from "./brief";

// Video Studio jobs in the app (docs/VIDEO_APP_INTEGRATION.md, task 5): a Motion design is a VideoJob. The credits are
// reserved first (consumeUsage "videoCredits"), the job rows are written next, then Claude designs each version
// through the API key ONLY (never the lab's subscription transport), every call recorded by withLedger
// ("video-design"). A version that fails gives its credits back. The browser draws and encodes the MP4 later.

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

const view = (j: { id: string; status: string; engine: string; spec: unknown; caption: string; hashtags: string[]; warnings: unknown; score: unknown; captionScore: unknown; credits: number; error: string | null; parentId: string | null; createdAt: Date }): VideoJobView => ({
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
  createdAt: j.createdAt.toISOString(),
});

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
  if (input.mode === "edit" || input.mode === "extend") {
    const parent = input.parentId ? await prisma.videoJob.findFirst({ where: { id: input.parentId, businessId: owner.businessId, engine: "motion" }, select: { spec: true } }) : null;
    if (!parent?.spec) throw new VideoStudioError("Choose the video to change: it was not found.", "not_found", 404);
    base = parent.spec as unknown as MotionSpec;
  }
  const chosen = input.mode === "text" ? [] : await choosePhotos(owner.businessId, facts.productId, input.photoPaths ?? null);
  const photos = await readPhotos(chosen);
  const stored: StoredPhoto[] = chosen.map(({ path, width, height, note }) => ({ path, width, height, note }));

  const versions = Math.min(4, Math.max(1, Math.round(input.versions ?? 1)));
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
  };
  // The job keeps the brief without the image bytes (photos as their Storage paths).
  const storedBrief = { ...brief, photos: stored, base: undefined };
  const jobs = await prisma.$transaction(
    Array.from({ length: versions }, () =>
      prisma.videoJob.create({
        data: { businessId: owner.businessId, userId: owner.actorId, productId: facts.productId, parentId: input.parentId ?? null, engine: "motion", mode: input.mode, status: "designing", templateId: input.templateId, hookId: input.hookId, platform: input.platform ?? null, ratio: brief.ratio, seconds: Math.min(30, Math.max(4, Math.round(input.seconds))), brief: storedBrief as object, credits: CLAUDE_VIDEO_CREDITS, periodStart: reservation.periodStart, leaseUntil: new Date(Date.now() + 5 * 60_000) },
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
        const result = await designVideo({ ...brief, variation: versions > 1 ? { index: i + 1, of: versions } : null }, { transport, model });
        const captionScore = scoreCaption(result.spec.caption, result.spec.hashtags, { business: brief.business, product: brief.product, styleId: brief.styleId, seconds: brief.seconds, platform: brief.platform ?? null, note: brief.note ?? null }, { platform: brief.platform ?? null });
        return await prisma.videoJob.update({
          where: { id },
          data: { status: "designed", spec: result.spec as object, caption: result.spec.caption, hashtags: result.spec.hashtags, warnings: (result.warnings ?? []) as object, score: (result.score ?? null) as object, captionScore: captionScore as object, costUsd: result.apiEquivalentUsd, seconds: Math.min(30, Math.max(4, Math.round(result.spec.scenes.reduce((s, x) => s + x.seconds, 0)))), leaseUntil: null, error: null },
        });
      } catch (error) {
        const message = error instanceof DesignError || error instanceof ServiceDisabledError ? error.message : error instanceof Error && error.name.endsWith("BudgetExceededError") ? error.message : "The design could not be made. Your credits are back; please try again.";
        await refundUsage(owner.userId, "videoCredits", reservation.periodStart, CLAUDE_VIDEO_CREDITS).catch(() => {});
        return prisma.videoJob.update({ where: { id }, data: { status: "failed", error: message, refundedAt: new Date(), leaseUntil: null } });
      }
    }),
  );
  return done.map(view);
}
