// AI clips for content videos, made with nobody present (owner decision, 23 October 2026: "fully automatic";
// docs/CONTENT_VISUALS.md "Video quality"). A video Autopilot or Daily posts marked quality "ai" gets
// AI_CLIPS_PER_VIDEO real moving clips from Google Veo (lib/video-engine/veo.ts), each starting from one of the video's
// own photos, before the robot or the owner's browser renders it. Runs inside the /api/cron/video-jobs sweep (every 4
// minutes), with its state on the visual (ContentVisual.clip*):
// 1. "waiting" (set by the planner): the Veo switch, the Gemini key, a photo and BuPulse's daily clip limit are checked,
//    then the studio credits are taken from the company owner (AI_CLIPS_PER_VIDEO × veoClipCredits) and the clips
//    submitted through the cost ledger (withLedger: the switch and the platform cap). Then "making".
// 2. "making": each sweep asks Google about each clip; a made clip is downloaded at once (Google keeps it 2 days) into
//    the media bucket (`<userId>/aiclips/`) and its real cost recorded (recordAiCall, priced per second).
//    Google takes only a few clips at a time (VEO_PARALLEL, 3, across all videos): the clips past that wait ("retry"),
//    and a clip Google turns away at its limit (RESOURCE_EXHAUSTED, VeoError "quota"; nothing made, nothing billed) is
//    sent again from the next sweep, up to CLIP_QUOTA_TRIES times, instead of failing the video.
// 3. When every clip is made or failed, or after CLIP_GIVE_UP_MS: "done" (the made clips go into the plan's scenes,
//    lib/visuals/clip-scenes.ts) or "fallback" (the simple slideshow, the mark cleared, the reason in plan.aiNote).
//    The credits of the clips not made are given back exactly once: the settling update is conditional (still working,
//    the held credits unchanged), so two sweeps can never both refund. Google bills only clips it makes.
// No credits, the switch off, no photo, the day's limit, an account that cannot use credits: "fallback" at once, nothing
// taken. The robot does not take a video while it is "waiting" or "making" (robotWaitingWhere), nor does the browser.
import "server-only";
import { prisma } from "@/lib/db";
import { isServiceEnabled, ServiceDisabledError } from "@/lib/admin/switch";
import { recordAiCall, withLedger } from "@/lib/ai/ledger";
import { isOwnDesignPath, isOwnPhotoPath } from "@/lib/designs/assets";
import { logError } from "@/lib/errors";
import { bucketForPath } from "@/lib/publishing/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeUsage, refundUsage, UsageLimitError } from "@/lib/usage";
import { veoClipCredits } from "@/lib/video-engine/credits";
import { VIDEO_LEDGER_FEATURES } from "@/lib/video-engine/ledger-features";
import { defaultClipPlan, getVeoOperation, submitVeo, veoClipBytes, veoLedgerUsage, veoModel, veoPrompt, VEO_PARALLEL, VeoError, type ClipFacts, type VeoSeconds } from "@/lib/video-engine/veo";
import { firstFrame } from "@/lib/video-engine/veo-frame";
import { CLIP_NOTES, clipPathsOf, clipStoragePath, isOwnClipPath, pickClipScenes, withClips, withoutClips, type ClipJob } from "./clip-scenes";
import { videoDurationMs } from "./duration";
import { readVideoPlan } from "./video-plan";
import { AI_CLIP_SECONDS, AI_CLIPS_PER_VIDEO } from "./video-quality";
import type { VideoPlan } from "./types";

/** States in which the clips are still being worked on (the video waits). */
export const CLIP_WORKING = ["waiting", "making"] as const;
/** How long one sweep may hold a visual (submitting 2 clips, or downloading and saving them). */
export const CLIP_LEASE_MS = 3 * 60_000;
/** After this the clips not made are given up (Google's worst case is 6 minutes a clip). */
export const CLIP_GIVE_UP_MS = 20 * 60_000;
/** Videos started, and videos checked, per sweep; the rest wait for the next one (4 minutes later). */
export const CLIP_START_BATCH = 5;
export const CLIP_POLL_BATCH = 10;
/** Times a clip is sent when Google answers "at its limit" (one sweep, 4 minutes, apart) before it is given up. */
export const CLIP_QUOTA_TRIES = 3;
/** BuPulse's own limit on clips submitted in 24 hours (all companies), VEO_CLIPS_PER_DAY overrides it. */
export const VEO_CLIPS_PER_DAY = 10;
/** The largest photo downloaded for a first frame. */
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
/** A clip larger than the media bucket's 10 MB per file is not kept. */
const MAX_CLIP_BYTES = 10 * 1024 * 1024;

