// The video robot (docs/VIDEO_ROBOT.md): run by .github/workflows/video-robot.yml every 15 minutes.
//
//   node scripts/video-robot/robot.mjs peek   How many videos wait (no dependencies; writes waiting=N to GITHUB_OUTPUT).
//   node scripts/video-robot/robot.mjs run    Claims pending videos, renders each in headless Google Chrome with the
//                                             browser renderer, uploads it to its reserved URL and confirms it.
//
// Settings (environment): ROBOT_APP_URL (the site), VIDEO_ROBOT_SECRET (bearer), optional ROBOT_CHROME_CHANNEL
// (default "chrome"), ROBOT_CHROME_PATH, ROBOT_FORMAT (auto, mp4 or webm; default auto), ROBOT_CONCURRENCY (1 or 2), ROBOT_MAX_VIDEOS (default 12),
// ROBOT_BUDGET_MS (default 17 minutes), ROBOT_VIDEO_TIMEOUT_MS (default 5 minutes).
// It prints only through log.mjs: event names and counts (the repository and its Actions logs are public).
import { appendFileSync, readFileSync } from "node:fs";
import { createLogger } from "./log.mjs";

const log = createLogger();

const PAGE_ORIGIN = "https://video-robot.invalid";
const FONT_DIR = new URL("../../public/fonts/video/", import.meta.url);
const FONT_FILE = /^\/fonts\/video\/([a-z-]+-latin(?:-ext)?-\d{3}-normal\.woff2)$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** https only; plain http only to this machine (the self-test's fake app). */
export function allowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
}
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 20_000;
const API_TIMEOUT_MS = 55_000;

/** @param {Record<string, string | undefined>} env */
export function settings(env = process.env) {
  const app = (env.ROBOT_APP_URL ?? "").trim().replace(/\/+$/, "");
  const secret = (env.VIDEO_ROBOT_SECRET ?? "").trim();
  const int = (value, fallback, min, max) => {
    const n = Number.parseInt(value ?? "", 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    app,
    secret,
    configured: allowedUrl(app) && secret.length > 0,
    channel: env.ROBOT_CHROME_CHANNEL || "chrome",
    chromePath: env.ROBOT_CHROME_PATH || undefined,
    format: ["mp4", "webm"].includes(env.ROBOT_FORMAT) ? env.ROBOT_FORMAT : "auto",
    concurrency: int(env.ROBOT_CONCURRENCY, 1, 1, 2),
    maxVideos: int(env.ROBOT_MAX_VIDEOS, 12, 1, 40),
    budgetMs: int(env.ROBOT_BUDGET_MS, 17 * 60_000, 60_000, 19 * 60_000),
    videoTimeoutMs: int(env.ROBOT_VIDEO_TIMEOUT_MS, 5 * 60_000, 30_000, 10 * 60_000),
  };
}

class ApiError extends Error {
  constructor(status) {
    super(`status ${status}`);
    this.status = status;
  }
}

/** POST to the robot API. Never prints the URL, the answer or the secret. */
export async function api(config, action, body = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${config.app}/api/robot/videos/${action}`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    log("network_error");
    throw new ApiError(0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !(action === "complete" && response.status === 422)) {
    log("api_error", { call: action, status: response.status });
    throw new ApiError(response.status);
  }
  return data;
}

/**
 * Downloads the scene photos in Node (size and time capped) and hands them to the page as data URLs; failures are
 * skipped. Only from the storage origin of the job's own signed upload URL (Supabase), nowhere else.
 */
export async function photoDataUrls(photoUrls, storageUrl, fetchImpl = fetch) {
  const out = {};
  const origin = allowedUrl(storageUrl) ? new URL(storageUrl).origin : null;
  for (const [key, url] of Object.entries(photoUrls ?? {})) {
    if (!origin || !allowedUrl(url) || new URL(url).origin !== origin) continue;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) continue;
      const type = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
      out[key] = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
      // The scene draws the brand backdrop instead, as in the browser.
    }
  }
  return out;
}

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/**
 * Downloads the voiceover and the music like the photos (same storage origin only, size and time capped) and hands
 * them to the page as data URLs. A missing file means a quieter video, never a failed one.
 */
export async function audioDataUrls(audioUrls, storageUrl, fetchImpl = fetch) {
  const out = {};
  const origin = allowedUrl(storageUrl) ? new URL(storageUrl).origin : null;
  for (const key of ["voice", "music"]) {
    const url = audioUrls?.[key];
    // A voiceover the app could not store arrives as the audio itself (a data URL, size capped).
    if (typeof url === "string" && url.startsWith("data:audio/") && url.length <= MAX_AUDIO_BYTES * 1.4) {
      out[key] = url;
      continue;
    }
    if (!origin || typeof url !== "string" || !allowedUrl(url) || new URL(url).origin !== origin) continue;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) continue;
      const type = (response.headers.get("content-type") ?? "audio/mpeg").split(";")[0].trim();
      if (!type.startsWith("audio/")) continue;
      out[key] = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
      // Without it the video is made without that sound.
    }
  }
  return out;
}

/** PUTs the file to its signed upload URL (the request the Supabase client makes for uploadToSignedUrl). */
async function upload(target, bytes, fetchImpl = fetch) {
  if (!allowedUrl(target.url)) return false;
  try {
    const response = await fetchImpl(target.url, {
      method: "PUT",
      headers: { "content-type": target.contentType, "cache-control": "max-age=3600", "x-upsert": "false" },
      body: bytes,
      signal: AbortSignal.timeout(120_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise.finally(() => clearTimeout(timer)), new Promise((resolve) => (timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), ms)))]);
}

async function openPage(browser, html, script) {
  const page = await browser.newPage();
  // The page reaches nothing but its own in-memory origin: photos arrive as data URLs, fonts from public/fonts/video.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    if (!url.startsWith(`${PAGE_ORIGIN}/`)) return route.abort("blockedbyclient");
    const path = new URL(url).pathname;
    if (path === "/robot.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: script });
    if (path === "/") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    const font = FONT_FILE.exec(path);
    if (font) {
      try {
        return route.fulfill({ status: 200, contentType: "font/woff2", body: readFileSync(new URL(font[1], FONT_DIR)) });
      } catch {
        // Missing file: the fallback font is used.
      }
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${PAGE_ORIGIN}/`);
  await page.waitForFunction(() => !!globalThis.videoRobot);
  return page;
}

