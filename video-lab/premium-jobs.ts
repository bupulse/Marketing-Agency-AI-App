// Video Studio: Premium 3D jobs (docs/BLENDER.md, "Wiring it into the studio"). Claude designs one Blender scene from
// the same brief as a Motion video (lib/video-engine/blender-design.ts), then Blender renders it on this Mac
// (video-lab/blender-jobs.ts), one render at a time. A job is charged first and given back when the design or the
// render fails. The photos Blender reads are copied by the server into the job's own folder: no path ever comes from
// the browser or from Claude.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { designBlenderScene } from "@/lib/video-engine/blender-design";
import type { ClaudeTransport, DesignBrief } from "@/lib/video-engine/designer";
import type { FactWarning } from "@/lib/video-engine/factcheck";
import type { BlenderPhoto } from "@/tools/blender/scene";
import { renderBlenderScene } from "./blender-jobs";
import { PREMIUM_3D_CREDITS, charge, refund } from "./credits";
import { record } from "./store";

const DATA = path.resolve("video-lab/data/blender");
const JOBS = path.join(DATA, "jobs");
const VIDEOS = path.join(DATA, "videos");

export type PremiumJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "designing" | "rendering" | "succeeded" | "failed";
  /** 0 to 1 while Blender renders. */
  progress: number;
  credits: number;
  businessId: string;
  productId: string;
  title: string;
  templateId: string;
  ratio: string;
  seconds: number;
  note: string | null;
  caption: string | null;
  hashtags: string[];
  say: string | null;
  /** Repairs made to Claude's scene, and claims the fact check could not find in the brief. */
  repairs: string[];
  warnings: FactWarning[];
  apiEquivalentUsd: number;
  renderSeconds: number | null;
  bytes: number | null;
  videoFile: string | null;
  error: string | null;
};

const safe = (id: string) => /^bl-[0-9a-f]{12}$/.test(id);
const jobFile = (id: string) => path.join(JOBS, `${id}.json`);
export const premiumVideoPath = (id: string) => path.join(VIDEOS, `${id}.mp4`);

async function save(job: PremiumJob): Promise<void> {
  await fs.mkdir(JOBS, { recursive: true });
  job.updatedAt = new Date().toISOString();
  await fs.writeFile(jobFile(job.id), JSON.stringify(job, null, 2));
}

export async function getPremiumJob(id: string): Promise<PremiumJob | null> {
  if (!safe(id)) return null;
  return fs
    .readFile(jobFile(id), "utf8")
    .then((t) => JSON.parse(t) as PremiumJob)
    .catch(() => null);
}

export async function listPremiumJobs(): Promise<PremiumJob[]> {
  const files = await fs.readdir(JOBS).catch(() => [] as string[]);
  const jobs = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => getPremiumJob(f.slice(0, -5))));
  return jobs.filter((j): j is PremiumJob => !!j).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export async function premiumVideoBytes(id: string): Promise<Buffer | null> {
  if (!safe(id)) return null;
  return fs.readFile(premiumVideoPath(id)).catch(() => null);
}

/**
 * Starts a Premium 3D clip: charges the credits (throws in plain English when there are not enough), saves the job and
 * returns it at once; the design and the render run on. The page polls getPremiumJob.
 */
export async function startPremium3d(input: { brief: DesignBrief; files: { jpeg: Buffer; cutout: Buffer | null }[]; send: ClaudeTransport; model: string; meta: { businessId: string; productId: string; title: string } }): Promise<PremiumJob> {
  const id = `bl-${randomBytes(6).toString("hex")}`;
  await charge(PREMIUM_3D_CREDITS, "Premium 3D (Blender)", id);
  const at = new Date().toISOString();
  const job: PremiumJob = {
    id,
    createdAt: at,
    updatedAt: at,
    status: "designing",
    progress: 0,
    credits: PREMIUM_3D_CREDITS,
    ...input.meta,
    templateId: input.brief.styleId,
    ratio: input.brief.ratio,
    seconds: input.brief.seconds,
    note: input.brief.note ?? null,
    caption: null,
    hashtags: [],
    say: null,
    repairs: [],
    warnings: [],
    apiEquivalentUsd: 0,
    renderSeconds: null,
    bytes: null,
    videoFile: null,
    error: null,
  };
  await save(job);
  void run(job, input);
  return job;
}

async function run(job: PremiumJob, input: Parameters<typeof startPremium3d>[0]): Promise<void> {
  try {
    // The photo files Blender reads: written here by the server, in the job's own folder.
    const dir = path.join(DATA, "photos", job.id);
    await fs.mkdir(dir, { recursive: true });
    const photos: BlenderPhoto[] = [];
    for (const [i, f] of input.files.entries()) {
      const image = path.join(dir, `photo-${i + 1}.jpg`);
      await fs.writeFile(image, f.jpeg);
      let cutout: string | null = null;
      if (f.cutout) {
        cutout = path.join(dir, `photo-${i + 1}-cutout.png`);
        await fs.writeFile(cutout, f.cutout);
      }
      photos.push({ image, cutout });
    }
    const design = await designBlenderScene(input.brief, input.send, input.model, { photos, quality: "540p" }).catch(async (error: Error & { usage?: [] }) => {
      if (error.usage) await record(job.id, "claude-blender-design", error.usage);
      throw error;
    });
    await record(job.id, "claude-blender-design", design.usage);
    Object.assign(job, { status: "rendering", seconds: design.scene.duration, caption: design.caption, hashtags: design.hashtags, say: design.say || null, repairs: design.warnings, warnings: design.factWarnings, apiEquivalentUsd: design.apiEquivalentUsd });
    await save(job);
    let saved = 0;
    const out = await renderBlenderScene(design.scene, premiumVideoPath(job.id), {
      photos,
      onProgress: (f) => {
        job.progress = Math.round(f * 100) / 100;
        // At most every 5%, so the job file is not rewritten for every frame.
        if (job.progress - saved >= 0.05) {
          saved = job.progress;
          void save(job);
        }
      },
    });
    Object.assign(job, { status: "succeeded", progress: 1, renderSeconds: Math.round(out.seconds), bytes: out.bytes, videoFile: `${job.id}.mp4` });
    await save(job);
  } catch (error) {
    Object.assign(job, { status: "failed", error: `${error instanceof Error ? error.message : "The 3D clip could not be made."} The credits are given back.` });
    await save(job);
    await refund(job.credits, "Premium 3D failed", job.id);
  }
}

/** On start: a job that was designing or rendering when the studio stopped cannot finish; its credits go back. */
export async function recoverPremiumJobs(): Promise<number> {
  let n = 0;
  for (const job of await listPremiumJobs()) {
    if (job.status !== "designing" && job.status !== "rendering") continue;
    Object.assign(job, { status: "failed", error: "The studio restarted during this 3D clip. The credits are given back." });
    await save(job);
    await refund(job.credits, "Premium 3D stopped by a restart", job.id);
    n += 1;
  }
  return n;
}