type Env = Record<string, string | undefined>;
export type ClipDeps = { env?: Env; fetchImpl?: typeof fetch };
export type AiClipsResult = { started: number; fallback: number; made: number; done: number; refunded: number; credits: number; retried: number };
/** Places left this sweep among the clips Google makes at once (VEO_PARALLEL across all videos). */
type Slots = { free: number };

const veoOpts = (deps: ClipDeps) => ({ apiKey: (deps.env ?? process.env).GEMINI_API_KEY?.trim() ?? "", fetchImpl: deps.fetchImpl });
const clipsPerDay = (env: Env) => {
  const n = Number(env.VEO_CLIPS_PER_DAY);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : VEO_CLIPS_PER_DAY;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as object;

/** A stored clip list read back defensively. */
export function readClipJobs(value: unknown): ClipJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((j) => {
    if (!j || typeof j !== "object") return [];
    const c = j as Partial<ClipJob>;
    if (typeof c.scene !== "number" || typeof c.photoPath !== "string" || !["submitted", "retry", "made", "failed"].includes(String(c.status))) return [];
    return [
      {
        scene: c.scene,
        photoPath: c.photoPath,
        operation: typeof c.operation === "string" ? c.operation : null,
        status: c.status!,
        path: c.path ?? null,
        bytes: c.bytes ?? 0,
        ...(typeof c.ms === "number" ? { ms: c.ms } : {}),
        ...(typeof c.tries === "number" ? { tries: c.tries } : {}),
        ...(typeof c.prompt === "string" ? { prompt: c.prompt } : {}),
        error: c.error ?? null,
      },
    ];
  });
}

/** The sweep's part: starts the waiting videos, then checks the clips at Google. Never throws for one video. */
export async function runAiClips(now = new Date(), deps: ClipDeps = {}): Promise<AiClipsResult> {
  const result: AiClipsResult = { started: 0, fallback: 0, made: 0, done: 0, refunded: 0, credits: 0, retried: 0 };
  const free = { OR: [{ clipLeaseUntil: null }, { clipLeaseUntil: { lt: now } }] };
  const slots: Slots = { free: VEO_PARALLEL - (await clipsAtGoogle()) };
  // The videos already started first: their finished clips free places, and their waiting clips go before new videos.
  // Clips submitted in this sweep are checked from the next one (Google takes 11 s to 6 minutes a clip).
  const making = await prisma.contentVisual.findMany({ where: { clipState: "making", ...free }, orderBy: { updatedAt: "asc" }, take: CLIP_POLL_BATCH, select: { id: true } });
  for (const { id } of making) {
    if (!(await claim(id, "making", now))) continue;
    try {
      await checkClips(id, now, deps, result, slots);
    } catch (error) {
      await logError(error, { source: "visuals.ai-clips.check" }).catch(() => {});
    } finally {
      await release(id);
    }
  }
  const waiting = await prisma.contentVisual.findMany({ where: { clipState: "waiting", ...free }, orderBy: { createdAt: "asc" }, take: CLIP_START_BATCH, select: { id: true } });
  for (const { id } of waiting) {
    if (!(await claim(id, "waiting", now))) continue;
    try {
      await startClips(id, now, deps, result, slots);
    } catch (error) {
      await logError(error, { source: "visuals.ai-clips.start" }).catch(() => {});
    } finally {
      await release(id);
    }
  }
  return result;
}

async function claim(id: string, state: "waiting" | "making", now: Date): Promise<boolean> {
  const { count } = await prisma.contentVisual.updateMany({
    where: { id, clipState: state, OR: [{ clipLeaseUntil: null }, { clipLeaseUntil: { lt: now } }] },
    data: { clipLeaseUntil: new Date(now.getTime() + CLIP_LEASE_MS) },
  });
  return count === 1;
}

