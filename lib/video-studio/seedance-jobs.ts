import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { assertServiceEnabled, ServiceDisabledError } from "@/lib/admin/switch";
import { recordAiCall, withLedger } from "@/lib/ai/ledger";
import { logError } from "@/lib/errors";
import { MediaError, prepareUploads } from "@/lib/media/service";
import { GALLERY_VIDEO_BUCKET } from "@/lib/media/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeUsage, refundUsage } from "@/lib/usage";
import { seedanceCredits } from "@/lib/video-engine/credits";
import { VIDEO_LEDGER_FEATURES } from "@/lib/video-engine/ledger-features";
import { SEEDANCE_BASE_URL, SEEDANCE_MODELS, SEEDANCE_TASK_EXPIRES_SECONDS, SeedanceError, cancelSeedanceTask, createSeedanceTask, estimateSeedanceUsd, getSeedanceTask, seedanceLedgerUsage, type SeedanceRequest, type SeedanceTask, type SeedanceTier } from "@/lib/video-engine/seedance";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { saveJobVideo, studioFolder } from "./library";
import { VideoStudioError, view, type StudioOwner, type VideoJobView } from "./job-view";

// Seedance real video as VideoJob rows (docs/STUDIO_DEPLOY.md, build item 8; docs/SEEDANCE_KEY_DAY.md). A client's
// Seedance clip is a VideoJob (engine "seedance"):
// - credits are taken first (consumeUsage "videoCredits", seedanceCredits), the row is written ("submitting"), then
//   the BytePlus task is created through the cost ledger (withLedger: the Seedance switch in Admin -> Services, the
//   platform cap) and the row becomes "submitted" with the task id;
// - a poller (pollDueSeedanceJobs, every 10 s in the studio; rows in the database, so it resumes by itself after a
//   restart) checks BytePlus, downloads the MP4 when it is ready (BytePlus's link lasts 24 hours), uploads it into the
//   Gallery's "Video Studio" folder and finalises it through saveJobVideo, so it lands in BuPulse's Videos library;
// - a task that fails, expires or never finishes gives its credits back exactly once (a conditional update claims the
//   job before the refund, as the design sweep does), and the sweep fails "submitted" jobs BytePlus has ended;
// - without the key, a submission is a free preview (status "preview", the storyboard, no credits): the studio builds
//   the storyboard and passes it in.
// BuPulse's text over a finished clip (price, WhatsApp bar, call to action) is a child Motion job ("overlay").

/** How often a running task is checked. */
export const SEEDANCE_POLL_MS = 10_000;
/** How long one poll may hold a job (a download and upload of up to 200 MB). */
export const SEEDANCE_POLL_LEASE_MS = 3 * 60_000;
/** How long the submit request may hold a job before the sweep gives its credits back (BytePlus answers in seconds). */
export const SEEDANCE_SUBMIT_LEASE_MS = 5 * 60_000;
/** After BytePlus's own expiry (it ends the task and bills nothing), a little longer before the credits go back. */
export const SEEDANCE_GRACE_MS = 5 * 60_000;
/** A finished clip whose download or upload keeps failing is given up after this many tries (credits back). */
export const SEEDANCE_SAVE_TRIES = 5;
const MAX_CLIP_BYTES = 200 * 1024 * 1024;
const POLLING = ["submitted", "queued", "running"] as const;

export const SEEDANCE_MESSAGES = {
  noKey: "Real video is coming soon: here is the free storyboard of what Seedance will film. No credits were taken.",
  off: "Real video is paused right now. Please try again later.",
  refused: "BytePlus did not take the request. Your credits are back.",
  failed: "Seedance could not make this video. Your credits are back.",
  timeout: "Seedance did not finish within the hour (BytePlus ended the task and bills nothing). Your credits are back.",
  stranded: "The request was interrupted before it reached Seedance. Your credits are back; please try again.",
  notSaved: "The video was made but could not be saved into your Gallery. Your credits are back; please try again.",
  cancelled: "Cancelled. Your credits are back.",
} as const;

type Env = Record<string, string | undefined>;
export type SeedanceDeps = { env?: Env; fetchImpl?: typeof fetch; now?: () => Date };
const opts = (deps: SeedanceDeps) => {
  const env = deps.env ?? process.env;
  return { apiKey: env.SEEDANCE_API_KEY?.trim() ?? "", baseUrl: env.SEEDANCE_BASE_URL?.trim() || SEEDANCE_BASE_URL, fetchImpl: deps.fetchImpl };
};
const clock = (deps: SeedanceDeps) => (deps.now ?? (() => new Date()))();

