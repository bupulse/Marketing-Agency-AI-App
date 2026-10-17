// Video Studio: Seedance jobs (docs/VIDEO_ENGINE.md, "Studio"). Submits a task to BytePlus, polls it every 10 s,
// downloads the MP4 as soon as it is ready (the BytePlus link lasts 24 hours), charges credits up front and refunds
// them when the task fails. References are sent as embedded data (base64), because the lab has no public address.
// Without the key (SEEDANCE_API_KEY), a submission becomes a free preview instead (video-lab/seedance-mock/): a job with
// status "preview" that turns into a storyboard after 3 to 8 seconds. With the key, nothing about the real path changes.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SEEDANCE_BASE_URL, cancelSeedanceTask, createSeedanceTask, estimateSeedanceUsd, getSeedanceTask, seedanceUsage, type SeedanceRequest, type SeedanceTask } from "@/lib/video-engine/seedance";
import { charge, refund, seedanceCredits } from "./credits";
import { PREVIEW_NOTICE, buildStoryboard, type Storyboard } from "./seedance-mock/storyboard";
import { previewDelayMs, previewThumbs } from "./seedance-mock/preview";
import { record } from "./store";

// SEEDANCE_LAB_DIR lets the tests use a temporary folder.
const DATA = path.resolve(process.env.SEEDANCE_LAB_DIR || "video-lab/data/seedance");
const JOBS = path.join(DATA, "jobs");
const VIDEOS = path.join(DATA, "videos");
const PREVIEWS = path.join(DATA, "previews");
const POLL_MS = 10_000;
const MAX_WAIT_MS = 20 * 60_000;
// Offline (flex) tasks can wait hours at BytePlus (its default task expiry is 48 hours): check every minute.
const FLEX_POLL_MS = 60_000;
const FLEX_MAX_WAIT_MS = 48 * 3600_000;

export type SeedanceJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  taskId: string | null;
  request: Omit<SeedanceRequest, "references"> & { referenceNotes: string[] };
  /** "preview" (no key yet: the storyboard is being made) and "preview-ready" (the storyboard is ready) are free. */
  status: "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "preview" | "preview-ready";
  credits: number;
  estimateUsd: number;
  tokens: number;
  costUsd: number;
  seed: number | null;
  videoFile: string | null;
  bytes: number | null;
  error: string | null;
  businessId: string | null;
  productId: string | null;
  title: string;
  /** Preview jobs only: nothing was charged; `credits` above is 0 and the real price is here. */
  preview?: { notice: string; readyAt: string; wouldCostCredits: number };
};

const safe = (id: string) => /^sd-[0-9a-f]{12}$/.test(id);
const jobFile = (id: string) => path.join(JOBS, `${id}.json`);

export async function saveSeedanceJob(job: SeedanceJob): Promise<void> {
  await fs.mkdir(JOBS, { recursive: true });
  job.updatedAt = new Date().toISOString();
  await fs.writeFile(jobFile(job.id), JSON.stringify(job, null, 2));
}

/** Reads a job. A preview whose time has come is marked ready here (no timers, so it survives a restart). */
export async function getSeedanceJob(id: string, now = Date.now()): Promise<SeedanceJob | null> {
  if (!safe(id)) return null;
  let job: SeedanceJob;
  try {
    job = JSON.parse(await fs.readFile(jobFile(id), "utf8")) as SeedanceJob;
  } catch {
    return null;
  }
  if (job.status === "preview" && job.preview && now >= Date.parse(job.preview.readyAt)) {
    job.status = "preview-ready";
    await saveSeedanceJob(job);
  }
  return job;
}

/**
 * The storyboard of a preview job: `{ ready: false, readyInMs }` while it is still "rendering", then
 * `{ ready: true, storyboard }`. Null for an unknown id or a real (non-preview) job.
 */
export async function getSeedancePreview(id: string, now = Date.now()): Promise<{ ready: false; readyInMs: number; notice: string } | { ready: true; storyboard: Storyboard } | null> {
  const job = await getSeedanceJob(id, now);
  if (!job?.preview) return null;
  if (job.status === "preview") return { ready: false, readyInMs: Math.max(0, Date.parse(job.preview.readyAt) - now), notice: job.preview.notice };
  try {
    return { ready: true, storyboard: JSON.parse(await fs.readFile(path.join(PREVIEWS, `${id}.json`), "utf8")) as Storyboard };
  } catch {
    return null;
  }
}

