import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { isServiceEnabled } from "@/lib/admin/switch";
import { logError } from "@/lib/errors";
import { MediaError, prepareUploads } from "@/lib/media/service";
import { GALLERY_VIDEO_BUCKET } from "@/lib/media/rules";
import { musicUrl, trackForVideo } from "@/lib/music/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeUsage, refundUsage } from "@/lib/usage";
import { designBlenderScene } from "@/lib/video-engine/blender-design";
import { PREMIUM_3D_CREDITS, PREMIUM_RERENDER_CREDITS, type PremiumQuality } from "@/lib/video-engine/credits";
import { makeCutout } from "@/lib/video-engine/cutout";
import { DESIGNER_MODEL, type ClaudeTransport, type DesignBrief, type Platform } from "@/lib/video-engine/designer";
import type { Ratio } from "@/lib/video-engine/spec";
import type { BlenderPhoto, BlenderScene } from "@/tools/blender/scene";
import { choosePhotos, loadBriefFacts, readPhotos, type StoredPhoto } from "./brief";
import { DESIGN_LEASE_MS, VideoStudioError, designUnavailable, ledgeredClaude, type StudioOwner } from "./jobs";
import { saveJobVideo, studioFolder } from "./library";

// Premium 3D clips as VideoJobs (docs/STUDIO_DEPLOY.md, build item 9; docs/BLENDER.md). A client's clip is a VideoJob
// row with engine "premium3d": the credits are reserved first (PREMIUM_3D_CREDITS, 100 at 540p, 150 at 720p), the row is
// written "designing", Claude designs one Blender scene through ledgeredClaude (the API key; the owner's test studio
// may pass the subscription transport), and the row turns "queued" with its scene. The studio computer's render loop
// (startPremiumRenderLoop, one render at a time, shared with the owner's own tests) claims the oldest queued row,
// renders it with Blender (the renderer is passed in: Blender lives in the studio, never in the app), uploads the MP4 to
// the Gallery's "Video Studio" folder and finalises it with saveJobVideo, so it lands in BuPulse's Videos library. A
// re-render is a child job (PREMIUM_RERENDER_CREDITS, the parent's scene at either resolution). Every failure gives the
// credits back exactly once: the row is claimed with a conditional update first (as the sweep does). After a restart,
// recoverPremiumJobs reads the database: a design that was running in the stopped process is failed and refunded, and a
// render that was running goes back in the queue (once). The client switch is the "premium3d" service (Admin ->
// Services), off until the owner turns it on: until then clients see "coming soon". A voice-over is not made for client
// clips yet (music from the library only); the owner's local clips keep theirs (video-lab/premium-jobs.ts).

export const PREMIUM_ENGINE = "premium3d";
/** How long one render may hold its row: Blender's own limit (30 minutes) and the upload. */
export const RENDER_LEASE_MS = 40 * 60_000;
/** Renders tried per job: the first, and once more after a restart stopped it. */
export const RENDER_TRIES = 2;

export const PREMIUM_MESSAGES = {
  comingSoon: "Premium 3D is coming soon.",
  design: "The 3D scene could not be designed. Your credits are back; please try again.",
  render: "The 3D clip could not be rendered. Your credits are back; please try again.",
  restart: "The studio restarted while this 3D clip was being made. Your credits are back; please try again.",
  notSaved: "The 3D clip was made but could not be saved to your Gallery. Your credits are back; please try again.",
} as const;

/** What a Premium 3D request asks for (already checked by the route). */
export type PremiumJobInput = {
  productId: string;
  /** Gallery photo paths; none: the product's album. */
  photoPaths?: string[];
  templateId: string;
  hookId: string;
  ratio: Ratio;
  seconds: number;
  note?: string | null;
  platform?: Platform | null;
  purpose?: "ad" | "post";
  quality: PremiumQuality;
  /** A library music track under the clip (Blender mixes it). */
  music?: boolean;
};

/** Blender, as the studio runs it (video-lab/blender-jobs.ts renderBlenderScene). */
export type PremiumRenderer = (scene: BlenderScene, outPath: string, opts: { photos: BlenderPhoto[]; jobDir: string; music?: string; onProgress?: (fraction: number) => void }) => Promise<{ bytes: number; seconds: number }>;

