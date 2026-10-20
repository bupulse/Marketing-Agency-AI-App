// A client's own photos in the studio (docs/STUDIO_DEPLOY.md, item 7): their uploads, AI images (Nano Banana) and
// presenter shots are photos in their BuPulse Gallery (MediaAsset, the Gallery's own checks and media quota), taken
// from their plan's video credits (15 for an AI image or a presenter shot). The owner's studio keeps the local
// uploads (video-lab/data/uploads) and the local wallet.
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { ServiceDisabledError } from "@/lib/admin/switch";
import { withLedger } from "@/lib/ai/ledger";
import { createAdminClient } from "@/lib/supabase/admin";
import { MediaError, createFolder, finalizeUpload, prepareUploads, setAssetDescription } from "@/lib/media/service";
import { VIDEO_LEDGER_FEATURES } from "@/lib/video-engine/ledger-features";
import { ClientJobError, asClientError } from "./client-jobs";
import { PRESENTER_IMAGE_CREDITS, charge, refund } from "./credits";
import { IMAGE_RATIOS, SHOT_ACTIONS, generateImage, makeShot, type ImageRun } from "./influencers";
import { listProducts, photoJpeg } from "./data-source";
import type { StudioIdentity } from "./session";

/** The Gallery folder studio photos go to, made the first time. */
export const STUDIO_IMAGES_FOLDER = "Studio images";
const AI_IMAGE_NOTE = "AI image (Nano Banana)";

async function imagesFolder(businessId: string): Promise<string> {
  const found = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: STUDIO_IMAGES_FOLDER } }, select: { id: true } });
  if (found) return `folder:${found.id}`;
  try {
    return `folder:${(await createFolder(businessId, STUDIO_IMAGES_FOLDER)).id}`;
  } catch (error) {
    const again = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: STUDIO_IMAGES_FOLDER } }, select: { id: true } });
    if (again) return `folder:${again.id}`;
    throw error;
  }
}

/**
 * Saves a photo (any format sharp reads, at most 2,000 px, as JPEG) into the business's Gallery and returns its id.
 * The Gallery's checks apply (file type and size read from the file, the media quota, the rate limit); `note` is what
 * Claude reads about the photo (the Gallery's "What's in this photo?").
 */
export async function saveClientPhoto(id: StudioIdentity, bytes: Buffer, name: string, note: string | null): Promise<{ id: string; width: number; height: number }> {
  const out = await sharp(bytes)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw new ClientJobError("That file is not a photo we can read (use JPG, PNG or WebP).", 400);
    });
  const ctx = { userId: id.companyUserId, businessId: id.businessId };
  const destination = await imagesFolder(id.businessId);
  const fileName = `${name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "studio-photo"}.jpg`;
  const [target] = await prepareUploads(ctx, [{ name: fileName, type: "image/jpeg", size: out.data.length }], destination);
  if (!target?.ok) throw new MediaError(target?.error ?? "The photo could not be saved. Please try again.");
  const up = await createAdminClient().storage.from("media").uploadToSignedUrl(target.path, target.token, new Blob([new Uint8Array(out.data)], { type: "image/jpeg" }), { contentType: "image/jpeg" });
  if (up.error) throw new ClientJobError("The photo did not upload. Please try again.", 502);
  const item = await finalizeUpload(ctx, { path: target.path, name: fileName, destination, width: out.info.width, height: out.info.height });
  if (note) await setAssetDescription(id.businessId, item.id, note).catch(() => undefined);
  return { id: item.id, width: out.info.width, height: out.info.height };
}

/** The client's upload from the page (a reference photo). */
export async function uploadForClient(id: StudioIdentity, bytes: Buffer, fileName: string) {
  try {
    return await saveClientPhoto(id, bytes, fileName, null);
  } catch (error) {
    throw await asClientError(error, 0, id.companyUserId);
  }
}

/** Gemini through the cost ledger ("video-image": the Gemini switch, the platform cap, the company's allowance). */
const ledgered = (id: StudioIdentity): ImageRun => (call) =>
  withLedger({ userId: id.userId, businessId: id.businessId, feature: VIDEO_LEDGER_FEATURES.image }, { provider: "gemini", model: process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image" }, call, (r) => ({
    provider: "gemini",
    model: r.call.model,
    usage: { inputTokens: r.call.inputTokens, outputTokens: r.call.outputTokens },
    images: 1,
  }));

/** The plain message for a Gemini failure, and the credits given back by the caller. */
const imageProblem = (error: unknown) => (error instanceof ServiceDisabledError ? "Images are paused right now. Please try again later." : `${error instanceof Error ? error.message : "The image could not be made."}`);

