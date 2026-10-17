// Video Studio: premium 3D clips rendered by Blender on this Mac (docs/BLENDER.md). Claude writes a scene
// (tools/blender/scene.ts, BLENDER_SCENE_FORMAT); this runs headless Blender (Eevee) on it and returns the MP4.
// One render at a time: the M1's GPU is shared, and two Eevee renders at once are slower than one after the other.
// Free: Blender is free and runs locally. The server wires this in (it is not called by anything yet).
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BLENDER_APP, blenderCommand, checkSoundPath, normalizeBlenderScene, parseBlenderProgress, type BlenderScene, type NormalizeOptions } from "@/tools/blender/scene";

/** How long one render may take (30 minutes: a busy Mac renders slowly; BLENDER_TIMEOUT_MS overrides it). */
export const BLENDER_TIMEOUT_MS = Number(process.env.BLENDER_TIMEOUT_MS) || 30 * 60_000;

/** The Blender program: BLENDER_BIN, else the app in /Applications. */
export const blenderBin = () => process.env.BLENDER_BIN || BLENDER_APP;

let available: Promise<boolean> | null = null;

/** Whether Blender is installed and starts (checked once per process: `Blender --version`, at most 30 s). */
export function blenderAvailable(): Promise<boolean> {
  available ??= (async () => {
    try {
      await fs.access(blenderBin(), fs.constants.X_OK);
    } catch {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const child = spawn(blenderBin(), ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.stdout.on("data", (d) => (out += d));
      child.on("error", () => resolve(false));
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0 && out.includes("Blender"));
      });
    });
  })();
  return available;
}

/** Forget the cached answer (tests, or after installing Blender while the server runs). */
export function resetBlenderAvailable(): void {
  available = null;
}

export type BlenderRenderOptions = NormalizeOptions & {
  /** Called with 0 to 1 as frames finish. */
  onProgress?: (fraction: number) => void;
  /** Render PNG stills at these clip fractions (0 to 1) into `outPath`'s folder instead of the MP4. */
  stills?: number[];
  /** 480p and 8 samples: a quick look. */
  preview?: boolean;
  timeoutMs?: number;
  /** The repository folder (render.py, fonts, relative image paths). Default: the current folder. */
  repoDir?: string;
  /**
   * The voice-over (MP3, WAV, M4A, AAC, OGG or FLAC) mixed into the MP4 as AAC, from the scene's `sound.voiceAt`
   * (default 0.3 s), trimmed to the clip. Must be a file the server put in `jobDir`.
   */
  audio?: string;
  /** A music bed, low under the voice (0.18; 0.7 alone), faded out over the last half second. Also inside `jobDir`. */
  music?: string;
  /** Overrides for the scene's `sound.voiceAt` (seconds) and the music volume (0 to 1). */
  voiceAt?: number;
  musicVolume?: number;
  /** The job's own folder: `audio` and `music` must be inside it. Default: the folder of `outPath`. */
  jobDir?: string;
};

export type BlenderRenderResult = {
  /** The MP4 (or, for stills, the folder holding still-NNN.png). */
  path: string;
  bytes: number;
  seconds: number;
  /** The log of Blender's output, next to the MP4. */
  log: string;
  warnings: string[];
  scene: BlenderScene;
};

let queue: Promise<unknown> = Promise.resolve();

/**
 * Renders a scene (checked and completed first, see normalizeBlenderScene) to `outPath` (an .mp4). Pass the same
 * `photos` the scene was designed with: the product is found by its photo number. Writes the scene
 * next to it (`.scene.json`) and Blender's output to `.log`, and stops Blender after BLENDER_TIMEOUT_MS (30 minutes). Renders wait for each
 * other. Rejects with a plain-English message when Blender is missing, fails or times out.
 */
export function renderBlenderScene(input: unknown, outPath: string, opts: BlenderRenderOptions = {}): Promise<BlenderRenderResult> {
  const run = queue.then(() => renderNow(input, outPath, opts));
  queue = run.catch(() => undefined);
  return run;
}

