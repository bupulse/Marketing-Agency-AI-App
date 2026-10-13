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
import { finalizeVideo, prepareVideoUpload, videoAvailable, VisualError } from "./service";
import { VIDEO_LIMITS, type VideoPlan } from "./types";
import { readVideoPlan } from "./video-plan";

/** How long the robot holds a video it claimed (render, upload, confirm). Longer than the browser's lease. */
export const ROBOT_LEASE_MS = 15 * 60 * 1000;
/** Failed robot renders after which the video is left to the owner's browser ("needs browser render"). */
export const ROBOT_MAX_ATTEMPTS = 3;
/** Videos handed out per claim by default, and at most. */
export const ROBOT_DEFAULT_CLAIM = 3;
export const ROBOT_MAX_CLAIM = 5;
/** Pending videos looked at per claim (some may belong to companies without video seconds left). */
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

/** Pending videos the robot may take: plan ready, not made, fewer than 3 robot failures, no live lease. */
export function robotWaitingWhere(now: Date) {
  return {
    kind: "video",
    status: "pending",
    robotAttempts: { lt: ROBOT_MAX_ATTEMPTS },
    OR: [{ renderingUntil: null }, { renderingUntil: { lt: now } }],
  };
}

/** How the owner's screen describes a pending video while the robot is on. */
export type RobotState = "queued" | "making" | "browser" | null;

export function robotStateOf(row: { kind: string; status: string; robotAttempts: number; robotJobId: string | null; renderingUntil: Date | null }, now = new Date()): RobotState {
  if (!robotEnabled() || row.kind !== "video" || row.status !== "pending") return null;
  if (row.robotAttempts >= ROBOT_MAX_ATTEMPTS) return "browser";
  if (row.robotJobId && row.renderingUntil && row.renderingUntil > now) return "making";
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
  /** Where to PUT the file: a signed upload URL reserved through the same checks as the browser's upload. */
  upload: { url: string; contentType: "video/mp4" | "video/webm" };
  /** When the lease ends; the robot gives up on the video before then. */
  leaseUntil: string;
}

/** Signed URLs for the scene photos that really are the owner's (a photo path the owner does not own is skipped). */
async function signScenePhotos(userId: string, plan: VideoPlan): Promise<Record<string, string>> {
  const paths = [...new Set(plan.scenes.flatMap((s) => (s.photoPath ? [s.photoPath] : [])))].filter((p) => isOwnPhotoPath(userId, p) || isOwnDesignPath(userId, p));
  const byBucket = new Map<"media" | "designs", string[]>();
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

async function releaseLease(id: string, job: string, data: { robotAttempts?: { increment: number } } = {}) {
  await prisma.contentVisual.updateMany({ where: { id, robotJobId: job }, data: { renderingUntil: null, robotJobId: null, ...data } });
}

/**
 * Claims up to `max` pending videos, oldest first. Each is leased atomically (compare-and-set on the lease, so two
 * robot runs, or a robot and an owner's browser, never make the same video), then given an upload reservation through
 * prepareVideoUpload: plan feature, video seconds left, media quota, platform guard and open uploads are checked
 * exactly as for the browser. A video that fails those checks is released untouched (no attempt counted).
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

    const job = crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + ROBOT_LEASE_MS);
    const leased = await prisma.contentVisual.updateMany({ where: { id: row.id, ...robotWaitingWhere(now) }, data: { renderingUntil: leaseUntil, robotJobId: job } });
    if (leased.count !== 1) continue;

    const owner = { userId, businessId: row.businessId, service: true };
    try {
      const target = await prepareVideoUpload(owner, row.id, { bytes: VIDEO_LIMITS.maxBytes, mimeType, durationMs: plan.totalMs });
      jobs.push({ job, plan, photoUrls: await signScenePhotos(userId, plan), upload: { url: target.signedUrl, contentType: mimeType }, leaseUntil: leaseUntil.toISOString() });
    } catch (error) {
      await releaseLease(row.id, job).catch(() => {});
      // Seconds used up, quota full, other uploads open: the owner's problem, not the robot's; tried again next run.
      if (!(error instanceof VisualError)) await logError(error, { source: "visuals.robot.claim", level: "warn", businessId: row.businessId });
    }
  }
  return jobs;
}

/** The video a job is about, while the robot still holds its lease. */
async function jobRow(job: string, now: Date) {
  const row = await prisma.contentVisual.findUnique({ where: { robotJobId: job }, select: { id: true, businessId: true, plan: true, uploadPath: true, renderingUntil: true, business: { select: { userId: true } } } });
  if (!row || !row.renderingUntil || row.renderingUntil <= now) return null;
  return row;
}

export type RobotOutcome = { ok: true; seconds: number } | { ok: false; error: "unknown_job" | "rejected" };

/**
 * The robot uploaded the file: confirm it with finalizeVideo, the browser's own path (the real length read from the
 * file, quota with the real size, video seconds billed once, the old file replaced, Autopilot posts updated, and
 * whatever runs after a video is ready). A rejected file counts as a failed attempt.
 */
export async function completeRobotVideo(job: string, now = new Date()): Promise<RobotOutcome> {
  const row = await jobRow(job, now);
  if (!row || !row.uploadPath) return { ok: false, error: "unknown_job" };
  const owner = { userId: row.business.userId, businessId: row.businessId, service: true };
  try {
    // The length is read from the file by finalizeVideo; the plan's figure is only what the robot was asked to make.
    const result = await finalizeVideo(owner, row.id, { path: row.uploadPath, durationMs: readVideoPlan(row.plan)?.totalMs ?? VIDEO_LIMITS.maxMs });
    await releaseLease(row.id, job);
    return { ok: true, seconds: result.seconds };
  } catch (error) {
    await releaseLease(row.id, job, { robotAttempts: { increment: 1 } }).catch(() => {});
    if (!(error instanceof VisualError)) await logError(error, { source: "visuals.robot.complete", level: "warn", businessId: row.businessId });
    return { ok: false, error: "rejected" };
  }
}

/**
 * The robot could not make or upload the video: the lease and the upload reservation go (with the file, if one was
 * written), and the attempt is counted. After ROBOT_MAX_ATTEMPTS the robot leaves it to the owner's browser.
 */
export async function failRobotVideo(job: string, reason: RobotFailure, now = new Date()): Promise<{ ok: boolean; attempts?: number }> {
  const row = await jobRow(job, now);
  if (!row) return { ok: false };
  if (row.uploadPath) {
    await createAdminClient().storage.from("media").remove([row.uploadPath]).catch(() => {});
    await prisma.contentVisual.updateMany({ where: { id: row.id, uploadPath: row.uploadPath }, data: { uploadPath: null, uploadBytes: 0, uploadExpiresAt: null } });
  }
  await releaseLease(row.id, job, { robotAttempts: { increment: 1 } });
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
    prisma.contentVisual.count({ where: { kind: "video", status: "pending", robotAttempts: { gte: ROBOT_MAX_ATTEMPTS } } }),
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
