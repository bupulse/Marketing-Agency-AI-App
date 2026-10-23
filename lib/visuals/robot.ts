// The video robot (docs/VIDEO_ROBOT.md): a scheduled GitHub Actions job that makes pending content videos in headless
// Chrome with the same browser renderer, so nobody has to open the post. This is its server side: hand out a few
// videos at a time under the render lease, take the finished file through the same checks, billing and hooks as the
// browser (prepareVideoUpload, finalizeVideo), and count failures. Storage paths and database ids never leave the
// server except inside the short-lived signed URLs the robot needs.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { recordCron } from "@/lib/admin/cron-run";
import { isOwnDesignPath, isOwnPhotoPath } from "@/lib/designs/assets";
import { bucketForPath } from "@/lib/publishing/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";
import { finalizeVideo, prepareVideoUpload, ROBOT_LEASE_MS, videoAvailable, VisualError } from "./service";
import { VIDEO_LIMITS, type VideoPlan } from "./types";
import { readVideoPlan } from "./video-plan";
import { CLIP_WORKING } from "./ai-clips";
import { clipPathsOf, isOwnClipPath } from "./clip-scenes";
import { musicUrl } from "@/lib/music/service";
import { ensureVoiceover } from "@/lib/voice/service";

export { ROBOT_LEASE_MS };
/** Failed robot renders after which the video is left to the owner's browser ("needs browser render"). */
export const ROBOT_MAX_ATTEMPTS = 3;
/** Videos handed out per claim by default, and at most. */
export const ROBOT_DEFAULT_CLAIM = 3;
export const ROBOT_MAX_CLAIM = 5;
/** Videos the robot may claim in an hour: in all, and per company (a stuck or abused robot cannot burn through storage). */
export const ROBOT_CLAIMS_PER_HOUR: RateLimitRule = { limit: 60, windowSeconds: 60 * 60 };
export const ROBOT_CLAIMS_PER_BUSINESS_HOUR: RateLimitRule = { limit: 10, windowSeconds: 60 * 60 };
/** Pending videos looked at per claim (some may belong to companies without videos left). */
const ROBOT_SCAN = 25;
/** Lifetime of the photo download URLs: enough for one run. */
const PHOTO_URL_SECONDS = 30 * 60;
/** The heartbeat job name (CronRun), shown on the admin Services and Health pages. */
export const ROBOT_JOB = "video-robot";

/** Why a robot render failed; only these short codes are accepted (no free text from the robot is stored). */
export const ROBOT_FAILURES = ["render_failed", "unsupported", "timeout", "too_large", "upload_failed", "complete_failed"] as const;
export type RobotFailure = (typeof ROBOT_FAILURES)[number];
export const isRobotFailure = (value: unknown): value is RobotFailure => typeof value === "string" && (ROBOT_FAILURES as readonly string[]).includes(value);

export type RobotFormat = "mp4" | "webm";
const MIME: Record<RobotFormat, "video/mp4" | "video/webm"> = { mp4: "video/mp4", webm: "video/webm" };

/** The robot is on when its secret is set. Without it the API answers 404 and the screens offer only the browser. */
export function robotEnabled(): boolean {
  return !!process.env.VIDEO_ROBOT_SECRET;
}

/**
 * Pending videos the robot may take: plan ready, not made, fewer than 3 robot failures, no live lease, and no AI clips
 * still being made for it (lib/visuals/ai-clips.ts: it waits for them).
 */
export function robotWaitingWhere(now: Date) {
  return {
    kind: "video",
    status: "pending",
    robotAttempts: { lt: ROBOT_MAX_ATTEMPTS },
    AND: [{ OR: [{ renderingUntil: null }, { renderingUntil: { lt: now } }] }, { OR: [{ clipState: null }, { clipState: { notIn: [...CLIP_WORKING] } }] }],
  };
}

/** How the owner's screen describes a pending video while the robot is on. */
export type RobotState = "queued" | "making" | "browser" | null;

export function robotStateOf(row: { kind: string; status: string; robotAttempts: number; robotJobId: string | null; renderingUntil: Date | null }, now = new Date()): RobotState {
  if (!robotEnabled() || row.kind !== "video" || row.status !== "pending") return null;
  if (row.robotJobId && row.renderingUntil && row.renderingUntil > now) return "making";
  if (row.robotAttempts >= ROBOT_MAX_ATTEMPTS) return "browser";
  return "queued";
}

