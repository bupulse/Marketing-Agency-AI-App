// Runs the Python renderer (tools/ad-render/render.py) as its own process, so a 1 to 3 minute render never blocks the
// web server (docs/AD_BRAIN.md, "Where the renderer runs"). The pipeline starts a render detached and checks for its
// result on later steps; a restarted server finds the result file, or starts the render again once its lease is over.
// Needs Python 3.9+ with Pillow and numpy, and ffmpeg (AD_RENDER_PYTHON / AD_RENDER_FFMPEG point at them).
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Edl } from "./edl";

export type RenderJob = { edl: Edl; files: Record<string, string>; logo?: string | null; host: string; workDir: string };
export type RenderResult = { ok: true; seconds: number; frames: number; renderSeconds: number; bytes: number; voiceRms: number; musicUnderVoiceRms: number } | { ok: false; error: string };

/** Where an ad's files and frames are kept while it is made (AD_BRAIN_WORK_DIR, else the system's temp folder). */
export const workRoot = () => process.env.AD_BRAIN_WORK_DIR?.trim() || path.join(/*turbopackIgnore: true*/ os.tmpdir(), "bupulse-ad-brain");
export const jobDir = (jobId: string) => path.join(/*turbopackIgnore: true*/ workRoot(), jobId.replace(/[^A-Za-z0-9_-]/g, ""));

export function rendererCommand(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): { python: string; script: string } {
  const python = env.AD_RENDER_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
  return { python, script: path.join(/*turbopackIgnore: true*/ cwd, "tools", "ad-render", "render.py") };
}

/** Runs the renderer with these arguments and waits (analyze, selftest, a short render in tests). */
export function runRenderer(args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
  const { python, script } = rendererCommand();
  return new Promise((resolve) => {
    const child = spawn(/*turbopackIgnore: true*/ python, [script, ...args], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 120_000);
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: `${err}${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

/** The last JSON line a renderer command printed (its result or its error). */
export function lastJsonLine<T>(out: string): T | null {
  const lines = out.trim().split(/\r?\n/).reverse();
  for (const l of lines) {
    try {
      return JSON.parse(l) as T;
    } catch {
      // not JSON
    }
  }
  return null;
}

/** A music track's tempo and first strong beat (free, local), for the planner's beat grid and the drop. */
export async function analyzeMusic(file: string): Promise<{ seconds: number; bpm: number; firstBeat: number } | null> {
  const r = await runRenderer(["analyze", file], { timeoutMs: 60_000 });
  return r.code === 0 ? lastJsonLine(r.out) : null;
}

/** Runs ffmpeg or ffprobe (AD_RENDER_FFMPEG / AD_RENDER_FFPROBE) and waits. */
function runTool(bin: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += String(d)));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, out });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out });
    });
  });
}

/** A media file's length in seconds (ffprobe), or null. */
export async function probeSeconds(file: string): Promise<number | null> {
  const r = await runTool(process.env.AD_RENDER_FFPROBE?.trim() || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], 30_000);
  const n = Number(r.out.trim());
  return r.code === 0 && Number.isFinite(n) && n > 0 ? n : null;
}

/** Gemini takes a file of up to about 20 MB in the request (base64 adds a third): bigger ads are re-encoded first. */
export const JUDGE_INLINE_MAX_BYTES = 14 * 1024 * 1024;

/**
 * The ad as the judge sees it: at full 720p (owner's calibration, 11 Nov 2026: small text and screens must be readable),
 * the file itself when it is small enough to send, else a 720p re-encode at lower quality (same frames and sound; Gemini
 * bills by duration, not bytes).
 */
export async function judgeCopy(file: string, out: string): Promise<string> {
  const size = (await fs.stat(/*turbopackIgnore: true*/ file).catch(() => null))?.size ?? 0;
  if (size > 0 && size <= JUDGE_INLINE_MAX_BYTES) return file;
  const r = await runTool(process.env.AD_RENDER_FFMPEG?.trim() || "ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "scale=720:-2", "-c:v", "libx264", "-crf", "28", "-preset", "fast", "-c:a", "aac", "-b:a", "128k", out], 180_000);
  return r.code === 0 ? out : file;
}

/** Writes job.json and starts the render in the background. Its progress goes to render.log, its result to <out>.json. */
export async function startRender(job: RenderJob, outPath: string): Promise<{ pid: number | undefined }> {
  await fs.mkdir(job.workDir, { recursive: true });
  const jobPath = path.join(job.workDir, "job.json");
  await fs.writeFile(jobPath, JSON.stringify(job));
  await fs.rm(`${outPath}.json`, { force: true });
  const { python, script } = rendererCommand();
  const log = createWriteStream(path.join(job.workDir, "render.log"));
  const child = spawn(/*turbopackIgnore: true*/ python, [script, "render", jobPath, outPath], { stdio: ["ignore", "pipe", "pipe"], env: process.env, windowsHide: true });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("close", async (code) => {
    // A crash before the renderer wrote its result: leave one, so the next step can say what happened.
    if (code !== 0 && !existsSync(`${outPath}.json`)) {
      const text = await fs.readFile(path.join(job.workDir, "render.log"), "utf8").catch(() => "");
      const err = lastJsonLine<{ error?: string }>(text)?.error ?? (text.trim().split(/\r?\n/).pop() || `the renderer stopped (code ${code})`);
      await fs.writeFile(`${outPath}.json`, JSON.stringify({ ok: false, error: String(err).slice(0, 400) })).catch(() => undefined);
    }
  });
  child.on("error", async (e) => {
    await fs.writeFile(`${outPath}.json`, JSON.stringify({ ok: false, error: `The renderer could not start (${e.message}). Is Python installed? See docs/AD_BRAIN.md.` })).catch(() => undefined);
  });
  return { pid: child.pid };
}

/** The render's result once it has finished (null while it is still running). */
export async function readRenderResult(outPath: string): Promise<RenderResult | null> {
  try {
    return JSON.parse(await fs.readFile(`${outPath}.json`, "utf8")) as RenderResult;
  } catch {
    return null;
  }
}

/** How far the render is (0 to 1), from its log. */
export async function renderProgress(workDir: string): Promise<number> {
  const text = await fs.readFile(path.join(workDir, "render.log"), "utf8").catch(() => "");
  const m = [...text.matchAll(/"progress": ([0-9.]+)/g)].pop();
  return m ? Number(m[1]) : 0;
}