export type PremiumDeps = {
  env?: Record<string, string | undefined>;
  transport?: ClaudeTransport;
  model?: string;
  /** The studio computer's folder for the photo files Blender reads and the MP4s (one folder per job). */
  dataDir: string;
  /** Called when a row turns "queued", so the render loop looks at once. */
  onQueued?: () => void;
  fetchImpl?: typeof fetch;
};

/** The brief a job keeps: the design brief without image bytes, plus what the render needs. */
type StoredBrief = Omit<DesignBrief, "photos" | "base"> & { photos: StoredPhoto[]; music?: boolean; say?: string; repairs?: string[] };

/** Why Premium 3D cannot start for a client right now, before anything is charged; null when it can. */
export async function premiumUnavailable(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (!(await isServiceEnabled("premium3d"))) return PREMIUM_MESSAGES.comingSoon;
  return designUnavailable(env);
}

// ---- Progress (the studio computer's memory: a render reports its frames here) ---------------------------------------

const progress = new Map<string, number>();
/** 0 to 1 while a job renders on this computer; null otherwise. */
export const premiumProgress = (jobId: string): number | null => progress.get(jobId) ?? null;

// ---- Failing once ----------------------------------------------------------------------------------------------------

/**
 * Fails a job still in one of `from` and gives its credits back, exactly once (the conditional update claims it).
 * Returns false when something else finished or failed it meanwhile.
 */
export async function failPremiumOnce(id: string, message: string, from: string[]): Promise<boolean> {
  const { count } = await prisma.videoJob.updateMany({ where: { id, engine: PREMIUM_ENGINE, status: { in: from }, refundedAt: null }, data: { status: "failed", error: message, refundedAt: new Date(), leaseUntil: null } });
  progress.delete(id);
  if (count !== 1) return false;
  const job = await prisma.videoJob.findUnique({ where: { id }, select: { credits: true, periodStart: true, business: { select: { userId: true } } } });
  if (job && job.credits > 0 && job.periodStart) await refundUsage(job.business.userId, "videoCredits", job.periodStart, job.credits).catch((error: unknown) => logError(error, { source: "video.premium.refund" }).catch(() => {}));
  return true;
}

// ---- Photo files for Blender -----------------------------------------------------------------------------------------

const jobDir = (deps: Pick<PremiumDeps, "dataDir">, id: string) => path.join(deps.dataDir, id);

/** A cut-out's width / height (Blender sizes the product by it). */
async function aspectOf(png: Buffer): Promise<number | null> {
  const m = await sharp(png).metadata().catch(() => null);
  return m?.width && m.height ? Math.round((m.width / m.height) * 1000) / 1000 : null;
}

/**
 * Writes the job's photos where Blender reads them (photo-N.jpg, and photo-N-cutout.png when the product lifts off a
 * plain background), from the brief's photos. Paths are the server's own: none comes from the browser or from Claude.
 */
export async function writePhotoFiles(dir: string, photos: { base64: string }[]): Promise<BlenderPhoto[]> {
  await fs.mkdir(dir, { recursive: true });
  const out: BlenderPhoto[] = [];
  for (const [i, p] of photos.entries()) {
    const jpeg = await sharp(Buffer.from(p.base64, "base64")).rotate().jpeg({ quality: 90 }).toBuffer();
    const image = path.join(dir, `photo-${i + 1}.jpg`);
    await fs.writeFile(image, jpeg);
    const cut = await makeCutout(jpeg).catch(() => null);
    let cutout: string | null = null;
    if (cut?.ok) {
      cutout = path.join(dir, `photo-${i + 1}-cutout.png`);
      await fs.writeFile(cutout, cut.png);
    }
    out.push({ image, cutout, cutoutAspect: cut?.ok ? await aspectOf(cut.png) : null });
  }
  return out;
}

/** The photo files for a render: the ones written at design time, or written again from the Gallery (after a move). */
async function photoFilesFor(dir: string, stored: StoredPhoto[]): Promise<BlenderPhoto[]> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  if (stored.length && stored.every((_, i) => files.includes(`photo-${i + 1}.jpg`))) {
    return Promise.all(
      stored.map(async (_, i) => {
        const cutout = files.includes(`photo-${i + 1}-cutout.png`) ? path.join(dir, `photo-${i + 1}-cutout.png`) : null;
        return { image: path.join(dir, `photo-${i + 1}.jpg`), cutout, cutoutAspect: cutout ? await aspectOf(await fs.readFile(cutout)) : null };
      }),
    );
  }
  const photos = await readPhotos(stored.map((p) => ({ ...p, cutoutBox: null, cutoutPath: null })));
  return writePhotoFiles(dir, photos);
}

