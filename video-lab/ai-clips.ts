// Video Studio: AI clips (docs/VIDEO_ENGINE.md, "Veo AI clips"). When a client picks "AI makes the clips", the studio
// asks Google Veo (lib/video-engine/veo.ts) for 2 to 3 short real moving clips of the product before the Motion design,
// and the designer mixes them in as full-frame video layers (their own audio muted: the video's music and voice-over
// are used). Flow: POST /api/ai-clips charges the credits (lib/video-engine/credits.ts veoClipCredits, from the plan's
// video credits for a client, the test wallet for the owner) and returns a run at once; the clips are made in the
// background, at most 3 at once, each tried once more on a temporary error; a failed or blocked clip gives its credits
// back. The page polls the run ("Making AI clip 2 of 3…"), then designs with the clips' ids (`aiClipIds`).
// Each clip is kept here (video-lab/data/veo, like the Seedance clips) and served same-origin at /videos/veo/<id>.mp4,
// scoped to its business; a client's clip is also saved into their BuPulse Gallery ("AI clips" folder) so they keep it.
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { ServiceDisabledError, isServiceEnabled } from "@/lib/admin/switch";
import { withLedger } from "@/lib/ai/ledger";
import { createAdminClient } from "@/lib/supabase/admin";
import { GALLERY_VIDEO_BUCKET } from "@/lib/media/rules";
import { MediaError, createFolder, finalizeUpload, prepareUploads, setAssetDescription } from "@/lib/media/service";
import { prisma } from "@/lib/db";
import { veoClipCredits } from "@/lib/video-engine/credits";
import type { BriefClip } from "@/lib/video-engine/designer";
import { VIDEO_LEDGER_FEATURES } from "@/lib/video-engine/ledger-features";
import {
  VEO_CLIPS_PER_VIDEO,
  VEO_PARALLEL,
  VeoError,
  defaultClipPlan,
  finishVeoOperation,
  isVeoSeconds,
  makeVeoClip,
  veoClipUsd,
  veoLedgerUsage,
  veoModel,
  veoPrompt,
  type ClipNeed,
  type VeoClip,
  type VeoRatio,
  type VeoSeconds,
} from "@/lib/video-engine/veo";
import { charge, refund, type Payer } from "./credits";
import { cutoutForPhoto } from "./cutouts";
import { getBusiness, listProducts, photoJpeg } from "./data-source";
import { DAILY_CAP_USD, record, spentToday } from "./store";
import type { StudioIdentity } from "./session";

// VEO_LAB_DIR lets the tests use a temporary folder.
const DATA = () => path.resolve(process.env.VEO_LAB_DIR || "video-lab/data/veo");
const CLIPS = () => path.join(DATA(), "clips");
const VIDEOS = () => path.join(DATA(), "videos");
const RUNS = () => path.join(DATA(), "runs");

export const AI_CLIP_ID = /^vc-[0-9a-f]{12}$/;
export const AI_RUN_ID = /^vr-[0-9a-f]{12}$/;
const newId = (prefix: "vc" | "vr") => `${prefix}-${randomBytes(6).toString("hex")}`;
/** The Gallery folder a client's AI clips are saved to, made the first time. */
export const AI_CLIPS_FOLDER = "AI clips";
const AI_CLIP_NOTE = "AI clip (Google Veo)";
/** Tries per clip: the first, and one more on a temporary error (Google busy, a timeout, the network). */
const TRIES = 2;

export class AiClipError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type AiClip = {
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  businessId: string;
  productId: string;
  /** Who asked: a client's company user, or null for the owner's tests (their wallet). */
  userId: string | null;
  actorId: string | null;
  need: ClipNeed;
  /** The prompt Veo was sent (the record of what was asked for). */
  prompt: string;
  photoId: string | null;
  model: string;
  ratio: VeoRatio;
  seconds: VeoSeconds;
  resolution: "720p";
  status: "queued" | "making" | "downloading" | "ready" | "failed";
  tries: number;
  operation: string | null;
  submittedAt: string | null;
  credits: number;
  /** Google's price of the clip, once made (Google bills only clips it makes). */
  costUsd: number;
  bytes: number | null;
  width: number;
  height: number;
  error: string | null;
  /** Where the credits came from, so a refund (also after a restart) goes back there. */
  payer: Payer;
  refunded: boolean;
  /** The client's Gallery copy (MediaAsset id and Storage path), when it was saved. */
  galleryAssetId?: string | null;
  galleryPath?: string | null;
};