const release = (id: string) => prisma.contentVisual.updateMany({ where: { id }, data: { clipLeaseUntil: null } }).catch(() => undefined);

const rowSelect = { id: true, businessId: true, contentId: true, groupId: true, kind: true, status: true, plan: true, clipState: true, clipJobs: true, clipCredits: true, clipPeriodStart: true, clipUntil: true, business: { select: { userId: true, name: true, country: true } } } as const;
type Row = NonNullable<Awaited<ReturnType<typeof loadRow>>>;
const loadRow = (id: string) => prisma.contentVisual.findUnique({ where: { id }, select: rowSelect });

/** Clips Google is making right now for content videos (all companies). */
async function clipsAtGoogle(): Promise<number> {
  const rows = await prisma.contentVisual.findMany({ where: { clipState: { in: [...CLIP_WORKING] } }, select: { clipJobs: true } });
  return rows.reduce((n, r) => n + readClipJobs(r.clipJobs).filter((j) => j.status === "submitted").length, 0);
}

/** Clips submitted in the last 24 hours (the submit rows the ledger keeps: no seconds yet). */
async function submittedToday(now: Date): Promise<number> {
  return prisma.aiCall.count({ where: { feature: VIDEO_LEDGER_FEATURES.veo, inputTokens: 0, success: true, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } } });
}

async function startClips(id: string, now: Date, deps: ClipDeps, result: AiClipsResult, slots: Slots): Promise<void> {
  const row = await loadRow(id);
  if (!row || row.clipState !== "waiting") return;
  const plan = readVideoPlan(row.plan);
  const jobs = readClipJobs(row.clipJobs);
  // A start that died after taking the credits: clips already at Google are followed up, else the credits go back.
  if (row.clipCredits > 0) {
    if (jobs.some((j) => j.status === "submitted" || j.status === "retry")) {
      await prisma.contentVisual.updateMany({ where: { id, clipState: "waiting" }, data: { clipState: "making", clipUntil: new Date(now.getTime() + CLIP_GIVE_UP_MS) } });
      return;
    }
    if (await settle(id, now, CLIP_NOTES.failed, result)) result.fallback += 1;
    return;
  }
  // Nothing to make: not a pending video any more (made in the browser meanwhile, or removed), or no longer marked.
  if (!plan || row.kind !== "video" || row.status !== "pending" || plan.quality !== "ai") {
    await prisma.contentVisual.updateMany({ where: { id, clipState: "waiting", clipCredits: 0 }, data: { clipState: null } });
    return;
  }
  const env = deps.env ?? process.env;
  const fallback = async (note: string) => {
    if (await settle(id, now, note, result)) result.fallback += 1;
  };
  if (!(await isServiceEnabled("veo").catch(() => false)) || !veoOpts(deps).apiKey) return fallback(CLIP_NOTES.off);
  const picks = pickClipScenes(plan, AI_CLIPS_PER_VIDEO);
  if (picks.length === 0) return fallback(CLIP_NOTES.noPhoto);
  if ((await submittedToday(now)) + picks.length > clipsPerDay(env)) return fallback(CLIP_NOTES.busy);
  // Google is making as many clips as it takes at once: this video waits for the next sweep, nothing taken.
  if (slots.free <= 0) return;

  const seconds = AI_CLIP_SECONDS as VeoSeconds;
  const model = veoModel(env);
  const credits = picks.length * veoClipCredits(seconds, model, "720p", env);
  let periodStart: Date;
  try {
    ({ periodStart } = await consumeUsage(row.business.userId, "videoCredits", credits));
  } catch (error) {
    if (error instanceof UsageLimitError) return fallback(error.reason === "limit_reached" ? CLIP_NOTES.credits : CLIP_NOTES.blockedAccount);
    throw error;
  }
  const held = await prisma.contentVisual.updateMany({ where: { id, clipState: "waiting", clipCredits: 0 }, data: { clipCredits: credits, clipPeriodStart: periodStart, clipJobs: [] } });
  if (held.count !== 1) {
    await refundUsage(row.business.userId, "videoCredits", periodStart, credits).catch(() => {});
    return;
  }

  const facts = await clipFacts(row, plan);
  const needs = defaultClipPlan(facts, Math.max(picks.length, 2), seconds);
  const made: ClipJob[] = [];
  for (const [i, pick] of picks.entries()) {
    const prompt = veoPrompt(needs[i % needs.length], facts, { withImage: true, ratio: "9:16" });
    const job: ClipJob = { scene: pick.scene, photoPath: pick.photoPath, operation: null, status: "retry", tries: 0, prompt, error: null };
    // Past the places free at Google the clip waits ("retry") and is sent from a later sweep.
    if (slots.free > 0) await sendClip(row, job, deps, slots);
    made.push(job);
    // Kept after each clip, so a sweep that dies here still follows up the clips Google is already making.
    await prisma.contentVisual.updateMany({ where: { id, clipState: "waiting" }, data: { clipJobs: json(made) } });
  }
  if (!made.some((j) => j.status === "submitted" || j.status === "retry")) {
    const note = made.some((j) => j.error === "off") ? CLIP_NOTES.off : made.some((j) => j.error === "blocked") ? CLIP_NOTES.blocked : made.some((j) => j.error === "quota") ? CLIP_NOTES.googleBusy : CLIP_NOTES.failed;
    return fallback(note);
  }
  await prisma.contentVisual.updateMany({ where: { id, clipState: "waiting" }, data: { clipState: "making", clipUntil: new Date(now.getTime() + CLIP_GIVE_UP_MS) } });
  result.started += 1;
}