/** How many videos wait for the robot (the workflow skips installing anything when there are none). */
export async function peekRobotVideos(now = new Date()): Promise<number> {
  return prisma.contentVisual.count({ where: robotWaitingWhere(now) });
}

export interface RobotJob {
  /** Random, opaque, valid while the lease lasts. */
  job: string;
  plan: VideoPlan;
  /** Signed download URLs of the scene photos, keyed by the plan's photo paths (what the renderer looks up). */
  photoUrls: Record<string, string>;
  /** Signed download URLs of the scenes' AI clips (MP4), keyed by their paths; a clip missing here shows its photo. */
  clipUrls: Record<string, string>;
  /** The voiceover (signed) and the library track (public), when the video has them (docs/VOICE_AND_MUSIC.md). */
  audioUrls: { voice?: string; music?: string };
  /** Where to PUT the file: a signed upload URL reserved through the same checks as the browser's upload. */
  upload: { url: string; contentType: "video/mp4" | "video/webm" };
  /** When the lease ends; the robot gives up on the video before then. */
  leaseUntil: string;
}

/** Signed URLs for the scene photos that really are the owner's (a photo path the owner does not own is skipped). */
async function signScenePhotos(userId: string, plan: VideoPlan): Promise<Record<string, string>> {
  const paths = [...new Set(plan.scenes.flatMap((s) => (s.photoPath ? [s.photoPath] : [])))].filter((p) => isOwnPhotoPath(userId, p) || isOwnDesignPath(userId, p));
  const byBucket = new Map<ReturnType<typeof bucketForPath>, string[]>();
  for (const p of paths) byBucket.set(bucketForPath(p), [...(byBucket.get(bucketForPath(p)) ?? []), p]);
  const out: Record<string, string> = {};
  const storage = createAdminClient().storage;
  await Promise.all(
    [...byBucket].map(async ([bucket, list]) => {
      const { data } = await storage.from(bucket).createSignedUrls(list, PHOTO_URL_SECONDS);
      for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
    }),
  );
  return out;
}

/** Signed URLs for the plan's AI clips that are the owner's own (lib/visuals/ai-clips.ts). */
export async function signClips(userId: string, plan: VideoPlan, seconds = PHOTO_URL_SECONDS): Promise<Record<string, string>> {
  const paths = clipPathsOf(plan).filter((p) => isOwnClipPath(userId, p));
  if (paths.length === 0) return {};
  const { data } = await createAdminClient().storage.from("media").createSignedUrls(paths, seconds);
  return Object.fromEntries((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl]] : [])));
}

/**
 * The voiceover (signed, only the company's own file; or the audio itself when it could not be stored) and the
 * library track (public) of a plan.
 */
export async function audioUrlsFor(businessId: string, plan: VideoPlan, voiceDataUrl?: string): Promise<{ voice?: string; music?: string }> {
  const out: { voice?: string; music?: string } = {};
  const voice = plan.voice?.enabled !== false ? plan.voice?.path : null;
  if (voiceDataUrl && plan.voice?.enabled !== false) out.voice = voiceDataUrl;
  else if (voice && voice.startsWith(`voice/${businessId}/`) && !voice.includes("..")) {
    const { data } = await createAdminClient().storage.from("media").createSignedUrl(voice, PHOTO_URL_SECONDS);
    if (data?.signedUrl) out.voice = data.signedUrl;
  }
  if (plan.music?.path) out.music = musicUrl(plan.music.path);
  return out;
}

async function releaseLease(id: string, job: string, data: { robotAttempts?: { increment: number } | { decrement: number } } = {}) {
  await prisma.contentVisual.updateMany({ where: { id, robotJobId: job }, data: { renderingUntil: null, robotJobId: null, ...data } });
}

/**
 * Claims up to `max` pending videos, oldest first. Each is leased atomically (compare-and-set on the lease, so two
 * robot runs, or a robot and an owner's browser, never make the same video), then given an upload reservation through
 * prepareVideoUpload: plan feature, videos left, media quota, platform guard and open uploads are checked
 * exactly as for the browser. A video that fails those checks is released untouched (no attempt counted).
 * The attempt is counted when the video is claimed (a run killed mid-render still counts toward the 3) and set back
 * to 0 when a video is made. At most 60 claims an hour in all and 10 per company.
 */