/** What a Seedance request is: the request (references as data, never stored), what to keep about it, and the facts. */
export type SeedanceJobInput = {
  productId: string | null;
  request: SeedanceRequest;
  /** What each reference is ("Image 1: the product photo"): kept on the job; the data itself is not. */
  referenceNotes: string[];
  title: string;
  templateId?: string | null;
  platform?: string | null;
  /** Facts kept in VideoJob.brief (the PromptBrief without images, the viral recipe...). */
  brief?: Record<string, unknown> | null;
};

/** Why a real Seedance clip cannot be made right now: "no-key" (free previews instead), "off" (the switch), or null. */
export async function seedanceUnavailable(env: Env = process.env): Promise<"no-key" | "off" | null> {
  if (!env.SEEDANCE_API_KEY?.trim()) return "no-key";
  try {
    await assertServiceEnabled("seedance");
  } catch (error) {
    if (error instanceof ServiceDisabledError) return "off";
    throw error;
  }
  return null;
}

const creditsFor = (r: SeedanceRequest) => seedanceCredits(r.tier, r.draft ? "480p" : r.resolution, Math.min(15, Math.max(4, Math.round(r.seconds))));
/** The request as the job keeps it: everything but the reference data. */
const storedRequest = (r: SeedanceRequest, notes: string[]) => ({ tier: r.tier, prompt: r.prompt, ratio: r.ratio, seconds: r.seconds, resolution: r.resolution, audio: r.audio, fixedLens: r.fixedLens, seed: r.seed ?? null, draft: r.draft ?? false, referenceNotes: notes });
const rowData = (owner: StudioOwner, input: SeedanceJobInput) => ({
  businessId: owner.businessId,
  userId: owner.actorId,
  productId: input.productId,
  engine: "seedance",
  mode: input.request.references.some((r) => r.role === "first_frame") ? "image" : input.request.references.length ? "reference" : "text",
  templateId: input.templateId ?? null,
  platform: input.platform ?? null,
  ratio: input.request.ratio === "adaptive" ? "9:16" : input.request.ratio,
  seconds: Math.min(15, Math.max(4, Math.round(input.request.seconds))),
  quality: `${input.request.tier} ${input.request.draft ? "480p" : input.request.resolution}`,
  prompt: input.request.prompt,
  references: input.referenceNotes.map((label, i) => ({ name: `ref-${i + 1}`, label })) as object,
});

/**
 * A free preview (no key yet): a "preview" row with the storyboard the studio made, ready at `readyAt`; no credits.
 * `wouldCostCredits`: what the real clip will cost, shown with it.
 */
export async function createSeedancePreview(owner: StudioOwner, input: SeedanceJobInput, preview: { storyboard: unknown; readyAt: Date; notice: string }): Promise<VideoJobView> {
  const row = await prisma.videoJob.create({
    data: { ...rowData(owner, input), status: "preview", credits: 0, storyboard: preview.storyboard as object, brief: { ...(input.brief ?? {}), title: input.title, request: storedRequest(input.request, input.referenceNotes), preview: { notice: preview.notice, readyAt: preview.readyAt.toISOString(), wouldCostCredits: creditsFor(input.request) } } as object },
  });
  return view(row);
}

/**
 * Submits a real Seedance clip. Order: the switch and the key → credits reserved → row "submitting" → BytePlus task
 * (through the ledger) → row "submitted". A refused request fails the row and gives the credits back once; throws
 * VideoStudioError in plain English (also before anything is charged when Seedance cannot run).
 */