/** An AI image (Nano Banana): 15 credits taken first, given back when Gemini fails; saved in the Gallery. */
export async function aiImageForClient(id: StudioIdentity, body: Record<string, unknown>) {
  const prompt = String(body.prompt ?? "").trim().slice(0, 1500);
  if (!prompt) throw new ClientJobError("Describe the image first.", 400);
  const ratio = (IMAGE_RATIOS as readonly string[]).includes(String(body.ratio)) ? String(body.ratio) : "1:1";
  // References are the business's own photos (ids of Gallery photos); the page's "ph:" and "up:" ids both end here.
  const refs = (Array.isArray(body.refs) ? body.refs : []).map(String).slice(0, 3);
  const references: Buffer[] = [];
  for (const r of refs) {
    const [kind, assetId] = r.split(":");
    if ((kind !== "ph" && kind !== "up") || !assetId) continue;
    references.push((await photoJpeg(assetId, 1280, id.businessId).catch(() => null))?.bytes ?? Buffer.alloc(0));
  }
  const refsOk = references.filter((b) => b.length);
  const payer = await charge(PRESENTER_IMAGE_CREDITS, "AI image (Nano Banana)").catch(async (error: unknown) => {
    throw new ClientJobError(error instanceof Error ? error.message : "Not enough credits.", 402);
  });
  try {
    const made = await generateImage(prompt, refsOk, ratio, ledgered(id));
    const saved = await saveClientPhoto(id, made.bytes, `AI image ${prompt.slice(0, 40)}`, `${AI_IMAGE_NOTE}: ${prompt}`);
    return { image: { id: saved.id, at: new Date().toISOString(), prompt, ratio, references: refsOk.length, url: `/api/photo/${saved.id}` }, credits: PRESENTER_IMAGE_CREDITS };
  } catch (error) {
    await refund(PRESENTER_IMAGE_CREDITS, "AI image failed", undefined, payer);
    if (error instanceof ClientJobError || error instanceof MediaError) throw error instanceof MediaError ? new ClientJobError(error.message, 400) : error;
    throw new ClientJobError(`${imageProblem(error)} The credits are given back.`, 502);
  }
}

/** The business's AI images, newest first (their Gallery photos noted as AI images). */
export async function listAiImages(id: StudioIdentity) {
  const rows = await prisma.mediaAsset.findMany({ where: { businessId: id.businessId, kind: "photo", description: { startsWith: AI_IMAGE_NOTE } }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, createdAt: true, description: true, width: true, height: true } });
  const ratioOf = (w: number | null, h: number | null) => {
    if (!w || !h) return "1:1";
    const r = w / h;
    return (IMAGE_RATIOS as readonly string[]).reduce((best, x) => (Math.abs(eval2(x) - r) < Math.abs(eval2(best) - r) ? x : best), "1:1");
  };
  return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), prompt: (r.description ?? "").replace(`${AI_IMAGE_NOTE}: `, ""), ratio: ratioOf(r.width, r.height), references: 0, url: `/api/photo/${r.id}` }));
}
const eval2 = (ratio: string) => {
  const [a, b] = ratio.split(":").map(Number);
  return a / b;
};

/** A presenter shot (the fictional presenter holding the client's product): 15 credits, saved in the Gallery. */
export async function presenterShotForClient(id: StudioIdentity, influencerId: string, body: Record<string, unknown>) {
  const product = (await listProducts(id.businessId)).find((x) => x.id === String(body.productId ?? ""));
  if (!product) throw new ClientJobError("Product not found.", 404);
  const photoId = String(body.photoId ?? product.photos[0]?.assetId ?? "");
  if (!photoId) throw new ClientJobError("This product has no photo for the presenter to hold.", 400);
  const photo = await photoJpeg(photoId, 1280, id.businessId).catch(() => null);
  if (!photo) throw new ClientJobError("Photo not found.", 404);
  const action = SHOT_ACTIONS.find((a) => a.id === String(body.action)) ?? SHOT_ACTIONS[0];
  const payer = await charge(PRESENTER_IMAGE_CREDITS, "Presenter shot").catch(async (error: unknown) => {
    throw new ClientJobError(error instanceof Error ? error.message : "Not enough credits.", 402);
  });
  try {
    const out = await makeShot(influencerId, { name: product.name, photo: photo.bytes }, action.id, typeof body.setting === "string" ? body.setting : null, ["9:16", "3:4", "1:1", "4:3", "16:9"].includes(String(body.ratio)) ? String(body.ratio) : "9:16", {
      run: ledgered(id),
      save: (bytes, note) => saveClientPhoto(id, bytes, `presenter ${product.name}`.slice(0, 60), note),
    });
    return { uploadId: out.uploadId };
  } catch (error) {
    await refund(PRESENTER_IMAGE_CREDITS, "Presenter shot failed", undefined, payer);
    if (error instanceof ClientJobError) throw error;
    throw new ClientJobError(`${error instanceof MediaError ? error.message : imageProblem(error)} The credits are given back.`, error instanceof MediaError ? 400 : 502);
  }
}