// ---- Starting a clip ---------------------------------------------------------------------------------------------------

/**
 * Starts a Premium 3D clip: checks (the switch, the Claude key, the product and photos) → credits reserved → the row
 * written "designing" → returns its id at once; Claude designs the scene in the background and the row turns "queued"
 * for the render loop. Throws VideoStudioError before anything is charged; UsageLimitError when credits are used up.
 */
export async function startPremiumJob(owner: StudioOwner, input: PremiumJobInput, deps: PremiumDeps): Promise<string> {
  const env = deps.env ?? process.env;
  const unavailable = await premiumUnavailable(env);
  if (unavailable) throw new VideoStudioError(unavailable, "unavailable", 503);
  const facts = await loadBriefFacts(owner.businessId, input.productId);
  const chosen = await choosePhotos(owner.businessId, facts.productId, input.photoPaths ?? null);
  if (!chosen.length) throw new VideoStudioError("Premium 3D needs at least one product photo. Add one in your Gallery first.", "invalid", 400);
  const photos = await readPhotos(chosen);
  const credits = PREMIUM_3D_CREDITS[input.quality];
  // Credits first: a blocked company leaves nothing behind (no job, no call).
  const reservation = await consumeUsage(owner.userId, "videoCredits", credits);
  const brief: DesignBrief = {
    business: facts.business,
    product: facts.product,
    photos,
    styleId: input.templateId,
    hookId: input.hookId,
    ratio: input.ratio,
    seconds: Math.min(8, Math.max(4, Math.round(input.seconds))),
    note: input.note ?? null,
    mode: "reference",
    platform: input.platform ?? null,
    purpose: input.purpose === "post" ? "post" : "ad",
  };
  const stored: StoredBrief = { ...brief, photos: chosen.map(({ path: p, width, height, note }) => ({ path: p, width, height, note })), music: input.music !== false };
  const row = await prisma.videoJob
    .create({
      data: { businessId: owner.businessId, userId: owner.actorId, productId: facts.productId, engine: PREMIUM_ENGINE, mode: "reference", status: "designing", templateId: input.templateId, hookId: input.hookId, platform: input.platform ?? null, ratio: input.ratio, seconds: brief.seconds, quality: input.quality, brief: stored as object, credits, periodStart: reservation.periodStart, leaseUntil: new Date(Date.now() + DESIGN_LEASE_MS) },
      select: { id: true },
    })
    .catch(async (error: unknown) => {
      await refundUsage(owner.userId, "videoCredits", reservation.periodStart, credits).catch(() => {});
      throw error;
    });
  void designPremium(row.id, owner, brief, stored, input.quality, deps);
  return row.id;
}

/** Designs the scene and queues the row; a failure fails it once with the credits back. Never throws. */
async function designPremium(id: string, owner: StudioOwner, brief: DesignBrief, stored: StoredBrief, quality: PremiumQuality, deps: PremiumDeps): Promise<void> {
  try {
    const files = await writePhotoFiles(jobDir(deps, id), brief.photos);
    const transport = deps.transport ?? ledgeredClaude((deps.env ?? process.env).ANTHROPIC_API_KEY as string, owner);
    const design = await designBlenderScene(brief, transport, deps.model ?? DESIGNER_MODEL, { photos: files, quality });
    // Queued only if still ours: the sweep may have failed and refunded it once its lease passed.
    const { count } = await prisma.videoJob.updateMany({
      where: { id, status: "designing", refundedAt: null },
      data: {
        status: "queued",
        scene: design.scene as object,
        caption: design.caption,
        hashtags: design.hashtags,
        warnings: design.factWarnings as object,
        costUsd: design.apiEquivalentUsd,
        seconds: Math.max(1, Math.round(design.scene.duration)),
        brief: { ...stored, say: design.say, repairs: design.warnings } as object,
        leaseUntil: null,
        error: null,
      },
    });
    if (count === 1) deps.onQueued?.();
  } catch (error) {
    const message = error instanceof Error && /budget|paused|unavailable/i.test(error.message) ? `${error.message} Your credits are back.` : PREMIUM_MESSAGES.design;
    await logError(error, { source: "video.premium.design" }).catch(() => {});
    await failPremiumOnce(id, message, ["designing"]);
  }
}