/**
 * Sends one clip to Google through the cost ledger (the switch, the platform cap) and takes a place among the clips made
 * at once. Google at its limit: the clip waits ("retry") until CLIP_QUOTA_TRIES, and no more clips are sent this sweep.
 */
async function sendClip(row: Row, job: ClipJob, deps: ClipDeps, slots: Slots): Promise<boolean> {
  const env = deps.env ?? process.env;
  const model = veoModel(env);
  const seconds = AI_CLIP_SECONDS as VeoSeconds;
  slots.free -= 1;
  try {
    const prompt = job.prompt;
    if (!prompt) throw new Error("The clip has no prompt to send.");
    const photo = await downloadPhoto(row.business.userId, job.photoPath);
    const frame = await firstFrame(photo, "9:16", null);
    job.operation = await withLedger(
      { userId: row.business.userId, businessId: row.businessId, feature: VIDEO_LEDGER_FEATURES.veo },
      { provider: "veo", model },
      () => submitVeo({ model, prompt, image: { base64: frame.toString("base64"), mimeType: "image/jpeg" }, ratio: "9:16", seconds, resolution: "720p" }, veoOpts(deps)),
      () => veoLedgerUsage(model, 0),
    );
    Object.assign(job, { status: "submitted", error: null });
    return true;
  } catch (error) {
    if (error instanceof VeoError && error.kind === "quota") {
      atLimit(job, slots);
      return false;
    }
    slots.free += 1;
    Object.assign(job, { status: "failed", error: error instanceof VeoError ? error.kind : error instanceof ServiceDisabledError ? "off" : "failed" });
    if (!(error instanceof VeoError)) await logError(error, { source: "visuals.ai-clips.submit", level: "warn", businessId: row.businessId }).catch(() => {});
    return false;
  }
}

/** Google turned the clip away at its limit (nothing made or billed): sent again later, or given up after the tries. */
function atLimit(job: ClipJob, slots: Slots) {
  const tries = (job.tries ?? 0) + 1;
  Object.assign(job, { status: tries >= CLIP_QUOTA_TRIES ? "failed" : "retry", tries, operation: null, error: "quota" });
  slots.free = 0;
}

