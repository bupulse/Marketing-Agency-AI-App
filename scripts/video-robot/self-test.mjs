// Self-test for the video robot (docs/VIDEO_ROBOT.md): runs the real robot against a fake app on 127.0.0.1, with one
// made-up video plan and a photo from public/, and checks the file it uploads (MP4 or WebM header and its real
// length, read by the same lib/visuals/duration.ts the app bills with). No database, no real app, no outside calls
// except the font CDN. Needs Google Chrome (or ROBOT_CHROME_PATH):
//
//   node scripts/video-robot/self-test.mjs
//
// SELF_TEST_CLIP=<an MP4> plays it as an AI clip in the opening scene (lib/visuals/ai-clips.ts, VideoScene.clipPath);
// SELF_TEST_OUT=<file> keeps the video made.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { videoDurationMs } from "../../lib/visuals/duration.ts";
import { run, settings } from "./robot.mjs";

const SECRET = "self-test-secret";
const JOB = "00000000-0000-4000-8000-000000000001";
const plan = {
  version: 1,
  width: 1080,
  height: 1920,
  fps: 30,
  pack: "clean",
  colors: { background: "#101820", text: "#ffffff", accent: "#ff6a00" },
  businessName: "Self-test shop",
  scenes: [
    { text: "A robot made this video", photoPath: "u/gallery/photo.png", durationMs: 4000, motion: "zoom-in", role: "hook" },
    { text: "Same renderer as the browser", photoPath: null, durationMs: 4000, motion: "pan-left", role: "body" },
    { text: "Visit us today", photoPath: "u/gallery/photo.png", durationMs: 3500, motion: "zoom-out", role: "cta" },
  ],
  crossfadeMs: 500,
  totalMs: 10_500,
};

const clip = process.env.SELF_TEST_CLIP ? readFileSync(process.env.SELF_TEST_CLIP) : null;
if (clip) plan.scenes[0].clipPath = "u/aiclips/v-0.mp4";

const state = { claimed: false, uploaded: null, contentType: null, completed: false, failed: null, report: null };
const photo = readFileSync(new URL("../../public/brand/logo-stacked.png", import.meta.url));

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const send = (status, value, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(type === "application/json" ? JSON.stringify(value) : value);
  };
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url === "/photo.png") return send(200, photo, "image/png");
  if (req.url === "/clip.mp4" && clip) return send(200, clip, "video/mp4");
  if (req.method === "PUT" && req.url.startsWith("/upload")) {
    state.uploaded = body;
    state.contentType = req.headers["content-type"];
    return send(200, { Key: "media/x" });
  }
  if (req.headers.authorization !== `Bearer ${SECRET}`) return send(401, { error: "Unauthorized" });
  const input = body.length ? JSON.parse(body.toString()) : {};
  switch (req.url) {
    case "/api/robot/videos/claim": {
      if (state.claimed) return send(200, { jobs: [] });
      state.claimed = true;
      const ext = input.format === "webm" ? "webm" : "mp4";
      return send(200, { jobs: [{ job: JOB, plan, photoUrls: { "u/gallery/photo.png": `${base}/photo.png` }, clipUrls: clip ? { "u/aiclips/v-0.mp4": `${base}/clip.mp4` } : {}, upload: { url: `${base}/upload/x.${ext}?token=t`, contentType: `video/${ext}` }, leaseUntil: new Date(Date.now() + 15 * 60_000).toISOString() }] });
    }
    case "/api/robot/videos/complete":
      state.completed = input.job === JOB && !!state.uploaded;
      return send(state.completed ? 200 : 422, { ok: state.completed, seconds: 11 });
    case "/api/robot/videos/fail":
      state.failed = input.reason;
      return send(200, { ok: true });
    case "/api/robot/videos/report":
      state.report = input;
      return send(200, { ok: true });
    default:
      return send(404, { error: "Not found" });
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const started = Date.now();
try {
  const config = { ...settings({ ...process.env, ROBOT_APP_URL: `http://127.0.0.1:${server.address().port}`, VIDEO_ROBOT_SECRET: SECRET }) };
  await run(config);
} finally {
  server.close();
}

const type = state.contentType === "video/webm" ? "video/webm" : "video/mp4";
const durationMs = state.uploaded ? videoDurationMs(new Uint8Array(state.uploaded), type) : null;
if (state.uploaded && process.env.SELF_TEST_OUT) writeFileSync(process.env.SELF_TEST_OUT, state.uploaded);
const result = { type, bytes: state.uploaded?.length ?? 0, durationMs, completed: state.completed, failed: state.failed, report: state.report, seconds: Math.round((Date.now() - started) / 1000) };
console.log(JSON.stringify(result));
const ok = state.completed && durationMs !== null && Math.abs(durationMs - plan.totalMs) < 600;
console.log(ok ? "Self-test passed." : "Self-test FAILED.");
process.exitCode = ok ? 0 : 1;