/** One claimed video: render, upload, confirm; or tell the app why not. Returns "made" or "failed". */
async function makeOne(config, browser, page, job, format) {
  const photos = await photoDataUrls(job.photoUrls, job.upload?.url);
  const audio = await audioDataUrls(job.audioUrls, job.upload?.url);
  const leaseLeft = new Date(job.leaseUntil).getTime() - Date.now() - 60_000;
  const result = await withTimeout(
    page.evaluate(({ plan, photos, format, audio }) => globalThis.videoRobot.render(plan, photos, format, audio), { plan: job.plan, photos, format, audio }),
    Math.max(10_000, Math.min(config.videoTimeoutMs, leaseLeft)),
  );
  if (!result.ok) {
    await api(config, "fail", { job: job.job, reason: result.reason }).catch(() => {});
    return { outcome: "failed", reason: result.reason, pageBroken: result.reason === "timeout" };
  }
  if (!(await upload(job.upload, Buffer.from(result.base64, "base64")))) {
    await api(config, "fail", { job: job.job, reason: "upload_failed" }).catch(() => {});
    return { outcome: "failed", reason: "upload_failed" };
  }
  const done = await api(config, "complete", { job: job.job }).catch(() => ({ ok: false }));
  if (!done.ok) return { outcome: "failed", reason: "complete_failed" };
  return { outcome: "made" };
}

export async function run(config) {
  const started = Date.now();
  const counts = { claimed: 0, made: 0, failed: 0 };
  // Loaded only for a real run, so "peek" needs nothing installed.
  const { chromium } = await import("playwright-core");
  const { buildPage } = await import("./build-page.mjs");
  const { html, script } = await buildPage();
  const browser = await chromium.launch({ headless: true, ...(config.chromePath ? { executablePath: config.chromePath } : { channel: config.channel }) });
  try {
    log("chrome_ready");
    const probe = await openPage(browser, html, script);
    const supported = await probe.evaluate(() => globalThis.videoRobot.support());
    // WebM can be asked for (MediaRecorder, real time); MP4 only when this Chrome encodes H.264.
    const format = config.format === "webm" && supported ? "webm" : config.format === "mp4" && supported !== "mp4" ? null : supported;
    await probe.close();
    if (!format) {
      log("no_encoder");
      return counts;
    }
    log("encoder", { format });

    while (counts.claimed < config.maxVideos) {
      if (Date.now() - started > config.budgetMs - config.videoTimeoutMs) {
        log("time_up");
        break;
      }
      const max = Math.min(config.concurrency * 2, config.maxVideos - counts.claimed);
      const { jobs = [] } = await api(config, "claim", { max, format });
      if (jobs.length === 0) break;
      counts.claimed += jobs.length;
      log("claimed", { videos: jobs.length });
      const queue = [...jobs];
      const worker = async () => {
        let page = await openPage(browser, html, script);
        for (let job = queue.shift(); job; job = queue.shift()) {
          const r = await makeOne(config, browser, page, job, format).catch(() => ({ outcome: "failed", reason: "render_failed", pageBroken: true }));
          counts[r.outcome] += 1;
          if (r.outcome === "failed") log("failed", { reason: r.reason });
          if (r.pageBroken) {
            await page.close().catch(() => {});
            page = await openPage(browser, html, script);
          }
        }
        await page.close().catch(() => {});
      };
      await Promise.all(Array.from({ length: Math.min(config.concurrency, jobs.length) }, worker));
    }
  } finally {
    await browser.close().catch(() => {});
    await api(config, "report", counts).catch(() => {});
    log("summary", counts);
  }
  return counts;
}

export async function peek(config) {
  const { waiting = 0 } = await api(config, "peek");
  const n = Number.isInteger(waiting) && waiting >= 0 ? waiting : 0;
  log(n > 0 ? "waiting" : "nothing_to_do", n > 0 ? { videos: n } : {});
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `waiting=${n}\n`);
  return n;
}

async function main() {
  const mode = process.argv[2] ?? "run";
  const config = settings();
  if (!config.configured) {
    log("not_configured");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "waiting=0\n");
    return;
  }
  try {
    if (mode === "peek") await peek(config);
    else await run(config);
  } catch {
    log("fatal");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