export async function claimRobotVideos(options: { max?: number; format?: RobotFormat } = {}, now = new Date()): Promise<RobotJob[]> {
  const max = Math.min(ROBOT_MAX_CLAIM, Math.max(1, Math.floor(options.max ?? ROBOT_DEFAULT_CLAIM)));
  const mimeType = MIME[options.format ?? "mp4"];
  const rows = await prisma.contentVisual.findMany({
    where: robotWaitingWhere(now),
    orderBy: { createdAt: "asc" },
    take: ROBOT_SCAN,
    select: { id: true, businessId: true, plan: true },
  });
  const owners = new Map<string, string | null>();
  const jobs: RobotJob[] = [];
  /** Whether one more claim fits the hourly caps; false for this company (or for everyone) until the hour turns. */
  const withinCaps = async (businessId: string): Promise<"ok" | "business" | "all"> => {
    try {
      await rateLimit("video-robot-claims", ROBOT_CLAIMS_PER_HOUR, now);
    } catch (error) {
      if (error instanceof RateLimitError) return "all";
      throw error;
    }
    try {
      await rateLimit(`video-robot-claims:${businessId}`, ROBOT_CLAIMS_PER_BUSINESS_HOUR, now);
    } catch (error) {
      if (error instanceof RateLimitError) return "business";
      throw error;
    }
    return "ok";
  };
  for (const row of rows) {
    if (jobs.length >= max) break;
    const plan = readVideoPlan(row.plan);
    if (!plan) continue;
    if (!owners.has(row.businessId)) {
      const business = await prisma.business.findUnique({ where: { id: row.businessId }, select: { userId: true } });
      owners.set(row.businessId, business && (await videoAvailable(row.businessId)) ? business.userId : null);
    }
    const userId = owners.get(row.businessId);
    if (!userId) continue;
    const caps = await withinCaps(row.businessId);
    if (caps === "all") break;
    if (caps === "business") {
      owners.set(row.businessId, null);
      continue;
    }

    const job = crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + ROBOT_LEASE_MS);
    const leased = await prisma.contentVisual.updateMany({ where: { id: row.id, ...robotWaitingWhere(now) }, data: { renderingUntil: leaseUntil, robotJobId: job, robotAttempts: { increment: 1 } } });
    if (leased.count !== 1) continue;

    const owner = { userId, businessId: row.businessId, service: true };
    try {
      // The voiceover is made (or reused) now, so the robot's video sounds like the owner's browser would make it.
      const prepared = await ensureVoiceover(owner, row.id).catch(() => null);
      const voiced = prepared?.plan ?? plan;
      const target = await prepareVideoUpload(owner, row.id, { bytes: VIDEO_LIMITS.maxBytes, mimeType, durationMs: voiced.totalMs });
      jobs.push({ job, plan: voiced, photoUrls: await signScenePhotos(userId, voiced), clipUrls: await signClips(userId, voiced), audioUrls: await audioUrlsFor(row.businessId, voiced, prepared?.voiceDataUrl), upload: { url: target.signedUrl, contentType: mimeType }, leaseUntil: leaseUntil.toISOString() });
    } catch (error) {
      await releaseLease(row.id, job, { robotAttempts: { decrement: 1 } }).catch(() => {});
      // Seconds used up, quota full, other uploads open: the owner's problem, not the robot's; tried again next run.
      if (!(error instanceof VisualError)) await logError(error, { source: "visuals.robot.claim", level: "warn", businessId: row.businessId });
    }
  }
  return jobs;
}

/**
 * The video a job is about, while the robot still holds its lease. A job whose lease ran out is ended here: its
 * reserved upload goes, with the file the robot may have written, so a late robot never leaves a file behind.
 */
async function jobRow(job: string, now: Date) {
  const row = await prisma.contentVisual.findUnique({ where: { robotJobId: job }, select: { id: true, businessId: true, plan: true, uploadPath: true, renderingUntil: true, business: { select: { userId: true } } } });
  if (!row) return null;
  if (!row.renderingUntil || row.renderingUntil <= now) {
    await dropUpload(row.id, row.uploadPath);
    await releaseLease(row.id, job).catch(() => {});
    return null;
  }
  return row;
}

/** Deletes a robot upload and its reservation (only if the reservation is still that file). */
async function dropUpload(id: string, path: string | null) {
  if (!path) return;
  await createAdminClient().storage.from("media").remove([path]).catch(() => {});
  await prisma.contentVisual.updateMany({ where: { id, uploadPath: path }, data: { uploadPath: null, uploadBytes: 0, uploadExpiresAt: null } }).catch(() => {});
}