export type AiClipRun = { id: string; createdAt: string; businessId: string; productId: string; clipIds: string[] };

// ---- Files ----------------------------------------------------------------------------------------------------------

async function writeJson(dir: string, id: string, value: unknown): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  // Written whole, then moved into place, so a poll never reads half a file.
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2));
  await fs.rename(`${file}.tmp`, file);
}
async function readJson<T>(dir: string, id: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

async function saveClip(clip: AiClip): Promise<void> {
  clip.updatedAt = new Date().toISOString();
  await writeJson(CLIPS(), clip.id, clip);
}
export const getAiClip = (id: string) => (AI_CLIP_ID.test(id) ? readJson<AiClip>(CLIPS(), id) : Promise.resolve(null));
export const getAiClipRun = (id: string) => (AI_RUN_ID.test(id) ? readJson<AiClipRun>(RUNS(), id) : Promise.resolve(null));

export async function aiClipBytes(id: string): Promise<Buffer | null> {
  if (!AI_CLIP_ID.test(id)) return null;
  return fs.readFile(path.join(VIDEOS(), `${id}.mp4`)).catch(() => null);
}

/** The business's clips (the owner: every clip), newest first. */
export async function listAiClips(businessId: string | null, limit = 60): Promise<AiClip[]> {
  const files = await fs.readdir(CLIPS()).catch(() => [] as string[]);
  const clips = await Promise.all(files.filter((f) => /^vc-[0-9a-f]{12}\.json$/.test(f)).map((f) => getAiClip(f.slice(0, -5))));
  return clips.filter((c): c is AiClip => !!c && (!businessId || c.businessId === businessId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

// ---- Views ----------------------------------------------------------------------------------------------------------

/** A clip as the page reads it (costUsd is the owner's: the server takes it out of a client's answers). */
export const aiClipView = (c: AiClip) => ({
  id: c.id,
  runId: c.runId,
  createdAt: c.createdAt,
  productId: c.productId,
  status: c.status,
  seconds: c.seconds,
  ratio: c.ratio,
  shot: c.need.shot,
  credits: c.credits,
  costUsd: c.costUsd,
  tries: c.tries,
  error: c.error,
  url: c.status === "ready" ? `/videos/veo/${c.id}.mp4` : null,
  inGallery: !!c.galleryAssetId,
});

/** "Making AI clip 2 of 3…": the clip being made is the first not finished, counted in the run's order. */
export function runMessage(clips: Pick<AiClip, "status" | "error">[]): string {
  const total = clips.length;
  const ready = clips.filter((c) => c.status === "ready").length;
  const failed = clips.filter((c) => c.status === "failed").length;
  if (ready + failed < total) {
    const at = Math.min(total, ready + failed + 1);
    return `Making AI clip ${at} of ${total}… (Google Veo takes about 1 minute a clip, up to 6 at busy times)`;
  }
  if (!failed) return `${total === 1 ? "The AI clip is" : `All ${total} AI clips are`} ready.`;
  if (!ready) return `${total === 1 ? "The AI clip" : "The AI clips"} could not be made: ${clips.find((c) => c.error)?.error ?? "Google Veo had a problem."} Your credits are back.`;
  return `${ready} of ${total} AI clips are ready; ${failed} could not be made (its credits are back).`;
}

export async function aiClipRunView(run: AiClipRun) {
  const clips = (await Promise.all(run.clipIds.map(getAiClip))).filter((c): c is AiClip => !!c);
  const done = clips.every((c) => c.status === "ready" || c.status === "failed");
  return { id: run.id, createdAt: run.createdAt, productId: run.productId, done, ready: clips.filter((c) => c.status === "ready").map((c) => c.id), message: runMessage(clips), clips: clips.map(aiClipView) };
}

// ---- Availability and prices ----------------------------------------------------------------------------------------

/** Why AI clips cannot be made right now (no Gemini key, or Veo switched off in Admin -> Services), or null. */
export async function aiClipsUnavailable(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (!env.GEMINI_API_KEY?.trim()) return "AI clips are not available right now: they are waiting for their Google key.";
  if (!(await isServiceEnabled("veo"))) return "AI clips are paused right now. Your video is made from your photos and your own clips.";
  return null;
}

export const aiClipPrices = () => Object.fromEntries(([4, 6, 8] as const).map((s) => [s, veoClipCredits(s)])) as Record<VeoSeconds, number>;

// ---- Making clips ---------------------------------------------------------------------------------------------------

/** The product photo as Veo's first frame: cropped to the clip's shape around the product, at the clip's size. */
export async function firstFrame(photo: Buffer, ratio: VeoRatio, box: { x: number; y: number; w: number; h: number } | null): Promise<Buffer> {
  const [width, height] = ratio === "9:16" ? [720, 1280] : [1280, 720];
  const img = sharp(photo).rotate();
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (box && w && h) {
    // The largest crop of the clip's shape, centred on the product's box (kept inside the photo).
    const scale = Math.min(w / width, h / height);
    const cw = Math.round(width * scale);
    const ch = Math.round(height * scale);
    const cx = (box.x + box.w / 2) * w;
    const cy = (box.y + box.h / 2) * h;
    const left = Math.max(0, Math.min(w - cw, Math.round(cx - cw / 2)));
    const top = Math.max(0, Math.min(h - ch, Math.round(cy - ch / 2)));
    return sharp(photo).rotate().extract({ left, top, width: cw, height: ch }).resize(width, height).jpeg({ quality: 88 }).toBuffer();
  }
  // No cut-out (a photo with a scene behind the product): sharp keeps the most interesting part.
  return img.resize(width, height, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 88 }).toBuffer();
}

/** Clip needs from the page or a recipe, checked: 1 to 3 shots of plain text. */
export function readNeeds(raw: unknown, seconds: VeoSeconds): ClipNeed[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const needs = raw
    .slice(0, 12)
    .map((n) => (typeof n === "string" ? { shot: n } : (n as Record<string, unknown>)))
    // A viral recipe's needs (brain/viral.ts ClipNeed) name their footage: only the AI ones are made here.
    .filter((n) => n?.source === undefined || n.source === "ai")
    .map((n) => ({ shot: str(n?.shot, 400), setting: str(n?.setting, 200) || null, camera: str(n?.camera, 120) || null, seconds: isVeoSeconds(n?.seconds) ? n.seconds : seconds, ...(n?.people === false ? { people: false } : {}) }))
    .filter((n) => n.shot.length >= 3)
    .slice(0, VEO_CLIPS_PER_VIDEO.max);
  return needs.length ? needs : null;
}

export type StartInput = { businessId: string; productId: string; count?: number; seconds?: number; ratio?: string; photoIds?: string[]; needs?: unknown };

/**
 * Starts a run of 1 to 3 clips: checks, credits taken, clips written, then made in the background. Returns at once.
 * Throws AiClipError in plain English before anything is charged.
 */
export async function startAiClips(who: StudioIdentity | null, input: StartInput, deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<AiClipRun> {
  const unavailable = await aiClipsUnavailable();
  if (unavailable) throw new AiClipError(unavailable, 503);
  const businessId = who?.businessId ?? input.businessId;
  const product = (await listProducts(businessId)).find((p) => p.id === input.productId);
  if (!product) throw new AiClipError("Pick a product first.", 404);
  const seconds: VeoSeconds = isVeoSeconds(Number(input.seconds)) ? (Number(input.seconds) as VeoSeconds) : 4;
  const ratio: VeoRatio = input.ratio === "16:9" ? "16:9" : "9:16";
  const business = await getBusiness(businessId);
  const facts = { productName: product.name, summary: product.summary, country: business?.country ?? null };
  const count = Math.max(1, Math.min(VEO_CLIPS_PER_VIDEO.max, Math.round(Number(input.count) || VEO_CLIPS_PER_VIDEO.max)));
  const needs = readNeeds(input.needs, seconds)?.slice(0, count) ?? defaultClipPlan(facts, count, seconds);
  // Photos: the ones the page chose (the product's, or the owner's uploads), else the product's album; one per clip in turn.
  const wanted = (Array.isArray(input.photoIds) ? input.photoIds.map(String) : []).filter((id) => product.photos.some((p) => p.assetId === id) || (!who && id.startsWith("up-")));
  const photoIds = wanted.length ? wanted : product.photos.map((p) => p.assetId);
  const model = veoModel();
  const credits = needs.map((n) => veoClipCredits(n.seconds ?? seconds, model));
  const total = credits.reduce((s, c) => s + c, 0);
  // The owner's tests stay inside the lab's daily budget (VIDEO_LAB_DAILY_USD).
  if (!who) {
    const spent = await spentToday();
    const worst = needs.reduce((s, n) => s + veoClipUsd(n.seconds ?? seconds, model), 0);
    if (spent + worst > DAILY_CAP_USD) throw new AiClipError(`Today's test budget is used: $${spent.toFixed(2)} of $${DAILY_CAP_USD.toFixed(2)}. More tomorrow (Kigali time).`, 429);
  }
  const run: AiClipRun = { id: newId("vr"), createdAt: new Date().toISOString(), businessId, productId: product.id, clipIds: [] };
  let payer: Payer;
  try {
    payer = await charge(total, `AI clips (Veo) x${needs.length}`, run.id);
  } catch (error) {
    throw new AiClipError(error instanceof Error ? error.message : "Not enough credits.", 402);
  }
  const now = new Date().toISOString();
  const clips: AiClip[] = needs.map((need, i) => {
    const photoId = photoIds.length ? photoIds[i % photoIds.length] : null;
    const s = need.seconds ?? seconds;
    return {
      id: newId("vc"),
      runId: run.id,
      createdAt: now,
      updatedAt: now,
      businessId,
      productId: product.id,
      userId: who?.companyUserId ?? null,
      actorId: who?.userId ?? null,
      need: { ...need, seconds: s },
      prompt: veoPrompt(need, facts, { withImage: !!photoId, ratio }),
      photoId,
      model,
      ratio,
      seconds: s,
      resolution: "720p",
      status: "queued",
      tries: 0,
      operation: null,
      submittedAt: null,
      credits: credits[i],
      costUsd: 0,
      bytes: null,
      width: ratio === "9:16" ? 720 : 1280,
      height: ratio === "9:16" ? 1280 : 720,
      error: null,
      payer,
      refunded: false,
    };
  });
  run.clipIds = clips.map((c) => c.id);
  try {
    for (const c of clips) await saveClip(c);
    await writeJson(RUNS(), run.id, run);
  } catch (error) {
    await refund(total, "AI clips not started", run.id, payer).catch(() => undefined);
    throw error;
  }
  void makeRun(clips, who, deps);
  return run;
}

/** Makes a run's clips, at most VEO_PARALLEL at once. Never throws (each clip ends ready or failed and refunded). */
async function makeRun(clips: AiClip[], who: StudioIdentity | null, deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<void> {
  const queue = [...clips];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) await makeOne(c, who, deps);
  };
  await Promise.all(Array.from({ length: Math.min(VEO_PARALLEL, clips.length) }, worker));
}

/** The plain-English reason a clip failed, for the page. */
export function clipProblem(error: unknown): string {
  if (error instanceof VeoError) return error.message;
  if (error instanceof ServiceDisabledError) return "AI clips are paused right now.";
  if (error instanceof Error && /BudgetExceeded/.test(error.name)) return "AI clips are paused for now (this month's AI budget is reached). Please try again later.";
  return "The AI clip could not be made.";
}

async function makeOne(clip: AiClip, who: StudioIdentity | null, deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  let photo: Buffer | null = null;
  if (clip.photoId) {
    try {
      const jpeg = await photoJpeg(clip.photoId, 1600, clip.photoId.startsWith("up-") ? undefined : clip.businessId);
      const cut = await cutoutForPhoto(clip.photoId, clip.photoId.startsWith("up-") ? undefined : clip.businessId).catch(() => null);
      photo = await firstFrame(jpeg.bytes, clip.ratio, cut?.ok ? cut.box : null);
    } catch {
      // The photo is gone: the clip is made from the prompt alone (it still names the product).
      photo = null;
    }
  }
  const request = { model: clip.model, prompt: clip.prompt, image: photo ? { base64: photo.toString("base64"), mimeType: "image/jpeg" as const } : null, ratio: clip.ratio, seconds: clip.seconds, resolution: clip.resolution };
  for (;;) {
    clip.tries += 1;
    clip.status = "making";
    clip.error = null;
    await saveClip(clip);
    try {
      const call = () =>
        makeVeoClip(request, {
          apiKey,
          fetchImpl: deps.fetchImpl,
          sleep: deps.sleep,
          onState: async (state, operation) => {
            if (state === "submitted") Object.assign(clip, { operation, submittedAt: new Date().toISOString() });
            else clip.status = "downloading";
            await saveClip(clip);
          },
        });
      const made = await ledgered(clip, who, call);
      await finish(clip, made, who);
      return;
    } catch (error) {
      const again = error instanceof VeoError && error.temporary && clip.tries < TRIES;
      console.log(`[lab] AI clip ${clip.id} try ${clip.tries} failed: ${error instanceof VeoError ? `${error.kind}${error.status ? ` ${error.status}` : ""}` : error instanceof Error ? error.name : "error"}`);
      if (again) {
        clip.operation = null;
        continue;
      }
      await failClip(clip, clipProblem(error));
      return;
    }
  }
}

/** A client's clip goes through the cost ledger (the Veo switch, the platform cap); the owner's into the lab ledger. */
async function ledgered(clip: AiClip, who: StudioIdentity | null, call: () => Promise<VeoClip>): Promise<VeoClip> {
  if (!who) {
    const made = await call();
    await record(clip.id, "veo-clip", [{ model: made.model, inputTokens: made.seconds, outputTokens: 0, costUsd: made.costUsd }]);
    return made;
  }
  return withLedger({ userId: who.userId, businessId: clip.businessId, feature: VIDEO_LEDGER_FEATURES.veo }, { provider: "veo", model: clip.model }, call, (r) => veoLedgerUsage(r.model, r.seconds));
}

async function finish(clip: AiClip, made: VeoClip, who: StudioIdentity | null): Promise<void> {
  await fs.mkdir(VIDEOS(), { recursive: true });
  await fs.writeFile(path.join(VIDEOS(), `${clip.id}.mp4`), made.bytes);
  Object.assign(clip, { status: "ready", costUsd: made.costUsd, bytes: made.bytes.length, error: null });
  await saveClip(clip);
  // The client keeps the clip in their Gallery too; a full Gallery does not fail the clip (it is in the video anyway).
  if (who) {
    const saved = await saveToGallery(who, clip, made.bytes).catch((error: unknown) => {
      console.log(`[lab] AI clip ${clip.id} not saved to the Gallery: ${error instanceof MediaError ? error.message : "error"}`);
      return null;
    });
    if (saved) {
      Object.assign(clip, { galleryAssetId: saved.id, galleryPath: saved.path });
      await saveClip(clip);
    }
  }
}

async function failClip(clip: AiClip, message: string): Promise<void> {
  clip.status = "failed";
  clip.error = message;
  if (!clip.refunded) {
    clip.refunded = true;
    await saveClip(clip);
    await refund(clip.credits, "AI clip failed", clip.id, clip.payer).catch(() => undefined);
  } else await saveClip(clip);
}

/**
 * After a restart: clips still on their way. One Google already accepted is waited for (and downloaded); one that was
 * never submitted is failed and refunded (nothing was billed).
 */
export async function resumeAiClips(deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<void> {
  const open = (await listAiClips(null, 500)).filter((c) => c.status !== "ready" && c.status !== "failed");
  await Promise.all(
    open.map(async (clip) => {
      if (!clip.operation) return failClip(clip, "The studio restarted before this clip was sent to Google. Your credits are back.");
      const who = clip.userId && clip.actorId ? ({ userId: clip.actorId, companyUserId: clip.userId, businessId: clip.businessId, role: "member" } as StudioIdentity) : null;
      try {
        const made = await ledgered(clip, who, () => finishVeoOperation(clip.operation as string, clip, { apiKey: process.env.GEMINI_API_KEY?.trim() ?? "", fetchImpl: deps.fetchImpl, sleep: deps.sleep, startedAt: Date.parse(clip.submittedAt ?? clip.createdAt) }));
        await finish(clip, made, who);
      } catch (error) {
        await failClip(clip, clipProblem(error));
      }
    }),
  );
}

// ---- The client's Gallery -------------------------------------------------------------------------------------------

async function clipsFolder(businessId: string): Promise<string> {
  const found = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: AI_CLIPS_FOLDER } }, select: { id: true } });
  if (found) return `folder:${found.id}`;
  try {
    return `folder:${(await createFolder(businessId, AI_CLIPS_FOLDER)).id}`;
  } catch (error) {
    const again = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: AI_CLIPS_FOLDER } }, select: { id: true } });
    if (again) return `folder:${again.id}`;
    throw error;
  }
}