export async function submitSeedanceJob(owner: StudioOwner, input: SeedanceJobInput, deps: SeedanceDeps = {}): Promise<VideoJobView> {
  const unavailable = await seedanceUnavailable(deps.env);
  if (unavailable) throw new VideoStudioError(unavailable === "off" ? SEEDANCE_MESSAGES.off : "Real video is coming soon: it starts when BuPulse's Seedance account is ready.", "unavailable", 503);
  const credits = creditsFor(input.request);
  // Credits first: a blocked company leaves nothing behind (no job, no call). UsageLimitError goes to the caller.
  const reservation = await consumeUsage(owner.userId, "videoCredits", credits);
  const now = clock(deps);
  const row = await prisma.videoJob
    .create({
      data: { ...rowData(owner, input), status: "submitting", credits, periodStart: reservation.periodStart, leaseUntil: new Date(now.getTime() + SEEDANCE_SUBMIT_LEASE_MS), brief: { ...(input.brief ?? {}), title: input.title, request: storedRequest(input.request, input.referenceNotes), estimateUsd: estimateSeedanceUsd(input.request) } as object },
      select: { id: true },
    })
    .catch(async (error: unknown) => {
      await refundUsage(owner.userId, "videoCredits", reservation.periodStart, credits).catch(() => {});
      throw error;
    });
  const tier = input.request.tier;
  let taskId: string;
  try {
    taskId = await withLedger({ userId: owner.actorId, businessId: owner.businessId, feature: VIDEO_LEDGER_FEATURES.seedance }, { provider: "byteplus", model: SEEDANCE_MODELS[tier].id }, () => createSeedanceTask(input.request, opts(deps)), () => seedanceLedgerUsage(tier, 0));
  } catch (error) {
    const message = error instanceof SeedanceError ? `${error.message} Your credits are back.` : error instanceof ServiceDisabledError ? SEEDANCE_MESSAGES.off : error instanceof Error && error.name.endsWith("BudgetExceededError") ? error.message : SEEDANCE_MESSAGES.refused;
    await failOnce(row.id, message, ["submitting"]);
    throw new VideoStudioError(message, "unavailable", error instanceof SeedanceError && error.status === 429 ? 429 : 502);
  }
  const done = await prisma.videoJob.update({
    where: { id: row.id },
    data: { status: "submitted", providerTaskId: taskId, leaseUntil: null, nextPollAt: new Date(now.getTime() + SEEDANCE_POLL_MS), expiresAt: new Date(now.getTime() + SEEDANCE_TASK_EXPIRES_SECONDS * 1000) },
  });
  return view(done);
}

/**
 * Fails a job and gives its credits back, exactly once: the conditional update (still in one of `from`, never refunded)
 * claims it first, so the poller, the sweep and a cancel can never all refund it. True when this call refunded it.
 */
async function failOnce(id: string, message: string, from: readonly string[], status: "failed" | "cancelled" = "failed"): Promise<boolean> {
  const job = await prisma.videoJob.findUnique({ where: { id }, select: { credits: true, periodStart: true, business: { select: { userId: true } } } });
  if (!job) return false;
  const { count } = await prisma.videoJob.updateMany({ where: { id, status: { in: [...from] }, refundedAt: null }, data: { status, error: message, refundedAt: new Date(), leaseUntil: null, nextPollAt: null } });
  if (count !== 1) return false;
  if (job.credits > 0 && job.periodStart) {
    try {
      await refundUsage(job.business.userId, "videoCredits", job.periodStart, job.credits);
    } catch (error) {
      await logError(error, { source: "video.seedance.refund" }).catch(() => {});
    }
  }
  return true;
}

export type PollOutcome = "waiting" | "ready" | "failed" | "skipped";

/**
 * One check of one task: claims the job (a lease, so two pollers never work on it at once), asks BytePlus, and moves
 * it on: still working (the next check in 10 s), finished (downloaded, saved into the Gallery, "ready", its real
 * usage in the ledger), failed or expired (credits back). A BytePlus that does not answer is asked again later, until
 * the task's own expiry has passed.
 */
