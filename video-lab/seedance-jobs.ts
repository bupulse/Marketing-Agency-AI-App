// Video Studio: Seedance jobs (docs/VIDEO_ENGINE.md, "Studio"). Submits a task to BytePlus, polls it every 10 s,
// downloads the MP4 as soon as it is ready (the BytePlus link lasts 24 hours), charges credits up front and refunds
// them when the task fails. References are sent as embedded data (base64), because the lab has no public address.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SEEDANCE_BASE_URL, SeedanceError, cancelSeedanceTask, createSeedanceTask, estimateSeedanceUsd, getSeedanceTask, seedanceUsage, type SeedanceRequest, type SeedanceTask } from "@/lib/video-engine/seedance";
import { charge, refund, seedanceCredits } from "./credits";
import { record } from "./store";

const DATA = path.resolve("video-lab/data/seedance");
const JOBS = path.join(DATA, "jobs");
const VIDEOS = path.join(DATA, "videos");
const POLL_MS = 10_000;
const MAX_WAIT_MS = 20 * 60_000;

export type SeedanceJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  taskId: string | null;
  request: Omit<SeedanceRequest, "references"> & { referenceNotes: string[] };
  status: "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
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
};

const safe = (id: string) => /^sd-[0-9a-f]{12}$/.test(id);
const jobFile = (id: string) => path.join(JOBS, `${id}.json`);

export async function saveSeedanceJob(job: SeedanceJob): Promise<void> {
  await fs.mkdir(JOBS, { recursive: true });
  job.updatedAt = new Date().toISOString();
  await fs.writeFile(jobFile(job.id), JSON.stringify(job, null, 2));
}

export async function getSeedanceJob(id: string): Promise<SeedanceJob | null> {
  if (!safe(id)) return null;
  try {
    return JSON.parse(await fs.readFile(jobFile(id), "utf8")) as SeedanceJob;
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
export const seedanceReady = () => !!process.env.SEEDANCE_API_KEY;

/** An image reference as a data URL, resized to at most 1600 px (BytePlus: 300 to 6000 px, under 30 MB). */
export async function imageDataUrl(bytes: Buffer): Promise<string> {
  const out = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/**
 * Submits a job: charges the credits, creates the BytePlus task and starts polling. Returns at once; the page polls
 * the job. A refused submission refunds the credits.
 */
export async function submitSeedance(req: SeedanceRequest, meta: { businessId: string | null; productId: string | null; title: string; referenceNotes: string[] }): Promise<SeedanceJob> {
  if (!seedanceReady()) throw new SeedanceError("The BytePlus key (SEEDANCE_API_KEY) is not set yet.");
  const id = `sd-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
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

const polling = new Set<string>();

async function poll(id: string): Promise<void> {
  if (polling.has(id)) return;
  polling.add(id);
  const started = Date.now();
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const job = await getSeedanceJob(id);
      if (!job || !job.taskId || job.status === "cancelled" || job.status === "succeeded" || job.status === "failed") return;
      let task: SeedanceTask;
      try {
        task = await getSeedanceTask(job.taskId, opts());
      } catch {
        if (Date.now() - started > MAX_WAIT_MS) {
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
      if (Date.now() - started > MAX_WAIT_MS) {
        job.status = "failed";
        job.error = "Seedance took more than 20 minutes. The credits are given back.";
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
  if (job.status === "queued" || job.status === "submitting") {
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