/** Saves a clip into the client's Gallery through its own upload checks (file type, size, the video cap). */
async function saveToGallery(who: StudioIdentity, clip: AiClip, bytes: Buffer): Promise<{ id: string; path: string }> {
  const ctx = { userId: who.companyUserId, businessId: clip.businessId };
  const destination = await clipsFolder(clip.businessId);
  const name = `ai-clip-${clip.id}.mp4`;
  const [target] = await prepareUploads(ctx, [{ name, type: "video/mp4", size: bytes.length }], destination);
  if (!target?.ok) throw new MediaError(target?.error ?? "The clip could not be saved.");
  const up = await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).uploadToSignedUrl(target.path, target.token, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), { contentType: "video/mp4" });
  if (up.error) throw new MediaError("The clip did not upload.");
  const item = await finalizeUpload(ctx, { path: target.path, name, destination, width: clip.width, height: clip.height });
  await setAssetDescription(clip.businessId, item.id, `${AI_CLIP_NOTE}: ${clip.need.shot}`).catch(() => undefined);
  return { id: item.id, path: item.path };
}

// ---- Into the design ------------------------------------------------------------------------------------------------

/**
 * The finished clips a design may use, as the designer's brief takes them (lib/video-engine/designer.ts BriefClip):
 * same-origin addresses (placeClips keeps their own audio off). Only the business's own ready clips (any for the
 * owner); at most 3.
 */
