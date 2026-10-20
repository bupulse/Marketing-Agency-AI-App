// Seedance readiness check (docs/VIDEO_ENGINE.md, "Going live with Seedance"): is the BytePlus key in, does it work?
// Run: node --env-file=.env scripts/video-lab/seedance-check.mjs              (free: lists one task)
//      node --env-file=.env scripts/video-lab/seedance-check.mjs --make-clip  (the first real clip: Mini, 480p, 4 s,
//                                                                             text only, about $0.14 of BytePlus credit)
//      node scripts/video-lab/seedance-check.mjs --dry [--image photo.jpg] [--cutout product.png] [--audio song.mp3]
//                                     (free, no key needed: prints the exact request body that would be sent, with
//                                     each image, cut-out or audio file summarised by its format and size, not its bytes)
// The clip is saved in video-lab/data/seedance/videos/ and its real cost is written to the lab ledger.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const makeClip = process.argv.includes("--make-clip");
const dry = process.argv.includes("--dry");
/** Every value given after `flag` (repeatable). */
const values = (flag) => process.argv.flatMap((a, i) => (a === flag && process.argv[i + 1] ? [process.argv[i + 1]] : []));

// The engine is TypeScript: bundle the pieces we need next to node_modules (sharp and mp4box are packages), load them,
// remove the bundle.
const out = path.join(root, "video-lab/data/.seedance-check-bundle.mjs");
await fs.mkdir(path.dirname(out), { recursive: true });
await build({
  stdin: {
    contents: [
      'export * from "./lib/video-engine/seedance";',
      'export { planSeedanceShots, checkSeedanceRequest } from "./lib/video-engine/seedance-brain";',
      'export { record, spentToday, DAILY_CAP_USD } from "./video-lab/store";',
      'export { prepareSeedanceReferences, summariseBody } from "./video-lab/seedance-references";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  absWorkingDir: root,
  tsconfig: "tsconfig.json",
  bundle: true,
  outfile: out,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});
const sd = await import(pathToFileURL(out).href);
await fs.rm(out, { force: true });

const say = (s = "") => console.log(s);

/** The test clip's request: Mini, 480p, 4 s, 9:16, sound; with --dry, plus any local files given. */
async function testRequest() {
  const plan = sd.planSeedanceShots({
    business: { name: "BuPulse", language: "English", country: "Rwanda" },
    product: { name: "white ceramic coffee mug" },
    templateId: "any-product-hero",
    businessKind: "shop",
    seconds: 4,
    ratio: "9:16",
    audio: true,
  });
  const sources = [];
  for (const f of values("--image")) sources.push({ kind: "image", type: "photo", bytes: await fs.readFile(f), label: path.basename(f) });
  for (const f of values("--cutout")) sources.push({ kind: "image", type: "cutout", bytes: await fs.readFile(f), label: `${path.basename(f)} (cut-out)` });
  for (const f of values("--audio")) sources.push({ kind: "audio", bytes: await fs.readFile(f), mimeType: f.endsWith(".wav") ? "audio/wav" : "audio/mpeg", label: path.basename(f) });
  const prepared = await sd.prepareSeedanceReferences(sources);
  const prompt = prepared.notes.length ? `${plan.prompt}\nReferences: ${prepared.notes.join("; ")}.` : plan.prompt;
  return { plan, prepared, request: { tier: "mini", prompt, references: prepared.references, ratio: "9:16", seconds: 4, resolution: "480p", audio: true, fixedLens: false, seed: null } };
}

if (dry) {
  const { prepared, request } = await testRequest();
  say("BuPulse Video Studio: Seedance dry run (nothing is sent, nothing is paid)");
  say(`POST ${process.env.SEEDANCE_BASE_URL || sd.SEEDANCE_BASE_URL}/contents/generations/tasks`);
  say(JSON.stringify(sd.summariseBody(sd.seedanceBody(request), prepared.summary), null, 2));
  for (const r of prepared.summary) say(`${r.name}: ${r.label} - ${r.how}${r.format ? `, ${r.format}` : ""}${r.width ? `, ${r.width}×${r.height}` : ""}${r.bytes ? `, ${Math.round(r.bytes / 1024)} KB` : ""}${r.changes.length ? ` (${r.changes.join("; ")})` : ""}`);
  for (const p of prepared.problems) say(`Left out: ${p}`);
  const check = sd.checkSeedanceRequest(request, { referenceNotes: prepared.notes });
  for (const i of check.issues) say(`${i.level === "error" ? "Problem" : i.level === "warning" ? "Note" : "Info"}: ${i.message}`);
  say(`Estimated cost: $${check.estimateUsd.toFixed(2)}${check.ok ? "" : " (BytePlus would refuse this request as it is)"}`);
  process.exit(check.ok ? 0 : 1);
}

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
const { request } = await testRequest();
const check = sd.checkSeedanceRequest(request);
for (const i of check.issues.filter((x) => x.level !== "info")) say(`${i.level === "error" ? "Problem" : "Note"}: ${i.message}`);
if (!check.ok) process.exit(1);
const spent = await sd.spentToday();
if (spent + check.estimateUsd > sd.DAILY_CAP_USD) {
  say(`Today's lab spending is $${spent.toFixed(2)} of the $${sd.DAILY_CAP_USD} daily cap; the test clip waits for tomorrow.`);
  process.exit(1);
}
say(`\nMaking a test clip: Seedance 2.0 Mini, 480p, 4 s, 9:16, with sound, ${request.references.length ? `${request.references.length} reference(s)` : "text only"}. Estimated $${check.estimateUsd.toFixed(2)}.`);
say(`Prompt:\n${request.prompt}\n`);

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