export async function listSeedanceJobs(): Promise<SeedanceJob[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(JOBS);
  } catch {
    return [];
  }
  const jobs = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => getSeedanceJob(f.slice(0, -5))));
  return jobs.filter((j): j is SeedanceJob => !!j).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}

export async function seedanceVideoBytes(id: string): Promise<Buffer | null> {
  if (!safe(id)) return null;
  return fs.readFile(path.join(VIDEOS, `${id}.mp4`)).catch(() => null);
}

const opts = () => ({ apiKey: process.env.SEEDANCE_API_KEY as string, baseUrl: process.env.SEEDANCE_BASE_URL || SEEDANCE_BASE_URL });
export const seedanceReady = () => !!process.env.SEEDANCE_API_KEY?.trim();
/** "live" sends to BytePlus; "preview" makes free storyboards until the key is added. */
export const seedanceMode = (): "live" | "preview" => (seedanceReady() ? "live" : "preview");

/** An image reference as a data URL, resized to at most 1600 px (BytePlus: 300 to 6000 px, under 30 MB). */
export async function imageDataUrl(bytes: Buffer): Promise<string> {
  const out = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/**
 * Submits a job: charges the credits, creates the BytePlus task and starts polling. Returns at once; the page polls
 * the job. A refused submission refunds the credits.
 */
type SubmitMeta = { businessId: string | null; productId: string | null; title: string; referenceNotes: string[] };
const newSeedanceId = () => `sd-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

export async function submitSeedance(req: SeedanceRequest, meta: SubmitMeta): Promise<SeedanceJob> {
  if (!seedanceReady()) return previewSeedance(req, meta);
  const id = newSeedanceId();
  const credits = seedanceCredits(req.tier, req.resolution, req.seconds);
  const request = { tier: req.tier, prompt: req.prompt, ratio: req.ratio, seconds: req.seconds, resolution: req.resolution, audio: req.audio, fixedLens: req.fixedLens, seed: req.seed, watermark: req.watermark, flex: req.flex, draft: req.draft };
  const job: SeedanceJob = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taskId: null,
    request: { ...request, referenceNotes: meta.referenceNotes },
    status: "submitting",
    credits,
    estimateUsd: estimateSeedanceUsd(req),
    tokens: 0,
    costUsd: 0,
    seed: null,
    videoFile: null,
    bytes: null,
    error: null,
    businessId: meta.businessId,
    productId: meta.productId,
    title: meta.title,
  };
  await charge(credits, `Seedance ${req.tier} ${req.resolution} ${req.seconds}s`, id);
  await saveSeedanceJob(job);
  try {
    job.taskId = await createSeedanceTask(req, opts());
    job.status = "queued";
    await saveSeedanceJob(job);
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "The request was refused.";
    await saveSeedanceJob(job);
    await refund(credits, "Seedance request refused", id);
    throw error;
  }
  void poll(job.id);
  return job;
}

/**
 * No key yet: a free preview job. Status "preview", ready after 3 to 8 seconds as a storyboard (shot list, camera,
 * timing, sound, which reference each shot uses, 3 or 4 sketched frames and the real price). No credits are taken.
 */
export async function previewSeedance(req: SeedanceRequest, meta: SubmitMeta, now = Date.now()): Promise<SeedanceJob> {
  const id = newSeedanceId();
  const wouldCostCredits = seedanceCredits(req.tier, req.draft ? "480p" : req.resolution, Math.min(15, Math.max(4, Math.round(req.seconds))));
  const at = new Date(now).toISOString();
  const job: SeedanceJob = {
    id,
    createdAt: at,
    updatedAt: at,
    taskId: null,
    request: { tier: req.tier, prompt: req.prompt, ratio: req.ratio, seconds: req.seconds, resolution: req.resolution, audio: req.audio, fixedLens: req.fixedLens, seed: req.seed, watermark: req.watermark, flex: req.flex, draft: req.draft, referenceNotes: meta.referenceNotes },
    status: "preview",
    credits: 0,
    estimateUsd: estimateSeedanceUsd(req),
    tokens: 0,
    costUsd: 0,
    seed: null,
    videoFile: null,
    bytes: null,
    error: null,
    businessId: meta.businessId,
    productId: meta.productId,
    title: meta.title,
    preview: { notice: PREVIEW_NOTICE, readyAt: new Date(now + previewDelayMs(id)).toISOString(), wouldCostCredits },
  };
  const storyboard = buildStoryboard({ id, title: meta.title, request: req, referenceNotes: meta.referenceNotes, thumbs: await previewThumbs(req.references), credits: wouldCostCredits });
  await fs.mkdir(PREVIEWS, { recursive: true });
  await fs.writeFile(path.join(PREVIEWS, `${id}.json`), JSON.stringify(storyboard));
  await saveSeedanceJob(job);
  return job;
}

const polling = new Set<string>();

async function poll(id: string): Promise<void> {
  if (polling.has(id)) return;
  polling.add(id);
  const started = Date.now();
  const first = await getSeedanceJob(id);
  const pollMs = first?.request.flex ? FLEX_POLL_MS : POLL_MS;
  const maxWaitMs = first?.request.flex ? FLEX_MAX_WAIT_MS : MAX_WAIT_MS;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, pollMs));
      const job = await getSeedanceJob(id);
      if (!job || !job.taskId || job.status === "cancelled" || job.status === "succeeded" || job.status === "failed") return;
      let task: SeedanceTask;
      try {
        task = await getSeedanceTask(job.taskId, opts());
      } catch {
        if (Date.now() - started > maxWaitMs) {
          job.status = "failed";
          job.error = "BytePlus stopped answering. The credits are given back.";
          await saveSeedanceJob(job);
          await refund(job.credits, "Seedance lost", id);
          return;
        }
        continue;
      }
      job.tokens = task.tokens;
      job.costUsd = task.costUsd;
      job.seed = task.seed;
      if (task.status === "succeeded" && task.videoUrl) {
        try {
          await download(id, task.videoUrl);
          job.videoFile = `${id}.mp4`;
          job.bytes = (await fs.stat(path.join(VIDEOS, `${id}.mp4`))).size;
          job.status = "succeeded";
        } catch {
          job.status = "failed";
          job.error = "The video was made but could not be downloaded. Try again.";
        }
        await record(id, "seedance", [seedanceUsage(job.request.tier, task.tokens)]);
        await saveSeedanceJob(job);
        return;
      }
      if (task.status === "failed" || task.status === "expired") {
        job.status = "failed";
        job.error = task.error ?? "Seedance could not make this video.";
        await saveSeedanceJob(job);
        // BytePlus bills only successful videos: the credits go back.
        await refund(job.credits, "Seedance failed", id);
        return;
      }
      job.status = task.status === "queued" ? "queued" : "running";
      await saveSeedanceJob(job);
      if (Date.now() - started > maxWaitMs) {
        job.status = "failed";
        job.error = `Seedance took more than ${job.request.flex ? "48 hours" : "20 minutes"}. The credits are given back.`;
        await saveSeedanceJob(job);
        await refund(job.credits, "Seedance timeout", id);
        return;
      }
    }
  } finally {
    polling.delete(id);
  }
}

async function download(id: string, url: string): Promise<void> {
  if (!/^https:\/\/[a-z0-9.-]+\.(bytepluses|volces|byteplus)\.com\//i.test(url)) throw new Error("Unexpected video host");
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 200 * 1024 * 1024) throw new Error("too large");
  await fs.mkdir(VIDEOS, { recursive: true });
  await fs.writeFile(path.join(VIDEOS, `${id}.mp4`), bytes);
}

export async function cancelSeedance(id: string): Promise<SeedanceJob | null> {
  const job = await getSeedanceJob(id);
  if (!job) return null;
  if (job.status === "preview") {
    // Nothing was charged for a preview, so nothing is given back.
    job.status = "cancelled";
    await saveSeedanceJob(job);
  } else if (job.status === "queued" || job.status === "submitting") {
    if (job.taskId) await cancelSeedanceTask(job.taskId, opts()).catch(() => undefined);
    job.status = "cancelled";
    await saveSeedanceJob(job);
    await refund(job.credits, "Seedance cancelled", id);
  }
  return job;
}

/** On start: resume polling of jobs that were still running when the server last stopped. */
export async function resumeSeedanceJobs(): Promise<void> {
  if (!seedanceReady()) return;
  for (const job of await listSeedanceJobs()) if ((job.status === "queued" || job.status === "running") && job.taskId) void poll(job.id);
}