export async function pollSeedanceJob(id: string, deps: SeedanceDeps = {}): Promise<PollOutcome> {
  const now = clock(deps);
  const { count } = await prisma.videoJob.updateMany({
    where: { id, engine: "seedance", status: { in: [...POLLING] }, providerTaskId: { not: null }, refundedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseUntil: new Date(now.getTime() + SEEDANCE_POLL_LEASE_MS) },
  });
  if (count !== 1) return "skipped";
  const job = await prisma.videoJob.findUniqueOrThrow({ where: { id }, select: { id: true, businessId: true, userId: true, providerTaskId: true, quality: true, ratio: true, attempts: true, expiresAt: true, createdAt: true, product: { select: { name: true } }, business: { select: { userId: true } } } });
  const tier = (job.quality?.split(" ")[0] ?? "pro") as SeedanceTier;
  const later = (ms: number, data: Prisma.VideoJobUpdateManyMutationInput = {}) => prisma.videoJob.updateMany({ where: { id, status: { in: [...POLLING] } }, data: { ...data, leaseUntil: null, nextPollAt: new Date(now.getTime() + ms) } });
  const expired = job.expiresAt && now.getTime() > job.expiresAt.getTime() + SEEDANCE_GRACE_MS;
  let task: SeedanceTask;
  try {
    task = await getSeedanceTask(job.providerTaskId!, opts(deps));
  } catch {
    if (expired) return (await failOnce(id, SEEDANCE_MESSAGES.timeout, POLLING)) ? "failed" : "skipped";
    await later(SEEDANCE_POLL_MS * 3);
    return "waiting";
  }
  if (task.status === "failed" || task.status === "expired") {
    // BytePlus bills only clips it made: the credits go back.
    return (await failOnce(id, task.error ? `${task.error} Your credits are back.` : SEEDANCE_MESSAGES.failed, POLLING)) ? "failed" : "skipped";
  }
  if (task.status !== "succeeded" || !task.videoUrl) {
    if (expired) return (await failOnce(id, SEEDANCE_MESSAGES.timeout, POLLING)) ? "failed" : "skipped";
    await later(SEEDANCE_POLL_MS, { status: task.status === "queued" ? "queued" : "running" });
    return "waiting";
  }
  // Finished: the MP4 into the Gallery, then the job is "ready" (saveJobVideo), with its real cost.
  try {
    const bytes = await download(task.videoUrl, deps.fetchImpl ?? fetch);
    const ctx = { userId: job.business.userId, businessId: job.businessId };
    const destination = await studioFolder(job.businessId);
    const [target] = await prepareUploads(ctx, [{ name: `seedance-${id}.mp4`, type: "video/mp4", size: bytes.length }], destination);
    if (!target?.ok) throw new MediaError(target?.error ?? "The clip could not be saved.");
    const up = await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).uploadToSignedUrl(target.path, target.token, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), { contentType: "video/mp4" });
    if (up.error) throw new Error("upload failed");
    await saveJobVideo(ctx, id, { path: target.path, destination, name: `${job.product?.name ?? "Seedance"} - real video`.slice(0, 120), width: null, height: null }, { engine: "seedance" });
    await prisma.videoJob.update({ where: { id }, data: { costUsd: task.costUsd, leaseUntil: null, nextPollAt: null } });
    await recordAiCall({ userId: job.userId, businessId: job.businessId, feature: VIDEO_LEDGER_FEATURES.seedance }, { ...seedanceLedgerUsage(tier, task.tokens), success: true, durationMs: now.getTime() - job.createdAt.getTime() });
    return "ready";
  } catch (error) {
    // The link lasts 24 hours: try again on the next checks, then give up with the credits back.
    const attempts = job.attempts + 1;
    if (attempts >= SEEDANCE_SAVE_TRIES) {
      await logError(error, { source: "video.seedance.save" }).catch(() => {});
      return (await failOnce(id, error instanceof MediaError ? `${error.message} Your credits are back.` : SEEDANCE_MESSAGES.notSaved, POLLING)) ? "failed" : "skipped";
    }
    await later(SEEDANCE_POLL_MS * 3, { attempts, status: "running" });
    return "waiting";
  }
}

