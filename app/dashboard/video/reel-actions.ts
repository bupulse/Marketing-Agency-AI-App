"use server";

// The temporary reel engine's screen (components/video/unique-reels.tsx, docs/REEL_ENGINE.md): plan a reel, film it one
// step per call (the screen calls stepReelAction until the clips are ready), join it in the browser, save it.
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { ReelError, finishReel, reelTestCapUsd, reelTestSpentUsd, reelUploadTarget, reelView, startReel, stepReel, type ReelView } from "@/lib/reel-engine/engine";
import { REEL_LANGUAGES } from "@/lib/reel-engine/story";
import { can } from "@/lib/team/roles";

type Fail = { ok: false; error: string };
const id = z.string().min(1).max(60);
const startSchema = z.object({
  subjectId: z.string().min(1).max(60).nullish().transform((v) => v || null),
  brief: z.string().trim().max(800, "Keep the idea under 800 characters.").nullish().transform((v) => v || null),
  language: z.enum(REEL_LANGUAGES),
  tier: z.enum(["lite", "fast"]),
});

async function ownerOf() {
  const user = await requireActiveUser();
  if (!can(user.role, "content")) return null;
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  return business ? { userId: user.id, businessId: business.id } : null;
}

function failure(error: unknown, userId: string): Fail {
  if (error instanceof ReelError) return { ok: false, error: error.message };
  if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
  if ((error as Error)?.name === "VeoError") return { ok: false, error: (error as Error).message };
  void logError(error, { source: "reel-engine.action", userId });
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function startReelAction(input: z.input<typeof startSchema>): Promise<{ ok: true; id: string } | Fail> {
  const owner = await ownerOf();
  if (!owner) return { ok: false, error: "You cannot make reels for this business." };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the choices and try again." };
  try {
    await rateLimit(`reel:${owner.userId}`, { limit: 4, windowSeconds: 60 * 60 });
    return { ok: true, id: await startReel(owner, parsed.data) };
  } catch (error) {
    return failure(error, owner.userId);
  }
}

/** One step on the reel (a start frame, sending clips to Veo, or checking them), then where it stands. */
export async function stepReelAction(jobId: string): Promise<{ ok: true; reel: ReelView; spent: number; cap: number } | Fail> {
  const owner = await ownerOf();
  if (!owner || !id.safeParse(jobId).success) return { ok: false, error: "That reel was not found." };
  try {
    await stepReel(owner, jobId);
    const reel = await reelView(owner, jobId);
    if (!reel) return { ok: false, error: "That reel was not found." };
    return { ok: true, reel, spent: await reelTestSpentUsd(), cap: reelTestCapUsd() };
  } catch (error) {
    return failure(error, owner.userId);
  }
}

export async function reelUploadAction(jobId: string): Promise<{ ok: true; path: string; token: string } | Fail> {
  const owner = await ownerOf();
  if (!owner || !id.safeParse(jobId).success) return { ok: false, error: "That reel was not found." };
  try {
    return { ok: true, ...(await reelUploadTarget(owner, jobId)) };
  } catch (error) {
    return failure(error, owner.userId);
  }
}

export async function finishReelAction(jobId: string): Promise<{ ok: true; reel: ReelView } | Fail> {
  const owner = await ownerOf();
  if (!owner || !id.safeParse(jobId).success) return { ok: false, error: "That reel was not found." };
  try {
    await finishReel(owner, jobId);
    return { ok: true, reel: (await reelView(owner, jobId))! };
  } catch (error) {
    return failure(error, owner.userId);
  }
}