async function checkClips(id: string, now: Date, deps: ClipDeps, result: AiClipsResult, slots: Slots): Promise<void> {
  const row = await loadRow(id);
  if (!row || row.clipState !== "making") return;
  const jobs = readClipJobs(row.clipJobs);
  const env = deps.env ?? process.env;
  const model = veoModel(env);
  const late = !!row.clipUntil && now.getTime() > row.clipUntil.getTime();
  for (const job of jobs) {
    if (job.status === "retry") continue;
    if (job.status !== "submitted" || !job.operation) {
      if (job.status === "submitted") Object.assign(job, { status: "failed", error: "failed" });
      continue;
    }
    try {
      const op = await getVeoOperation(job.operation, veoOpts(deps));
      if (!op.done) continue;
      // Finished one way or another: its place at Google is free again.
      slots.free += 1;
      if (op.error?.kind === "quota") {
        atLimit(job, slots);
        continue;
      }
      if (op.error || (!op.videoUri && !op.videoBytes)) {
        Object.assign(job, { status: "failed", error: op.error?.kind ?? "failed" });
        continue;
      }
      // Gemini Omni returns the clip inline; Veo gave an address to download.
      const bytes = await veoClipBytes(op, veoOpts(deps));
      if (bytes.length > MAX_CLIP_BYTES) {
        Object.assign(job, { status: "failed", error: "too_large" });
        continue;
      }
      const path = clipStoragePath(row.business.userId, id, job.scene);
      const up = await createAdminClient().storage.from("media").upload(path, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), { contentType: "video/mp4", upsert: true });
      if (up.error) throw new Error("The clip could not be saved.");
      // Gemini Omni has no length setting (the prompt asks for AI_CLIP_SECONDS): the real length is read from the file.
      const ms = videoDurationMs(new Uint8Array(bytes), "video/mp4") ?? AI_CLIP_SECONDS * 1000;
      Object.assign(job, { status: "made", path, bytes: bytes.length, ms, error: null });
      result.made += 1;
      // Google bills a made clip: its seconds go into the ledger (lib/ai/pricing.ts prices them).
      await recordAiCall({ userId: row.business.userId, businessId: row.businessId, feature: VIDEO_LEDGER_FEATURES.veo }, { ...veoLedgerUsage(model, Math.max(1, Math.round(ms / 1000))), success: true, durationMs: 0 });
    } catch (error) {
      // Google busy, the network, a save that failed: asked again next sweep, until the clips are given up.
      if (error instanceof VeoError && !error.temporary) Object.assign(job, { status: "failed", error: error.kind });
      else if (!(error instanceof VeoError)) await logError(error, { source: "visuals.ai-clips.save", level: "warn", businessId: row.businessId }).catch(() => {});
    }
  }
  // The clips waiting their turn (or Google's limit) are sent while there is room, until the video is given up.
  for (const job of jobs) {
    if (job.status !== "retry" || late || slots.free <= 0) continue;
    if (await sendClip(row, job, deps, slots)) result.retried += 1;
  }
  await prisma.contentVisual.updateMany({ where: { id, clipState: "making" }, data: { clipJobs: json(jobs) } });
  if (late || jobs.every((j) => j.status === "made" || j.status === "failed")) {
    if (await settle(id, now, null, result)) result.done += 1;
  }
}

/**
 * Ends the clip work, once: the made clips into the plan ("done"), else the simple video with the reason ("fallback"),
 * and the credits of the clips not made given back. `note` forces a fallback (nothing was made). True when this call
 * settled it.
 */
async function settle(id: string, now: Date, note: string | null, result: AiClipsResult): Promise<boolean> {
  const row = await loadRow(id);
  if (!row || !row.clipState || !(CLIP_WORKING as readonly string[]).includes(row.clipState)) return false;
  const late = !!row.clipUntil && now.getTime() > row.clipUntil.getTime();
  const jobs = readClipJobs(row.clipJobs).map((j) =>
    (j.status === "submitted" || j.status === "retry") && (late || note) ? { ...j, status: "failed" as const, error: j.status === "retry" ? "quota" : "timeout" } : j,
  );
  const made = note ? [] : jobs.filter((j) => j.status === "made" && j.path);
  const total = Math.max(1, jobs.length);
  const keep = Math.round((row.clipCredits * made.length) / total);
  const refund = row.clipCredits - keep;
  const plan = readVideoPlan(row.plan);
  let next: VideoPlan | null = plan;
  if (plan) {
    if (made.length) next = withClips(plan, made.map((j) => ({ scene: j.scene, path: j.path!, ms: j.ms ?? AI_CLIP_SECONDS * 1000 })), made.length < jobs.length ? CLIP_NOTES.partial : null);
    else next = withoutClips(plan, note ?? (jobs.some((j) => j.error === "blocked") ? CLIP_NOTES.blocked : jobs.some((j) => j.error === "timeout") ? CLIP_NOTES.timeout : jobs.some((j) => j.error === "quota") ? CLIP_NOTES.googleBusy : CLIP_NOTES.failed));
  }
  const { count } = await prisma.contentVisual.updateMany({
    where: { id, clipState: { in: [...CLIP_WORKING] }, clipCredits: row.clipCredits },
    data: { clipState: made.length ? "done" : "fallback", clipCredits: 0, clipPeriodStart: null, clipUntil: null, clipLeaseUntil: null, clipJobs: json(jobs), ...(next ? { plan: json(next) } : {}) },
  });
  if (count !== 1) return false;
  if (refund > 0 && row.clipPeriodStart) {
    try {
      await refundUsage(row.business.userId, "videoCredits", row.clipPeriodStart, refund);
      result.refunded += 1;
      result.credits += refund;
    } catch (error) {
      await logError(error, { source: "visuals.ai-clips.refund", businessId: row.businessId }).catch(() => {});
    }
  }
  return true;
}