export type RobotOutcome = { ok: true; seconds: number } | { ok: false; error: "unknown_job" | "rejected" };

/**
 * The robot uploaded the file: confirm it with finalizeVideo, the browser's own path (the real length read from the
 * file, quota with the real size, the video counted once (one of the plan's videos), the old file replaced, Autopilot posts updated, and
 * whatever runs after a video is ready, such as auto-scheduling). A rejected file is deleted; the attempt was
 * counted at claim time.
 */
export async function completeRobotVideo(job: string, now = new Date()): Promise<RobotOutcome> {
  const row = await jobRow(job, now);
  if (!row || !row.uploadPath) return { ok: false, error: "unknown_job" };
  const owner = { userId: row.business.userId, businessId: row.businessId, service: true };
  try {
    // The length is read from the file by finalizeVideo; the plan's figure is only what the robot was asked to make.
    const result = await finalizeVideo(owner, row.id, { path: row.uploadPath, durationMs: readVideoPlan(row.plan)?.totalMs ?? VIDEO_LIMITS.maxMs }, { robotJob: job });
    await releaseLease(row.id, job);
    return { ok: true, seconds: result.seconds };
  } catch (error) {
    await releaseLease(row.id, job).catch(() => {});
    if (!(error instanceof VisualError)) await logError(error, { source: "visuals.robot.complete", level: "warn", businessId: row.businessId });
    return { ok: false, error: "rejected" };
  }
}

/**
 * The robot could not make or upload the video: the lease and the upload reservation go (with the file, if one was
 * written). The attempt was counted at claim time; after ROBOT_MAX_ATTEMPTS the robot leaves it to the owner's browser.
 */
export async function failRobotVideo(job: string, reason: RobotFailure, now = new Date()): Promise<{ ok: boolean; attempts?: number }> {
  const row = await jobRow(job, now);
  if (!row) return { ok: false };
  await dropUpload(row.id, row.uploadPath);
  await releaseLease(row.id, job);
  const after = await prisma.contentVisual.findUnique({ where: { id: row.id }, select: { robotAttempts: true } });
  await logError(new Error(`Video robot: ${reason}`), { source: "visuals.robot.fail", level: "warn", businessId: row.businessId });
  return { ok: true, attempts: after?.robotAttempts };
}

/** The robot's end-of-run heartbeat: counts only, for the admin Services card and the Health page. */
export async function recordRobotRun(counts: { claimed: number; made: number; failed: number; waiting?: number }) {
  return recordCron(ROBOT_JOB, async () => ({ ...counts, ok: !(counts.failed > 0 && counts.made === 0) }));
}

export type RobotStatus = {
  enabled: boolean;
  lastRunAt: string | null;
  lastOk: boolean | null;
  made24h: number;
  failed24h: number;
  runs24h: number;
  waiting: number;
  needsBrowser: number;
};

/** What the admin Services card shows: last run, made and failed in the last 24 hours, the queue. */
export async function robotStatus(now = new Date()): Promise<RobotStatus> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [runs, waiting, needsBrowser] = await Promise.all([
    prisma.cronRun.findMany({ where: { job: ROBOT_JOB, startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, take: 200, select: { startedAt: true, ok: true, summary: true } }),
    peekRobotVideos(now),
    prisma.contentVisual.count({ where: { kind: "video", status: "pending", robotAttempts: { gte: ROBOT_MAX_ATTEMPTS }, OR: [{ robotJobId: null }, { renderingUntil: { lt: now } }] } }),
  ]);
  const last = runs[0] ?? (await prisma.cronRun.findFirst({ where: { job: ROBOT_JOB }, orderBy: { startedAt: "desc" }, select: { startedAt: true, ok: true, summary: true } }));
  let made = 0;
  let failed = 0;
  for (const run of runs) {
    const counts = parseCounts(run.summary);
    made += counts.made;
    failed += counts.failed;
  }
  return { enabled: robotEnabled(), lastRunAt: last?.startedAt.toISOString() ?? null, lastOk: last?.ok ?? null, made24h: made, failed24h: failed, runs24h: runs.length, waiting, needsBrowser };
}

export function parseCounts(summary: string | null): { made: number; failed: number } {
  try {
    const value = JSON.parse(summary ?? "{}") as { made?: unknown; failed?: unknown };
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
    return { made: n(value.made), failed: n(value.failed) };
  } catch {
    return { made: 0, failed: 0 };
  }
}