export async function aiClipsForBrief(ids: unknown, businessId: string | null) {
  const wanted = (Array.isArray(ids) ? ids.map(String) : []).filter((id) => AI_CLIP_ID.test(id)).slice(0, VEO_CLIPS_PER_VIDEO.max);
  const clips = (await Promise.all(wanted.map(getAiClip))).filter((c): c is AiClip => !!c && c.status === "ready" && (!businessId || c.businessId === businessId));
  return clips.map((c): BriefClip => ({ path: `/videos/veo/${c.id}.mp4`, source: "ai", seconds: c.seconds, width: c.width, height: c.height, note: c.need.shot }));
}

/** What a design records about its AI clips (the job's brief): which clips, what was asked, the credits and the cost. */
export async function aiClipsRecord(ids: string[]) {
  const clips = (await Promise.all(ids.map(getAiClip))).filter((c): c is AiClip => !!c);
  if (!clips.length) return null;
  return {
    provider: "veo",
    model: clips[0].model,
    clips: clips.map((c) => ({ id: c.id, shot: c.need.shot, prompt: c.prompt, seconds: c.seconds, credits: c.credits, costUsd: c.costUsd })),
    credits: clips.reduce((s, c) => s + c.credits, 0),
    costUsd: Math.round(clips.reduce((s, c) => s + c.costUsd, 0) * 10_000) / 10_000,
  };
}