/** What the clip prompts may say: the product's (or campaign's) name and short line, the country. No prices. */
async function clipFacts(row: Row, plan: VideoPlan): Promise<ClipFacts> {
  let productId: string | null = null;
  let campaignId: string | null = null;
  if (row.contentId) {
    const c = await prisma.generatedContent.findFirst({ where: { id: row.contentId, businessId: row.businessId }, select: { productId: true, campaignId: true } });
    productId = c?.productId ?? null;
    campaignId = c?.campaignId ?? null;
  } else if (row.groupId) {
    const p = await prisma.post.findFirst({ where: { groupId: row.groupId, businessId: row.businessId }, select: { productId: true, campaignId: true } });
    productId = p?.productId ?? null;
    campaignId = p?.campaignId ?? null;
  }
  const product = productId ? await prisma.product.findFirst({ where: { id: productId, businessId: row.businessId }, select: { name: true, summary: true } }) : null;
  const campaign = !product && campaignId ? await prisma.campaign.findFirst({ where: { id: campaignId, businessId: row.businessId }, select: { name: true, description: true } }) : null;
  return {
    productName: product?.name ?? campaign?.name ?? plan.scenes[0]?.text ?? row.business.name,
    summary: product?.summary ?? campaign?.description ?? null,
    country: row.business.country ?? null,
  };
}

/** A scene photo of the owner's own (album, gallery or design), at most 12 MB. */
async function downloadPhoto(userId: string, path: string): Promise<Buffer> {
  if (!isOwnPhotoPath(userId, path) && !isOwnDesignPath(userId, path)) throw new Error("Not the owner's photo.");
  const { data, error } = await createAdminClient().storage.from(bucketForPath(path)).download(path);
  if (error || !data) throw new Error("The photo could not be read.");
  if (data.size > MAX_PHOTO_BYTES) throw new Error("The photo is too large.");
  return Buffer.from(await data.arrayBuffer());
}

/** The owner's screen while clips are being made, and the browser's refusal to render meanwhile. */
export const CLIPS_IN_PROGRESS = "AI clips are being made for this video (usually within 15 minutes). It will be ready soon.";
export const clipsInProgress = (row: { clipState: string | null }) => !!row.clipState && (CLIP_WORKING as readonly string[]).includes(row.clipState);

/**
 * A video is going (removed, its content pruned, its subject deleted): credits still held for its clips go back once
 * (the same conditional update as settling), and its clip files are deleted. Clips Google is still making are left to
 * expire there (Google bills them; nothing can stop them).
 */
export async function releaseClips(id: string): Promise<void> {
  const row = await prisma.contentVisual.findUnique({ where: { id }, select: { plan: true, clipCredits: true, clipPeriodStart: true, business: { select: { userId: true } } } });
  if (!row) return;
  if (row.clipCredits > 0) {
    const { count } = await prisma.contentVisual.updateMany({ where: { id, clipCredits: row.clipCredits }, data: { clipState: "fallback", clipCredits: 0, clipPeriodStart: null } });
    if (count === 1 && row.clipPeriodStart) await refundUsage(row.business.userId, "videoCredits", row.clipPeriodStart, row.clipCredits).catch(() => {});
  }
  const paths = clipPathsOf(readVideoPlan(row.plan)).filter((p) => isOwnClipPath(row.business.userId, p));
  if (paths.length) await createAdminClient().storage.from("media").remove(paths).catch(() => {});
}