/** The MP4 from BytePlus's own storage only (never another address), at most 200 MB. */
async function download(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  if (!/^https:\/\/[a-z0-9.-]+\.(bytepluses|volces|byteplus)\.com\//i.test(url)) throw new Error("Unexpected video host");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_CLIP_BYTES || bytes.length < 1000) throw new Error("bad size");
  return bytes;
}

/** Checks the tasks that are due (the studio calls it every 10 s; after a restart it picks up where it was). */
export async function pollDueSeedanceJobs(deps: SeedanceDeps = {}, limit = 10): Promise<Record<PollOutcome, number>> {
  const out: Record<PollOutcome, number> = { waiting: 0, ready: 0, failed: 0, skipped: 0 };
  if (!opts(deps).apiKey) return out;
  const now = clock(deps);
  const due = await prisma.videoJob.findMany({ where: { engine: "seedance", status: { in: [...POLLING] }, providerTaskId: { not: null }, refundedAt: null, nextPollAt: { lte: now } }, orderBy: { nextPollAt: "asc" }, take: limit, select: { id: true } });
  for (const { id } of due) out[await pollSeedanceJob(id, deps).catch(() => "skipped" as const)] += 1;
  return out;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** The studio's poller: every 10 s while the key is set (rows in the database: nothing is lost on a restart). */
export function startSeedancePoller(deps: SeedanceDeps = {}): () => void {
  if (timer || !opts(deps).apiKey) return () => {};
  let busy = false;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void pollDueSeedanceJobs(deps)
      .catch((error: unknown) => logError(error, { source: "video.seedance.poll" }).catch(() => {}))
      .finally(() => (busy = false));
  }, SEEDANCE_POLL_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

export type SeedanceSweep = { stranded: number; expired: number };

/**
 * The cron's part (lib/video-studio/sweep.ts): a submit that died before BytePlus answered (still "submitting", lease
 * over), and a task BytePlus has ended without the poller noticing (past its expiry plus the grace), are failed with
 * their credits back, once.
 */
export async function sweepSeedanceJobs(now = new Date()): Promise<SeedanceSweep> {
  const out: SeedanceSweep = { stranded: 0, expired: 0 };
  const stranded = await prisma.videoJob.findMany({ where: { engine: "seedance", status: "submitting", leaseUntil: { lt: now }, refundedAt: null }, take: 100, select: { id: true } });
  for (const { id } of stranded) if (await failOnce(id, SEEDANCE_MESSAGES.stranded, ["submitting"])) out.stranded += 1;
  const ended = await prisma.videoJob.findMany({ where: { engine: "seedance", status: { in: [...POLLING] }, expiresAt: { lt: new Date(now.getTime() - SEEDANCE_GRACE_MS) }, refundedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, take: 100, select: { id: true } });
  for (const { id } of ended) if (await failOnce(id, SEEDANCE_MESSAGES.timeout, POLLING)) out.expired += 1;
  return out;
}

/**
 * Cancels a job of the business: a preview (nothing was charged), or a task that has not started (BytePlus is told,
 * the credits come back once). A running or finished clip cannot be cancelled. Null when it is not theirs.
 */
export async function cancelSeedanceJob(owner: StudioOwner, id: string, deps: SeedanceDeps = {}): Promise<VideoJobView | null> {
  const job = await prisma.videoJob.findFirst({ where: { id, businessId: owner.businessId, engine: "seedance" }, select: { status: true, providerTaskId: true } });
  if (!job) return null;
  if (job.status === "preview" || job.status === "preview-ready") await prisma.videoJob.updateMany({ where: { id, status: job.status }, data: { status: "cancelled" } });
  else if (job.status === "submitted" || job.status === "queued") {
    if (job.providerTaskId && opts(deps).apiKey) await cancelSeedanceTask(job.providerTaskId, opts(deps)).catch(() => undefined);
    await failOnce(id, SEEDANCE_MESSAGES.cancelled, ["submitted", "queued"], "cancelled");
  }
  return view(await prisma.videoJob.findUniqueOrThrow({ where: { id } }));
}

/**
 * BuPulse's text over a finished clip (or a stand-in while in preview): a child Motion job ("overlay") with the
 * overlay design (lib/video-engine/seedance-overlay.ts) and its caption check, free; its MP4 is made in the browser and
 * saved like any Motion video. Making it again replaces the child's design.
 */
export async function saveSeedanceOverlayJob(owner: StudioOwner, parentId: string, overlay: { spec: MotionSpec; clipUrl: string; standIn: boolean; captionScore: number; captionMissed: string[] }): Promise<{ id: string; created: boolean }> {
  const parent = await prisma.videoJob.findFirst({ where: { id: parentId, businessId: owner.businessId, engine: "seedance" }, select: { productId: true, platform: true, ratio: true, seconds: true, brief: true } });
  if (!parent) throw new VideoStudioError("We could not find that video.", "not_found", 404);
  const data = { spec: overlay.spec as object, caption: overlay.spec.caption, hashtags: overlay.spec.hashtags, captionScore: { score: overlay.captionScore, missed: overlay.captionMissed } as object, brief: { overlay: { clipUrl: overlay.clipUrl, standIn: overlay.standIn }, title: (parent.brief as { title?: string } | null)?.title ?? null } as object };
  const existing = await prisma.videoJob.findFirst({ where: { parentId, businessId: owner.businessId, engine: "motion", mode: "overlay" }, select: { id: true } });
  if (existing) {
    await prisma.videoJob.update({ where: { id: existing.id }, data });
    return { id: existing.id, created: false };
  }
  const row = await prisma.videoJob.create({ data: { ...data, businessId: owner.businessId, userId: owner.actorId, productId: parent.productId, parentId, engine: "motion", mode: "overlay", status: "designed", templateId: "seedance-overlay", platform: parent.platform, ratio: overlay.spec.ratio, seconds: parent.seconds, credits: 0 }, select: { id: true } });
  return { id: row.id, created: true };
}
