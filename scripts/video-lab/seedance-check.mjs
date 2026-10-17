// Seedance readiness check (docs/VIDEO_ENGINE.md, "Going live with Seedance"): is the BytePlus key in, does it work?
// Run: node --env-file=.env scripts/video-lab/seedance-check.mjs              (free: lists one task)
//      node --env-file=.env scripts/video-lab/seedance-check.mjs --make-clip  (the first real clip: Mini, 480p, 4 s,
//                                                                             text only, about $0.14 of BytePlus credit)
// The clip is saved in video-lab/data/seedance/videos/ and its real cost is written to the lab ledger.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const makeClip = process.argv.includes("--make-clip");

// The engine is TypeScript: bundle the pieces we need in memory and load them (no files written).
const bundled = await build({
  stdin: {
    contents: [
      'export * from "./lib/video-engine/seedance";',
      'export { planSeedanceShots, checkSeedanceRequest } from "./lib/video-engine/seedance-brain";',
      'export { record, spentToday, DAILY_CAP_USD } from "./video-lab/store";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  absWorkingDir: root,
  tsconfig: "tsconfig.json",
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});
const sd = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const say = (s = "") => console.log(s);
say("BuPulse Video Studio: Seedance check");
say(`Address: ${process.env.SEEDANCE_BASE_URL || sd.SEEDANCE_BASE_URL}`);
const conn = await sd.checkSeedanceConnection();
say(`Result:  ${conn.state}`);
say(`         ${conn.message}`);
if (conn.state !== "connected") process.exit(1);
if (!makeClip) {
  say("\nThe key works. To make the first real clip (about $0.14), run again with --make-clip.");
  process.exit(0);
}

// ---- The first real clip
const plan = sd.planSeedanceShots({
  business: { name: "BuPulse", language: "English", country: "Rwanda" },
  product: { name: "white ceramic coffee mug" },
  templateId: "any-product-hero",
  seconds: 4,
  ratio: "9:16",
  audio: true,
});
const request = { tier: "mini", prompt: plan.prompt, references: [], ratio: "9:16", seconds: 4, resolution: "480p", audio: true, fixedLens: false, seed: null };
const check = sd.checkSeedanceRequest(request);
for (const i of check.issues.filter((x) => x.level !== "info")) say(`${i.level === "error" ? "Problem" : "Note"}: ${i.message}`);
if (!check.ok) process.exit(1);
const spent = await sd.spentToday();
if (spent + check.estimateUsd > sd.DAILY_CAP_USD) {
  say(`Today's lab spending is $${spent.toFixed(2)} of the $${sd.DAILY_CAP_USD} daily cap; the test clip waits for tomorrow.`);
  process.exit(1);
}
say(`\nMaking a test clip: Seedance 2.0 Mini, 480p, 4 s, 9:16, with sound, text only. Estimated $${check.estimateUsd.toFixed(2)}.`);
say(`Prompt:\n${plan.prompt}\n`);

const opts = { apiKey: process.env.SEEDANCE_API_KEY.trim(), baseUrl: process.env.SEEDANCE_BASE_URL || sd.SEEDANCE_BASE_URL };
let taskId;
try {
  taskId = await sd.createSeedanceTask(request, opts);
} catch (e) {
  say(`BytePlus refused the clip: ${e.message}`);
  process.exit(1);
}
say(`Task ${taskId} created. Checking every 10 s (usually 1 to 4 minutes). Ctrl+C cancels it while it is queued.`);
process.on("SIGINT", async () => {
  await sd.cancelSeedanceTask(taskId, opts).catch(() => undefined);
  say("\nCancelled.");
  process.exit(130);
});

const started = Date.now();
let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, 10_000));
  let task;
  try {
    task = await sd.getSeedanceTask(taskId, opts);
  } catch (e) {
    say(`(status check failed: ${e.message}; trying again)`);
    continue;
  }
  if (task.status !== last) say(`${Math.round((Date.now() - started) / 1000)} s: ${task.status}`);
  last = task.status;
  if (task.status === "succeeded" && task.videoUrl) {
    await sd.record(`seedance-check-${taskId}`, "seedance-check", [sd.seedanceUsage("mini", task.tokens)]);
    if (!/^https:\/\/[a-z0-9.-]+\.(bytepluses|volces|byteplus)\.com\//i.test(task.videoUrl)) {
      say("The video link is not on a BytePlus address, so it was not downloaded.");
      process.exit(1);
    }
    const res = await fetch(task.videoUrl, { signal: AbortSignal.timeout(120_000) });
    const dir = path.resolve("video-lab/data/seedance/videos");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `check-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mp4`);
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    say(`\nSeedance works. ${task.tokens.toLocaleString("en")} tokens, real cost $${task.costUsd.toFixed(3)} (written to the lab ledger).`);
    say(`Saved: ${path.relative(root, file)}`);
    say("Restart `npm run lab`: the studio now sends real Seedance jobs instead of previews.");
    process.exit(0);
  }
  if (task.status === "failed" || task.status === "expired") {
    say(`Seedance could not make the clip: ${task.error}`);
    say("BytePlus bills only finished videos, so nothing was spent.");
    process.exit(1);
  }
  if (Date.now() - started > 15 * 60_000) {
    say(`Still not ready after 15 minutes. The task (${taskId}) keeps going at BytePlus; check it in the ModelArk console.`);
    process.exit(1);
  }
}
