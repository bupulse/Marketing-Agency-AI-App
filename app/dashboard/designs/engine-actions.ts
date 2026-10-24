"use server";

// The image engine's screen (components/designs/unique-ads.tsx, docs/IMAGE_ENGINE.md): plan a batch, paint it one
// picture per call (the screen calls paintImageStep until nothing is left), show it, like or dislike, change one.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CompanyBudgetExceededError } from "@/lib/ai/budget";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { ASPECT_RATIOS } from "@/lib/designs/layout";
import { DesignError, designUrls } from "@/lib/designs/service";
import { batchPictures, editPicture, EngineError, isWorking, MAX_BATCH, paintNext, planBatch, ratePicture, type BatchPicture } from "@/lib/image-engine/engine";
import { RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { UsageLimitError } from "@/lib/usage";

export type PictureView = BatchPicture & { url: string | null };
type Fail = { ok: false; error: string };

const startSchema = z.object({
  subjectId: z.string().min(1).max(60).nullish().transform((v) => v || null),
  brief: z.string().trim().max(800, "Keep the idea under 800 characters.").nullish().transform((v) => v || null),
  count: z.union([z.literal(4), z.literal(10), z.literal(20)]),
  quality: z.enum(["auto", "pro", "lite"]),
  aspectRatio: z.enum(ASPECT_RATIOS),
});

const id = z.string().min(1).max(60);

async function businessOf(userId: string) {
  return prisma.business.findUnique({ where: { userId }, select: { id: true } });
}

function failure(error: unknown, userId: string): Fail {
  if (error instanceof UsageLimitError) return { ok: false, error: "You have used your AI image credits for this month." };
  if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
  if (error instanceof EngineError || error instanceof DesignError || error instanceof FeatureRequiredError || error instanceof CompanyBudgetExceededError) return { ok: false, error: error.message };
  void logError(error, { source: "image-engine.action", userId });
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function withUrls(pictures: BatchPicture[]): Promise<PictureView[]> {
  const urls = await designUrls(pictures.flatMap((p) => (p.path ? [p.path] : [])));
  return pictures.map((p) => ({ ...p, url: p.path ? (urls.get(p.path) ?? null) : null }));
}

/** Plans a batch of 4, 10 or 20 unique pictures and reserves their credits (Lite 1, Pro 4). */
export async function startImageBatch(input: z.input<typeof startSchema>): Promise<{ ok: true; batchId: string; count: number; credits: number; pro: number } | Fail> {
  const user = await requireActiveUser();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the choices and try again." };
  const business = await businessOf(user.id);
  if (!business) return { ok: false, error: "Set up your business first." };
  try {
    await assertFeature(business.id, "aiPhotos");
    const count = Math.min(parsed.data.count, MAX_BATCH);
    return { ok: true, ...(await planBatch({ userId: user.id, businessId: business.id }, { source: "designs", ...parsed.data, count })) };
  } catch (error) {
    return failure(error, user.id);
  }
}

/**
 * The next step of the batch's next free picture (one AI call: paint, check or fix); `left` is false once every
 * picture is done or failed, and `idle` says no picture was free (the others are held by the other painters).
 */
export async function paintImageStep(batchId: string): Promise<{ ok: true; pictures: PictureView[]; left: boolean; idle: boolean } | Fail> {
  const user = await requireActiveUser();
  if (!id.safeParse(batchId).success) return { ok: false, error: "That batch was not found." };
  const business = await businessOf(user.id);
  if (!business) return { ok: false, error: "Set up your business first." };
  try {
    const stepped = await paintNext({ userId: user.id, businessId: business.id }, batchId);
    const pictures = await batchPictures(business.id, batchId);
    if (!pictures.length) return { ok: false, error: "That batch was not found." };
    if (pictures.every((p) => p.status === "done" || p.status === "failed")) revalidatePath("/dashboard/designs");
    return { ok: true, pictures: await withUrls(pictures), left: pictures.some((p) => isWorking(p.status)), idle: !stepped };
  } catch (error) {
    return failure(error, user.id);
  }
}

export async function ratePictureAction(pictureId: string, rating: 1 | -1 | null): Promise<{ ok: boolean }> {
  const user = await requireActiveUser();
  if (!id.safeParse(pictureId).success || ![1, -1, null].includes(rating)) return { ok: false };
  const business = await businessOf(user.id);
  if (!business) return { ok: false };
  await ratePicture(business.id, pictureId, rating);
  return { ok: true };
}

/** "Change this": the Editor makes a changed copy, for the picture's tier credits. */
export async function editPictureAction(pictureId: string, instruction: string): Promise<{ ok: true; picture: PictureView } | Fail> {
  const user = await requireActiveUser();
  if (!id.safeParse(pictureId).success || typeof instruction !== "string") return { ok: false, error: "That picture was not found." };
  const business = await businessOf(user.id);
  if (!business) return { ok: false, error: "Set up your business first." };
  try {
    await assertFeature(business.id, "aiPhotos");
    const picture = await editPicture({ userId: user.id, businessId: business.id }, pictureId, instruction);
    revalidatePath("/dashboard/designs");
    return { ok: true, picture: (await withUrls([picture]))[0] };
  } catch (error) {
    return failure(error, user.id);
  }
}