/**
 * A finished clip rendered again (no new design: the same scene and photos) at either resolution, as a child job:
 * PREMIUM_RERENDER_CREDITS, given back when it fails. Throws in plain English when the clip cannot be re-rendered.
 */
export async function rerenderPremiumJob(owner: StudioOwner, parentId: string, quality: PremiumQuality, deps: Pick<PremiumDeps, "onQueued" | "env">): Promise<string> {
  if (!(await isServiceEnabled("premium3d"))) throw new VideoStudioError(PREMIUM_MESSAGES.comingSoon, "unavailable", 503);
  const parent = await prisma.videoJob.findFirst({ where: { id: parentId, businessId: owner.businessId, engine: PREMIUM_ENGINE }, select: { id: true, status: true, scene: true, brief: true, productId: true, templateId: true, hookId: true, platform: true, ratio: true, seconds: true, caption: true, hashtags: true, warnings: true } });
  if (!parent || parent.status !== "ready" || !parent.scene) throw new VideoStudioError("Only a finished 3D clip can be rendered again.", "not_found", 404);
  const reservation = await consumeUsage(owner.userId, "videoCredits", PREMIUM_RERENDER_CREDITS);
  const scene = parent.scene as unknown as BlenderScene;
  const row = await prisma.videoJob
    .create({
      data: {
        businessId: owner.businessId,
        userId: owner.actorId,
        productId: parent.productId,
        parentId: parent.id,
        engine: PREMIUM_ENGINE,
        mode: "rerender",
        status: "queued",
        templateId: parent.templateId,
        hookId: parent.hookId,
        platform: parent.platform,
        ratio: parent.ratio,
        seconds: parent.seconds,
        quality,
        brief: parent.brief as object,
        scene: { ...scene, canvas: { ...scene.canvas, quality } } as object,
        caption: parent.caption,
        hashtags: parent.hashtags,
        warnings: (parent.warnings ?? []) as object,
        credits: PREMIUM_RERENDER_CREDITS,
        periodStart: reservation.periodStart,
      },
      select: { id: true },
    })
    .catch(async (error: unknown) => {
      await refundUsage(owner.userId, "videoCredits", reservation.periodStart, PREMIUM_RERENDER_CREDITS).catch(() => {});
      throw error;
    });
  deps.onQueued?.();
  return row.id;
}

// ---- The render loop (the studio computer) ----------------------------------------------------------------------------

/** Claims the oldest queued Premium 3D row (conditional update: one renderer per row). */
async function claimNext(now: Date): Promise<string | null> {
  const next = await prisma.videoJob.findMany({ where: { engine: PREMIUM_ENGINE, status: "queued" }, orderBy: { createdAt: "asc" }, take: 5, select: { id: true } });
  for (const { id } of next) {
    const { count } = await prisma.videoJob.updateMany({ where: { id, status: "queued" }, data: { status: "rendering", leaseUntil: new Date(now.getTime() + RENDER_LEASE_MS), attempts: { increment: 1 } } });
    if (count === 1) return id;
  }
  return null;
}

