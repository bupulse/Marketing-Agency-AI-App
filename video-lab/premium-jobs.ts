// Video Studio: Premium 3D jobs (docs/BLENDER.md, "Wiring it into the studio"). Claude designs one Blender scene from
// the same brief as a Motion video (lib/video-engine/blender-design.ts), then Blender renders it on this Mac
// (video-lab/blender-jobs.ts), one render at a time. A job is charged first and given back when the design or the
// render fails. The photos Blender reads are copied by the server into the job's own folder: no path ever comes from
// the browser or from Claude. Before the render, the scene's spoken line becomes an ElevenLabs voice-over (charged like a
// Motion video's, given back when it fails) and a library track can be chosen; both are kept in the job's folder for
// Blender to mix in (renderBlenderScene's audio options, being added by the Blender pipeline).
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { designBlenderScene } from "@/lib/video-engine/blender-design";
import type { ClaudeTransport, DesignBrief } from "@/lib/video-engine/designer";
import type { MotionSpec } from "@/lib/video-engine/spec";
import type { FactWarning } from "@/lib/video-engine/factcheck";
import type { BlenderPhoto, BlenderScene } from "@/tools/blender/scene";
import { renderBlenderScene } from "./blender-jobs";
import { PREMIUM_3D_CREDITS, PREMIUM_RERENDER_CREDITS, VOICE_OVER_CREDITS, charge, refund, type PremiumQuality } from "./credits";
import { musicBytes, musicFor } from "./data-source";
import { makeVoiceForJob, readVoiceMp3 } from "./voice";
import { record } from "./store";

const DATA = path.resolve("video-lab/data/blender");
/**
 * Whether renderBlenderScene mixes a voice and music into the clip yet (the Blender pipeline is adding it). Until it
 * does, no voice is made (it would be charged but not heard) and the page says the sound comes later.
 */
export const BLENDER_MIXES_AUDIO = false;
const JOBS = path.join(DATA, "jobs");
const VIDEOS = path.join(DATA, "videos");

export type PremiumJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "designing" | "voicing" | "rendering" | "succeeded" | "failed";
  /** 0 to 1 while Blender renders. */
  progress: number;
  credits: number;
  quality: PremiumQuality;
  /** A re-render of this job's scene (no new design). */
  parentId: string | null;
  /** The photo files Blender reads, in the order the scene numbers them (server-made paths, in a job's folder). */
  photoFiles: BlenderPhoto[];
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
  /** The voice-over and music asked for, and what was made (files in the job's folder). */
  audio: { voice: boolean; music: boolean; voiceFile: string | null; voiceNote: string | null; voiceCredits: number; musicFile: string | null; musicTitle: string | null };
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
export async function startPremium3d(input: { brief: DesignBrief; files: { jpeg: Buffer; cutout: Buffer | null }[]; send: ClaudeTransport; model: string; meta: { businessId: string; productId: string; title: string }; voice: boolean; music: boolean; quality: PremiumQuality }): Promise<PremiumJob> {
  const id = `bl-${randomBytes(6).toString("hex")}`;
  await charge(PREMIUM_3D_CREDITS[input.quality], `Premium 3D ${input.quality} (Blender)`, id);
  const at = new Date().toISOString();
  const job: PremiumJob = {
    id,
    createdAt: at,
    updatedAt: at,
    status: "designing",
    progress: 0,
    credits: PREMIUM_3D_CREDITS[input.quality],
    quality: input.quality,
    parentId: null,
    photoFiles: [],
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
    audio: { voice: input.voice, music: input.music, voiceFile: null, voiceNote: null, voiceCredits: 0, musicFile: null, musicTitle: null },
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
    job.photoFiles = photos;
    const design = await designBlenderScene(input.brief, input.send, input.model, { photos, quality: input.quality }).catch(async (error: Error & { usage?: [] }) => {
      if (error.usage) await record(job.id, "claude-blender-design", error.usage);
      throw error;
    });
    await record(job.id, "claude-blender-design", design.usage);
    Object.assign(job, { seconds: design.scene.duration, caption: design.caption, hashtags: design.hashtags, say: design.say || null, repairs: design.warnings, warnings: design.factWarnings, apiEquivalentUsd: design.apiEquivalentUsd });
    await addAudio(job, dir, design.say, input.brief.business.language ?? null);
    await render(job, design.scene);
  } catch (error) {
    Object.assign(job, { status: "failed", error: `${error instanceof Error ? error.message : "The 3D clip could not be made."} The credits are given back.` });
    await save(job);
    await refund(job.credits + job.audio.voiceCredits, "Premium 3D failed", job.id);
  }
}