async function renderNow(input: unknown, outPath: string, opts: BlenderRenderOptions): Promise<BlenderRenderResult> {
  if (!(await blenderAvailable())) throw new Error(`Blender is not installed (looked for ${blenderBin()}). Install it from blender.org or set BLENDER_BIN.`);
  const { scene, warnings } = normalizeBlenderScene(input, opts);
  // A scene from designBlenderScene names its photo by number: render it with the same photo list it was designed with.
  const asked = (input as { product?: unknown } | null)?.product;
  if (asked && !scene.product) throw new Error(`The 3D scene's product photo is missing (${warnings.join(" ") || "no photo list given"}).`);
  const out = path.resolve(outPath);
  // Sound files are checked before anything is written or started.
  const sound = await soundFiles(opts, out);
  const base = out.replace(/\.mp4$/i, "");
  const scenePath = `${base}.scene.json`;
  const logPath = `${base}.log`;
  const stillsDir = opts.stills?.length ? `${base}-stills` : undefined;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(scenePath, JSON.stringify(scene, null, 2));

  const { bin, args } = blenderCommand({ scenePath, outPath: out, repoDir: path.resolve(opts.repoDir ?? "."), bin: blenderBin(), stills: opts.stills, stillsDir, preview: opts.preview, ...sound, voiceAt: opts.voiceAt, musicVolume: opts.musicVolume });
  const started = Date.now();
  const log = createWriteStream(logPath);
  const lastError = await new Promise<string | null>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let error: string | null = null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? BLENDER_TIMEOUT_MS);
    const onLines = (chunk: Buffer) => {
      log.write(chunk);
      for (const line of chunk.toString().split("\n")) {
        const p = parseBlenderProgress(line);
        if (p !== null) opts.onProgress?.(p);
        const e = /BLENDER_ERROR (.*)/.exec(line);
        if (e) error = e[1].trim();
      }
    };
    child.stdout.on("data", onLines);
    child.stderr.on("data", onLines);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Blender did not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`The 3D render took longer than ${Math.round((opts.timeoutMs ?? BLENDER_TIMEOUT_MS) / 60_000)} minutes and was stopped.`));
      else if (code !== 0) reject(new Error(`The 3D render failed${error ? `: ${error}` : ` (Blender exit code ${code})`}. See ${logPath}.`));
      else resolve(error);
    });
  }).finally(() => new Promise<void>((resolve) => log.end(resolve)));
  if (lastError) warnings.push(lastError);

  const seconds = Math.round((Date.now() - started) / 100) / 10;
  if (stillsDir) return { path: stillsDir, bytes: 0, seconds, log: logPath, warnings, scene };
  const stat = await fs.stat(out).catch(() => null);
  if (!stat?.size) throw new Error(`Blender finished but wrote no video. See ${logPath}.`);
  return { path: out, bytes: stat.size, seconds, log: logPath, warnings, scene };
}

/**
 * The voice and music files for Blender, checked: inside the job's folder (links resolved, so a link cannot point
 * outside it), with a sound extension, and existing files. Never paths from the browser or from Claude.
 */
async function soundFiles(opts: BlenderRenderOptions, out: string): Promise<{ audio?: string; music?: string }> {
  if (!opts.audio && !opts.music) return {};
  const dir = path.resolve(opts.jobDir ?? path.dirname(out));
  const realDir = await fs.realpath(dir).catch(() => {
    throw new Error("The job's folder for the sound does not exist.");
  });
  const one = async (file: string | undefined, what: string) => {
    if (!file) return undefined;
    checkSoundPath(path.resolve(file), dir);
    const real = await fs.realpath(path.resolve(file)).catch(() => {
      throw new Error(`The ${what} file does not exist.`);
    });
    const checked = checkSoundPath(real, realDir);
    if (!(await fs.stat(checked)).isFile()) throw new Error(`The ${what} is not a file.`);
    return checked;
  };
  return { audio: await one(opts.audio, "voice-over"), music: await one(opts.music, "music") };
}