/** The library track under a clip, written into its folder (Blender mixes it); null for none. */
async function musicFile(dir: string, id: string, fetchImpl: typeof fetch): Promise<{ file: string; trackId: string } | null> {
  const track = await trackForVideo("upbeat", id);
  if (!track) return null;
  try {
    const res = await fetchImpl(musicUrl(track.path), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const file = path.join(dir, "music.mp3");
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    return { file, trackId: track.trackId };
  } catch {
    return null;
  }
}

/**
 * Renders the next queued clip, if any: claims it, renders it with Blender, uploads the MP4 into the Gallery and
 * finalises it (saveJobVideo: the row turns "ready"). A failed render or save fails the row once with the credits back.
 */
export async function renderNextPremiumJob(deps: { render: PremiumRenderer; dataDir: string; fetchImpl?: typeof fetch; now?: () => Date }): Promise<"none" | "ready" | "failed"> {
  const id = await claimNext((deps.now ?? (() => new Date()))());
  if (!id) return "none";
  const job = await prisma.videoJob.findUniqueOrThrow({ where: { id }, select: { id: true, businessId: true, parentId: true, quality: true, scene: true, brief: true, product: { select: { name: true } }, business: { select: { userId: true } } } });
  const brief = job.brief as unknown as StoredBrief;
  const dir = jobDir(deps, id);
  let out: { bytes: number; seconds: number };
  let music: { file: string; trackId: string } | null = null;
  try {
    // A re-render reads its parent's photo files when they are still on this computer.
    const photos = await photoFilesFor(job.parentId && (await fs.stat(jobDir(deps, job.parentId)).catch(() => null)) ? jobDir(deps, job.parentId) : dir, brief.photos ?? []);
    await fs.mkdir(dir, { recursive: true });
    if (brief.music !== false) music = await musicFile(dir, id, deps.fetchImpl ?? fetch);
    const scene = job.scene as unknown as BlenderScene;
    progress.set(id, 0);
    out = await deps.render({ ...scene, canvas: { ...scene.canvas, quality: (job.quality as PremiumQuality) ?? scene.canvas.quality } }, path.join(dir, "clip.mp4"), {
      photos,
      jobDir: dir,
      ...(music ? { music: music.file } : {}),
      onProgress: (f) => progress.set(id, Math.round(f * 100) / 100),
    });
  } catch (error) {
    await logError(error, { source: "video.premium.render" }).catch(() => {});
    return (await failPremiumOnce(id, PREMIUM_MESSAGES.render, ["rendering"])) ? "failed" : "none";
  }
  try {
    const bytes = await fs.readFile(path.join(dir, "clip.mp4"));
    const ctx = { userId: job.business.userId, businessId: job.businessId };
    const destination = await studioFolder(job.businessId);
    const [target] = await prepareUploads(ctx, [{ name: `premium-3d-${id}.mp4`, type: "video/mp4", size: bytes.length }], destination);
    if (!target?.ok) throw new MediaError(target?.error ?? "The clip could not be saved.");
    const up = await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).uploadToSignedUrl(target.path, target.token, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), { contentType: "video/mp4" });
    if (up.error) throw new Error("upload failed");
    await saveJobVideo(ctx, id, { path: target.path, destination, name: `${job.product?.name ?? "Premium 3D"} - 3D clip`.slice(0, 120), width: null, height: null, musicTrackId: music?.trackId ?? null }, { engine: PREMIUM_ENGINE });
    await prisma.videoJob.update({ where: { id }, data: { leaseUntil: null, durationMs: Math.round(out.seconds * 1000) } }).catch(() => undefined);
    progress.delete(id);
    return "ready";
  } catch (error) {
    await logError(error, { source: "video.premium.save" }).catch(() => {});
    return (await failPremiumOnce(id, error instanceof MediaError ? `${error.message} Your credits are back.` : PREMIUM_MESSAGES.notSaved, ["rendering"])) ? "failed" : "none";
  }
}

/**
 * The studio computer's loop: looks for queued clips every `intervalMs` (and at once when `poke` is called), and renders
 * them one after another through `serial` (the studio's oneRenderAtATime, shared with the owner's own renders, so
 * Blender never runs twice at once). Returns poke and stop.
 */
export function startPremiumRenderLoop(deps: { render: PremiumRenderer; dataDir: string; serial: <T>(work: () => Promise<T>) => Promise<T>; intervalMs?: number; fetchImpl?: typeof fetch }): { poke: () => void; stop: () => void } {
  let busy = false;
  let stopped = false;
  const drain = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      while (!stopped && (await deps.serial(() => renderNextPremiumJob(deps))) !== "none");
    } catch (error) {
      await logError(error, { source: "video.premium.loop" }).catch(() => {});
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void drain(), deps.intervalMs ?? 15_000);
  timer.unref?.();
  void drain();
  return {
    poke: () => void drain(),
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/**
 * On start (the studio computer): a design that was running in the stopped process cannot finish, so it is failed with
 * its credits back; a render that was running goes back in the queue, once (RENDER_TRIES), else it is failed too.
 */
export async function recoverPremiumJobs(): Promise<{ failed: number; requeued: number }> {
  const open = await prisma.videoJob.findMany({ where: { engine: PREMIUM_ENGINE, status: { in: ["designing", "rendering"] } }, select: { id: true, status: true, attempts: true } });
  const result = { failed: 0, requeued: 0 };
  for (const job of open) {
    if (job.status === "rendering" && job.attempts < RENDER_TRIES) {
      const { count } = await prisma.videoJob.updateMany({ where: { id: job.id, status: "rendering" }, data: { status: "queued", leaseUntil: null } });
      result.requeued += count;
      continue;
    }
    if (await failPremiumOnce(job.id, PREMIUM_MESSAGES.restart, [job.status])) result.failed += 1;
  }
  return result;
}