/** Renders a scene for a job (progress saved as it goes), then marks the job done. Throws when Blender fails. */
async function render(job: PremiumJob, scene: BlenderScene): Promise<void> {
  job.status = "rendering";
  await save(job);
  let saved = 0;
  const out = await renderBlenderScene(scene, premiumVideoPath(job.id), {
    photos: job.photoFiles,
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
}

/** The photos written for a job (photo-N.jpg, and photo-N-cutout.png when there is one), in order. */
async function photosInFolder(id: string): Promise<BlenderPhoto[]> {
  const dir = path.join(DATA, "photos", id);
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const numbers = files.map((f) => /^photo-(\d+)\.jpg$/.exec(f)?.[1]).filter((n): n is string => !!n).map(Number).sort((a, b) => a - b);
  return numbers.map((n) => ({ image: path.join(dir, `photo-${n}.jpg`), cutout: files.includes(`photo-${n}-cutout.png`) ? path.join(dir, `photo-${n}-cutout.png`) : null }));
}

/**
 * Renders a finished clip's scene again (no new design, the same photos and sound), at either resolution:
 * PREMIUM_RERENDER_CREDITS, given back when it fails. Throws in plain English when the clip cannot be re-rendered.
 */
export async function rerenderPremium(sourceId: string, quality: PremiumQuality): Promise<PremiumJob> {
  const source = await getPremiumJob(sourceId);
  if (!source || source.status !== "succeeded") throw new Error("Only a finished 3D clip can be rendered again.");
  // renderBlenderScene keeps the checked scene next to the MP4.
  const scene = await fs
    .readFile(premiumVideoPath(source.id).replace(/\.mp4$/, ".scene.json"), "utf8")
    .then((t) => JSON.parse(t) as BlenderScene)
    .catch(() => null);
  // Clips made before the photo list was kept: the same files, found in the job's own folder.
  const photoFiles = source.photoFiles?.length ? source.photoFiles : await photosInFolder(source.id);
  if (!scene || !photoFiles.length) throw new Error("This clip's scene was not kept, so it cannot be rendered again.");
  const id = `bl-${randomBytes(6).toString("hex")}`;
  await charge(PREMIUM_RERENDER_CREDITS, `Premium 3D re-render ${quality}`, id);
  const at = new Date().toISOString();
  const job: PremiumJob = { ...source, photoFiles, id, createdAt: at, updatedAt: at, status: "rendering", progress: 0, credits: PREMIUM_RERENDER_CREDITS, quality, parentId: source.id, apiEquivalentUsd: 0, audio: { ...source.audio, voiceCredits: 0 }, renderSeconds: null, bytes: null, videoFile: null, error: null };
  await save(job);
  void render(job, { ...scene, canvas: { ...scene.canvas, quality } }).catch(async (error) => {
    Object.assign(job, { status: "failed", error: `${error instanceof Error ? error.message : "The 3D clip could not be made."} The credits are given back.` });
    await save(job);
    await refund(job.credits, "Premium 3D re-render failed", job.id);
  });
  return job;
}

/**
 * The voice-over of the scene's spoken line (ElevenLabs, in the business's language rules: Kinyarwanda is spoken in
 * English) and a library music track, written into the job's folder. A voice that fails is given back and the clip is
 * made without it, as for Motion videos.
 */
async function addAudio(job: PremiumJob, dir: string, say: string, language: string | null): Promise<void> {
  if (!BLENDER_MIXES_AUDIO) return;
  if (job.audio.voice && say.trim()) {
    job.status = "voicing";
    await save(job);
    try {
      await charge(VOICE_OVER_CREDITS, "Premium 3D voice-over", job.id);
      job.audio.voiceCredits = VOICE_OVER_CREDITS;
      // makeVoiceForJob speaks a design's scene lines: the clip is one scene with one line.
      const oneScene = { scenes: [{ seconds: job.seconds, say, layers: [] }] } as unknown as MotionSpec;
      const v = await makeVoiceForJob(oneScene, job.id, { language });
      const mp3 = v ? await readVoiceMp3(v.hash) : null;
      if (!v || !mp3) throw new Error("No voice line to speak.");
      if (v.cached) {
        await refund(VOICE_OVER_CREDITS, "Voice-over already made (free)", job.id);
        job.audio.voiceCredits = 0;
      }
      await fs.writeFile(path.join(dir, "voice.mp3"), mp3);
      Object.assign(job.audio, { voiceFile: "voice.mp3", voiceNote: v.note ?? (v.fits ? null : "The voice is longer than the clip; it is cut at the end.") });
    } catch (error) {
      if (job.audio.voiceCredits) await refund(job.audio.voiceCredits, "Premium 3D voice-over failed", job.id);
      Object.assign(job.audio, { voiceCredits: 0, voiceNote: `No voice-over: ${error instanceof Error ? error.message : "it failed"} The clip is made without it.` });
    }
  }
  if (job.audio.music) {
    const track = await musicFor("upbeat").catch(() => null);
    if (track) {
      const t = await musicBytes(track.id);
      const file = `music.${t.mimeType.includes("wav") ? "wav" : "mp3"}`;
      await fs.writeFile(path.join(dir, file), t.bytes);
      Object.assign(job.audio, { musicFile: file, musicTitle: track.title });
    }
  }
}

/** On start: a job that was designing or rendering when the studio stopped cannot finish; its credits go back. */
export async function recoverPremiumJobs(): Promise<number> {
  let n = 0;
  for (const job of await listPremiumJobs()) {
    if (job.status !== "designing" && job.status !== "voicing" && job.status !== "rendering") continue;
    Object.assign(job, { status: "failed", error: "The studio restarted during this 3D clip. The credits are given back." });
    await save(job);
    await refund(job.credits + (job.audio?.voiceCredits ?? 0), "Premium 3D stopped by a restart", job.id);
    n += 1;
  }
  return n;
}
