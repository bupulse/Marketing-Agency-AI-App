// The Ad Brain's pipeline (docs/AD_BRAIN.md, section 3): one AdJob moves a step at a time,
//   queued -> understanding -> concept -> script -> assets -> rendering -> judging -> delivering -> ready
// (a fixture job goes straight to rendering with a cached plan). The video-jobs cron and Admin -> Ad Brain run
// sweepAdJobs: it leases a job, does steps until one has to wait (an Omni clip being made, a render running) or its
// time is up, and lets go. Every paid call is checked against the limits first ($3 an ad, $30 a month by default) and
// recorded in the AI ledger (feature "adBrain"). Failures retry a few times, then stop with a plain-English reason.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { getSetting } from "@/lib/admin/settings";
import { loadServiceKeys } from "@/lib/admin/service-keys";
import { recordAiCall, withLedger, type LedgerContext } from "@/lib/ai/ledger";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { kigaliMonthStart } from "@/lib/time/kigali";
import { getVeoOperation, submitVeo, veoClipBytes, veoModel, VeoError } from "@/lib/video-engine/veo";
import { brainModel, briefRequest, brandBriefSchema, conceptAnswerSchema, conceptFrom, conceptRequest, scriptRequest, scriptSchema, think, type BrandBrief } from "./brain";
import { AD_BRAIN_FEATURE, checkSpend, clipCost, DEFAULT_AD_LIMITS, planFits, UNIT_USD, usd, type AdLimits } from "./budget";
import { deliverAd, saveAdToGallery, type GalleryVideo } from "./deliver";
import { validateEdl, type Edl } from "./edl";
import { pickEffects, seededRandom } from "./effects";
import { BUPULSE_BRAND, companyAccount, fixtureWords, loadFacts } from "./facts";
import { isFixtureName, FIXTURES } from "./fixtures";
import { combineJudgements, decideFix, hardRuleFailures, JUDGE_LOOKS, judgePrompt, judgeSchema, lowerMusic, type JudgeAnswer } from "./judge";
import { assetNeeds, buildEdl, needsCost, type AssetNeed, type Concept, type MadeAsset } from "./plan";
import { askAboutMedia, makeImage, makeMusic, makeSpeech, MODELS, ProviderError, wordTimings } from "./providers";
import { pickRecipe, recipeById, recipeEffects } from "./recipes";
import { analyzeMusic, jobDir, judgeCopy, probeSeconds, readRenderResult, startRender } from "./render";
import { refreshScreensIfStale } from "./screens";
import { checkScript, type Script } from "./script-rules";
import { assetHash, downloadFile, findAsset, localFile, saveAsset, uploadFile } from "./store";

export const TERMINAL = ["ready", "failed", "stopped", "cancelled"] as const;
/** How long one sweep holds a job. */
export const LEASE_MS = 4 * 60_000;
/** A step that fails this many times stops the ad. */
export const MAX_ATTEMPTS = 4;
/** An Omni clip not back after this long is given up (Google's worst case is about 6 minutes). */
export const CLIP_TIMEOUT_MS = 15 * 60_000;
/** A render with no result after this long is started again (once the server restarted, its process is gone). */
export const RENDER_STALE_MS = 20 * 60_000;
/** Paid calls in flight at once (frames, music, voices, clip submits). */
const PARALLEL = 4;

type ClipWork = { operation: string; submittedAt: number; hash: string; seconds: number; speech: string | null; tries: number };
type Made = MadeAsset & { hash: string };
type Work = { made: Record<string, Made>; clips: Record<string, ClipWork>; render?: { startedAt: number; out: string; version: number; stored?: string }; planChecked?: boolean; tries?: Record<string, number>; gallery?: GalleryVideo & { version: number } };

type Job = Awaited<ReturnType<typeof loadJob>>;
const loadJob = (id: string) => prisma.adJob.findUniqueOrThrow({ where: { id } });

class StopError extends Error {}

const readWork = (job: Job): Work => {
  const w = (job.pending ?? {}) as Partial<Work>;
  return { made: w.made ?? {}, clips: w.clips ?? {}, render: w.render, planChecked: w.planChecked, tries: w.tries ?? {}, gallery: w.gallery };
};
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function save(id: string, data: Prisma.AdJobUpdateInput, note?: { step: string; note: string }) {
  if (note) {
    const row = await prisma.adJob.findUnique({ where: { id }, select: { log: true } });
    const log = [...((row?.log ?? []) as unknown[]), { at: new Date().toISOString(), ...note }].slice(-80);
    data.log = json(log);
  }
  await prisma.adJob.update({ where: { id }, data });
}

/** The limits from Admin -> Settings (the spec's $3 and $30 until changed there). */
export async function adLimits(): Promise<AdLimits> {
  const [perAdUsd, monthlyUsd] = await Promise.all([getSetting("adBrainPerAdUsd").catch(() => DEFAULT_AD_LIMITS.perAdUsd), getSetting("adBrainMonthlyUsd").catch(() => DEFAULT_AD_LIMITS.monthlyUsd)]);
  return { perAdUsd, monthlyUsd };
}

/** What the Ad Brain's calls cost this month (Kigali calendar, like the AI budget), from the ledger. */
export async function monthSpentUsd(now = new Date()): Promise<number> {
  const { _sum } = await prisma.aiCall.aggregate({ where: { feature: AD_BRAIN_FEATURE, createdAt: { gte: kigaliMonthStart(now) } }, _sum: { costUsd: true } });
  return Number(_sum.costUsd ?? 0);
}

/** Stops the ad when the next paid step would pass a limit. */
async function allow(job: { id: string }, what: string, nextUsd: number): Promise<void> {
  const [row, month, limits] = await Promise.all([prisma.adJob.findUniqueOrThrow({ where: { id: job.id }, select: { costUsd: true } }), monthSpentUsd(), adLimits()]);
  const check = checkSpend({ adSpentUsd: Number(row.costUsd), monthSpentUsd: month, nextUsd, limits, what });
  if (!check.ok) throw new StopError(check.message);
}

const addCost = (id: string, usdAmount: number) => (usdAmount > 0 ? prisma.adJob.update({ where: { id }, data: { costUsd: { increment: usdAmount } } }) : Promise.resolve(null));

// ---- Sweep ----------------------------------------------------------------------------------------------------------

/**
 * Moves every open ad on as far as it can within `budgetMs`. `stopAt`: never step an ad that has reached this status
 * (e.g. "assets", to plan an ad without paying for any picture or clip). Never throws.
 */
export async function sweepAdJobs(opts: { budgetMs?: number; onlyId?: string; stopAt?: string } = {}): Promise<{ jobs: number; steps: number; states: Record<string, string> }> {
  const deadline = Date.now() + (opts.budgetMs ?? 90_000);
  await loadServiceKeys().catch(() => undefined);
  const now = new Date();
  const open = await prisma.adJob.findMany({
    where: { status: { notIn: [...TERMINAL] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }], ...(opts.onlyId ? { id: opts.onlyId } : {}) },
    orderBy: { createdAt: "asc" },
    take: 3,
    select: { id: true, leaseUntil: true },
  });
  let steps = 0;
  const states: Record<string, string> = {};
  for (const j of open) {
    // Compare-and-set: two sweeps never work on the same ad.
    const { count } = await prisma.adJob.updateMany({ where: { id: j.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } });
    if (count === 0) continue;
    try {
      while (Date.now() < deadline) {
        if (opts.stopAt && (await prisma.adJob.findUnique({ where: { id: j.id }, select: { status: true } }))?.status === opts.stopAt) break;
        const r = await stepOnce(j.id);
        steps += 1;
        if (r === "wait") break;
      }
    } finally {
      const after = await prisma.adJob.update({ where: { id: j.id }, data: { leaseUntil: null }, select: { status: true } }).catch(() => null);
      states[j.id] = after?.status ?? "?";
    }
  }
  return { jobs: open.length, steps, states };
}

/** One step of one ad. "wait": nothing more can happen now. */
export async function stepOnce(id: string): Promise<"next" | "wait"> {
  const job = await loadJob(id);
  if ((TERMINAL as readonly string[]).includes(job.status)) return "wait";
  try {
    const r = await step(job);
    if (job.attempts > 0) await prisma.adJob.update({ where: { id }, data: { attempts: 0 } });
    return r;
  } catch (error) {
    // A paid answer that could not be used (bad JSON, wrong shape) still cost money: it counts toward the ad's limit.
    const spent = Number((error as { costUsd?: number } | null)?.costUsd ?? 0);
    if (spent > 0) await addCost(id, spent);
    if (error instanceof StopError) {
      await save(id, { status: "stopped", error: error.message }, { step: job.status, note: error.message });
      return "wait";
    }
    const message = error instanceof Error ? error.message.slice(0, 400) : "Something went wrong.";
    await logError(error, { source: `adBrain.${job.status}`, level: "warn" }).catch(() => undefined);
    const attempts = job.attempts + 1;
    const giveUp = attempts >= MAX_ATTEMPTS;
    await save(id, giveUp ? { status: "failed", attempts, error: `${message} (tried ${attempts} times)` } : { attempts }, { step: job.status, note: giveUp ? `Stopped: ${message}` : `Will try again: ${message}` });
    return "wait";
  }
}

async function step(job: Job): Promise<"next" | "wait"> {
  const account = await companyAccount();
  const ctx: LedgerContext = { userId: account.userId, businessId: job.businessId, feature: AD_BRAIN_FEATURE };
  switch (job.status) {
    case "queued":
      return job.mode.startsWith("fixture:") ? startFixture(job) : (await save(job.id, { status: "understanding" }, { step: "queued", note: "Started." }), "next");
    case "understanding":
      return understand(job, ctx);
    case "concept":
      return concept(job, ctx);
    case "script":
      return writeScript(job, ctx);
    case "assets":
      return assets(job, ctx);
    case "rendering":
      return render(job);
    case "judging":
      return judge(job, ctx);
    case "delivering":
      return deliver(job, account);
    default:
      throw new Error(`Unknown step "${job.status}".`);
  }
}

// ---- Thinking steps -------------------------------------------------------------------------------------------------

async function recentJobs(businessId: string, excludeId: string) {
  return prisma.adJob.findMany({ where: { businessId, id: { not: excludeId }, concept: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, take: 8, select: { concept: true, brandBrief: true } });
}

async function understand(job: Job, ctx: LedgerContext): Promise<"next"> {
  await allow(job, "the brand brief", UNIT_USD.think);
  // Real screens no older than 24 hours before the brain picks them (free: the server's own headless Chrome).
  const screens = await refreshScreensIfStale();
  if (screens) await save(job.id, {}, { step: "understanding", note: screens.note });
  const facts = await loadFacts(job.businessId);
  const recent = await recentJobs(job.businessId, job.id);
  const brief = (job.brief ?? {}) as { notes?: string };
  const t = await think(ctx, brainModel(), briefRequest({ facts: facts.text, recentPosts: facts.recentPosts, notes: brief.notes ?? "", recentGoals: recent.map((r) => (r.brandBrief as BrandBrief | null)?.goal ?? "").filter(Boolean) }), brandBriefSchema);
  await addCost(job.id, t.costUsd);
  await save(job.id, { brandBrief: json(t.value), status: "concept" }, { step: "understanding", note: `Brief: ${t.value.oneLiner} (goal ${t.value.goal}).` });
  return "next";
}

async function concept(job: Job, ctx: LedgerContext): Promise<"next"> {
  await allow(job, "the concept", UNIT_USD.think);
  const recent = await recentJobs(job.businessId, job.id);
  const concepts = recent.map((r) => r.concept as Concept | null).filter((c): c is Concept => !!c);
  const rng = seededRandom(job.id);
  let recipe = pickRecipe({ recent: concepts.map((c) => c.recipe), rng });
  let effects: string[];
  try {
    effects = pickEffects({ allowed: recipeEffects(recipe), required: recipe.required, recent: concepts.map((c) => c.effects), rng });
  } catch {
    // This format has no new look left: another one.
    recipe = pickRecipe({ recent: [recipe.id, ...concepts.map((c) => c.recipe)], rng });
    effects = pickEffects({ allowed: recipeEffects(recipe), required: recipe.required, recent: concepts.map((c) => c.effects), rng });
  }
  const t = await think(ctx, brainModel(), conceptRequest({ brief: job.brandBrief as BrandBrief, recipe, effects }), conceptAnswerSchema);
  await addCost(job.id, t.costUsd);
  const c = conceptFrom(t.value, recipe, effects);
  await save(job.id, { concept: json(c), status: "script" }, { step: "concept", note: `${recipe.name}, effects ${effects.join(", ")}: ${c.line}` });
  return "next";
}

async function writeScript(job: Job, ctx: LedgerContext): Promise<"next"> {
  const c = job.concept as Concept;
  const recipe = recipeById(c.recipe);
  if (!recipe) throw new Error(`Unknown format "${c.recipe}".`);
  const facts = await loadFacts(job.businessId);
  const brief = job.brandBrief as BrandBrief;
  const rules = { brandName: "BuPulse", url: BUPULSE_BRAND.url, facts: `${facts.text}\n${brief.claims.map((x) => x.claim).join("\n")}`, beats: recipe.beats.map((b) => ({ id: b.id, speech: b.speech, titleWords: b.titleWords, screens: b.screens })), screenIds: facts.screens.map((s) => s.id) };
  if (facts.screens.length < 3) throw new StopError("There are fewer than 3 real screen captures with real data to show (Admin -> Ad Brain, \"Capture the screens now\"). Ads only show real screens, and never an empty page.");
  let problems: string[] = [];
  for (let round = 0; round < 2; round++) {
    await allow(job, "the script", UNIT_USD.think * 2);
    const t = await think(ctx, brainModel(), scriptRequest({ brief, recipe, concept: c, screens: facts.screens, facts: facts.text, problems }), scriptSchema);
    await addCost(job.id, t.costUsd);
    problems = checkScript(t.value, rules);
    if (!problems.length) {
      await save(job.id, { script: json(t.value), status: "assets", caption: t.value.caption, hashtags: t.value.hashtags.slice(0, 10) }, { step: "script", note: `Script written${round ? " (second try)" : ""}. Call to action: "${t.value.cta.text}"` });
      return "next";
    }
    await save(job.id, { script: json(t.value) }, { step: "script", note: `The script broke ${problems.length} rule(s); asking again: ${problems.slice(0, 3).join(" ")}` });
  }
  throw new StopError(`The script kept breaking the rules: ${problems.slice(0, 4).join(" ")}`);
}

// ---- Assets ---------------------------------------------------------------------------------------------------------

const depOf = (n: AssetNeed) => (n.kind === "frame" || n.kind === "clip" ? n.from : null);

function hashOf(n: AssetNeed, made: Record<string, Made>): string {
  const from = depOf(n);
  if (n.kind === "frame") return assetHash({ kind: "frame", model: MODELS.image(), prompt: n.prompt, from: from ? made[from]?.hash : null });
  if (n.kind === "clip") return assetHash({ kind: "clip", model: veoModel(), prompt: n.prompt, from: made[n.from]?.hash });
  if (n.kind === "music") return assetHash({ kind: "music", model: MODELS.music(), prompt: n.prompt });
  return assetHash({ kind: "voice", model: MODELS.tts(), text: n.text, voice: n.voiceName });
}

const kindOf = (n: AssetNeed): MadeAsset["kind"] => (n.kind === "frame" ? "image" : n.kind === "clip" ? "video" : "audio");

function madeFrom(n: AssetNeed, a: { id: string; hash: string; seconds: number | null; meta: Record<string, unknown> }): Made {
  const m = a.meta as { words?: MadeAsset["words"]; bpm?: number; firstBeat?: number };
  return { key: n.key, ref: `ad:${a.id}`, kind: kindOf(n), hash: a.hash, ...(a.seconds ? { seconds: a.seconds } : {}), ...(m.words ? { words: m.words } : {}), ...(m.bpm ? { bpm: m.bpm } : {}), ...(m.firstBeat !== undefined ? { firstBeat: m.firstBeat } : {}) };
}

async function bytesOf(made: Made): Promise<{ bytes: Buffer; mimeType: string }> {
  const row = await prisma.adAsset.findUniqueOrThrow({ where: { id: made.ref.slice(3) }, select: { path: true, mimeType: true } });
  return { bytes: await downloadFile(row.path), mimeType: row.mimeType };
}

const ledgerImage = (r: { model: string; usage: { inputTokens: number; outputTokens: number } }) => ({ provider: "gemini", model: r.model, usage: r.usage, images: 1 });

/** Makes (or reuses) one asset that needs no waiting: a frame, a track, a voice line. Submits a clip. */
async function makeNeed(job: Job, ctx: LedgerContext, n: AssetNeed, work: Work, hash: string): Promise<void> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (n.kind === "frame") {
    await allow(job, `the picture ${n.key}`, UNIT_USD.frame);
    const reference = n.from ? await bytesOf(work.made[n.from]) : null;
    const r = await withLedger(ctx, { provider: "gemini", model: MODELS.image() }, () => makeImage(key, { prompt: n.prompt, reference }), ledgerImage);
    const cost = estimateCostUsd(r.model, { ...r.usage, images: 1 });
    await addCost(job.id, cost);
    const a = await saveAsset({ hash, jobId: job.id, kind: "frame", provider: "gemini", model: r.model, bytes: r.bytes, mimeType: r.mimeType, costUsd: cost, meta: { prompt: n.prompt.slice(0, 2000) } });
    work.made[n.key] = madeFrom(n, a);
    return;
  }
  if (n.kind === "music") {
    await allow(job, `the music (${n.role})`, UNIT_USD.music);
    const r = await withLedger(ctx, { provider: "gemini", model: MODELS.music() }, () => makeMusic(key, n.prompt), ledgerImage);
    const cost = estimateCostUsd(r.model, { ...r.usage, images: 1 });
    await addCost(job.id, cost);
    const dir = jobDir(job.id);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(/*turbopackIgnore: true*/ dir, `${n.key.replace(/\W/g, "_")}.${r.mimeType === "audio/wav" ? "wav" : "mp3"}`);
    await fs.writeFile(file, r.bytes);
    const info = await analyzeMusic(file);
    const a = await saveAsset({ hash, jobId: job.id, kind: "music", provider: "gemini", model: r.model, bytes: r.bytes, mimeType: r.mimeType, seconds: info?.seconds ?? null, costUsd: cost, meta: { prompt: n.prompt, bpm: info?.bpm, firstBeat: info?.firstBeat } });
    work.made[n.key] = madeFrom(n, a);
    return;
  }
  if (n.kind === "voice") {
    await allow(job, `the voice line ${n.key}`, UNIT_USD.voice + UNIT_USD.words);
    const r = await withLedger(ctx, { provider: "gemini", model: MODELS.tts() }, () => makeSpeech(key, { text: n.text, voice: n.voiceName }), (x) => ({ provider: "gemini", model: x.model, usage: x.usage }));
    const cost = estimateCostUsd(r.model, r.usage);
    await addCost(job.id, cost);
    const seconds = Math.max(0, (r.bytes.length - 44) / 48_000);
    const w = await withLedger(ctx, { provider: "gemini", model: MODELS.think() }, () => wordTimings(key, { bytes: r.bytes, mimeType: "audio/wav" }, n.text), (x) => ({ provider: "gemini", model: x.model, usage: x.usage }));
    await addCost(job.id, estimateCostUsd(w.model, w.usage));
    const a = await saveAsset({ hash, jobId: job.id, kind: "voice", provider: "gemini", model: r.model, bytes: r.bytes, mimeType: "audio/wav", seconds, costUsd: cost, meta: { text: n.text, voice: n.voiceName, words: w.words } });
    work.made[n.key] = madeFrom(n, a);
    return;
  }
  // A clip: submitted now, collected by a later step.
  await allow(job, `a ${n.seconds} s AI clip (${n.key})`, clipCost(n.seconds) + UNIT_USD.words);
  const frame = await bytesOf(work.made[n.from]);
  const model = veoModel();
  const operation = await withLedger(ctx, { provider: "veo", model }, () => submitVeo({ model, prompt: n.prompt, image: { base64: frame.bytes.toString("base64"), mimeType: frame.mimeType === "image/png" ? "image/png" : "image/jpeg" }, ratio: "9:16", seconds: 8, resolution: "720p" }, { apiKey: key }), () => ({ provider: "veo", model, usage: { inputTokens: 0, outputTokens: 0 } }));
  work.clips[n.key] = { operation, submittedAt: Date.now(), hash, seconds: n.seconds, speech: n.speech, tries: (work.clips[n.key]?.tries ?? 0) + 1 };
}

/** Omni speech is not available (Google's daily limit, a refusal): the line becomes a TTS voice-over, the clip silent. */
function speechFallback(script: Script, clipKey: string): Script | null {
  const beat = clipKey.replace(/^clip:/, "");
  if (beat === "end" && script.cta.source === "omni") return { ...script, cta: { ...script.cta, source: "tts" } };
  const b = script.beats.find((x) => x.beat === beat);
  if (!b?.line || b.line.source !== "omni") return null;
  return { ...script, beats: script.beats.map((x) => (x.beat === beat && x.line ? { ...x, line: { ...x.line, source: "tts" as const } } : x)) };
}

/** Checks the clips being made; a finished one is saved with its length and word timings. */
async function collectClips(job: Job, ctx: LedgerContext, work: Work, script: Script): Promise<{ changed: boolean; script: Script }> {
  const key = process.env.GEMINI_API_KEY ?? "";
  let changed = false;
  let current = script;
  for (const [k, c] of Object.entries(work.clips)) {
    let op;
    try {
      op = await getVeoOperation(c.operation, { apiKey: key });
    } catch (error) {
      if (error instanceof VeoError && !error.temporary) op = { done: true, error, videoUri: null, videoBytes: null };
      else continue;
    }
    if (!op.done && Date.now() - c.submittedAt < CLIP_TIMEOUT_MS) continue;
    changed = true;
    delete work.clips[k];
    const err = op.done ? op.error : new VeoError("Google took too long to make this clip.", "timeout");
    if (err || (!op.videoUri && !op.videoBytes)) {
      const e = err ?? new VeoError("Google finished without a video.", "failed");
      const fallback = c.speech ? speechFallback(current, k) : null;
      if (fallback) {
        current = fallback;
        await save(job.id, { script: json(current) }, { step: "assets", note: `Omni could not make ${k} with speech (${e.message}); the line becomes a voice-over and the clip silent.` });
        continue;
      }
      work.tries![k] = (work.tries![k] ?? 0) + 1;
      if (work.tries![k] >= 3) throw new Error(`Google could not make the clip ${k}: ${e.message}`);
      await save(job.id, {}, { step: "assets", note: `${k} failed (${e.message}); it is tried again.` });
      continue;
    }
    const bytes = await veoClipBytes(op, { apiKey: key });
    const dir = jobDir(job.id);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(/*turbopackIgnore: true*/ dir, `${k.replace(/\W/g, "_")}.mp4`);
    await fs.writeFile(file, bytes);
    const seconds = (await probeSeconds(file)) ?? c.seconds;
    const model = veoModel();
    await recordAiCall(ctx, { provider: "veo", model, usage: { inputTokens: seconds, outputTokens: 0 }, success: true, durationMs: Date.now() - c.submittedAt });
    const cost = estimateCostUsd(model, { inputTokens: seconds });
    await addCost(job.id, cost);
    let words: MadeAsset["words"] = [];
    if (c.speech) {
      const w = await withLedger(ctx, { provider: "gemini", model: MODELS.think() }, () => wordTimings(key, { bytes, mimeType: "video/mp4" }, c.speech!), (x) => ({ provider: "gemini", model: x.model, usage: x.usage }));
      await addCost(job.id, estimateCostUsd(w.model, w.usage));
      words = w.words;
    }
    const a = await saveAsset({ hash: c.hash, jobId: job.id, kind: "clip", provider: "veo", model, bytes, mimeType: "video/mp4", seconds, costUsd: cost, meta: { speech: c.speech, words } });
    work.made[k] = { key: k, ref: `ad:${a.id}`, kind: "video", hash: a.hash, seconds, ...(words.length ? { words } : {}) };
  }
  return { changed, script: current };
}

async function assets(job: Job, ctx: LedgerContext): Promise<"next" | "wait"> {
  const c = job.concept as Concept;
  const recipe = recipeById(c.recipe)!;
  let script = job.script as Script;
  const work = readWork(job);
  let needs = assetNeeds(recipe, script, c);
  if (!work.planChecked) {
    const cached = new Set<string>();
    for (const n of needs) if (!depOf(n) && (await findAsset(hashOf(n, work.made)))) cached.add(n.key);
    const lines = needsCost(needs, cached);
    const planUsd = lines.reduce((s, l) => s + l.usd, 0);
    const [row, month, limits] = await Promise.all([prisma.adJob.findUniqueOrThrow({ where: { id: job.id }, select: { costUsd: true } }), monthSpentUsd(), adLimits()]);
    const stop = planFits({ planUsd, adSpentUsd: Number(row.costUsd), monthSpentUsd: month, limits });
    if (stop) throw new StopError(stop);
    work.planChecked = true;
    await save(job.id, { pending: json(work) }, { step: "assets", note: `Plan: ${needs.length} assets, about ${usd(planUsd)} to make (${lines.length} paid).` });
  }
  const collected = await collectClips(job, ctx, work, script);
  script = collected.script;
  needs = assetNeeds(recipe, script, c);
  let progressed = collected.changed;
  // Everything whose input exists and that is not made or being made: reuse it from the cache, or make it.
  const ready = needs.filter((n) => !work.made[n.key] && !work.clips[n.key] && (!depOf(n) || work.made[depOf(n)!]));
  const toMake: { n: AssetNeed; hash: string }[] = [];
  for (const n of ready) {
    const hash = hashOf(n, work.made);
    const hit = await findAsset(hash);
    if (hit) {
      work.made[n.key] = madeFrom(n, hit);
      progressed = true;
    } else toMake.push({ n, hash });
  }
  for (let i = 0; i < toMake.length; i += PARALLEL) {
    const batch = toMake.slice(i, i + PARALLEL);
    // The whole batch must fit the limits (its calls run at the same time).
    await allow(job, `${batch.length} assets`, needsCost(batch.map((b) => b.n)).reduce((s, l) => s + l.usd, 0));
    const results = await Promise.allSettled(batch.map(({ n, hash }) => makeNeed(job, ctx, n, work, hash)));
    progressed = true;
    await save(job.id, { pending: json(work) });
    const stop = results.find((r) => r.status === "rejected" && r.reason instanceof StopError);
    if (stop && stop.status === "rejected") throw stop.reason;
    const failed = results.find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }
  await save(job.id, { pending: json(work) });
  const missing = needs.filter((n) => !work.made[n.key]);
  if (missing.length) return progressed ? "next" : "wait";

  // Everything made: the plan with real timings.
  const made: Record<string, MadeAsset> = {};
  for (const [k, m] of Object.entries(work.made)) if (needs.some((n) => n.key === k)) made[k] = m;
  const facts = await loadFacts(job.businessId);
  const edl = buildEdl({ recipe, script, concept: c, made, screens: facts.screens, brand: BUPULSE_BRAND });
  const check = validateEdl(edl);
  if (!check.ok) throw new StopError(`The plan does not pass its checks: ${check.errors.slice(0, 4).join(" ")}`);
  await save(job.id, { plan: json(check.edl), planVersion: { increment: 1 }, status: "rendering", pending: json({ ...work, render: undefined }) }, { step: "assets", note: `All assets ready; the plan is ${edl.canvas.seconds.toFixed(1)} s with ${edl.segments.length} segments${check.warnings.length ? ` (${check.warnings.length} warnings)` : ""}.` });
  return "next";
}

// ---- Fixture --------------------------------------------------------------------------------------------------------

async function startFixture(job: Job): Promise<"next"> {
  const name = job.mode.slice("fixture:".length);
  if (!isFixtureName(name)) throw new StopError(`There is no cached plan called "${name}".`);
  const edl = FIXTURES[name](await fixtureWords());
  const check = validateEdl(edl);
  if (!check.ok) throw new StopError(`The cached plan does not pass its checks: ${check.errors.slice(0, 3).join(" ")}`);
  await save(job.id, { plan: json(check.edl), planVersion: 1, status: "rendering", concept: json({ recipe: edl.recipe, effects: edl.effects, captionStyle: edl.captions.style, titleStyle: "slam", musicMood: "cached", line: "The cached \"Who's real?\" ad, re-rendered by the production renderer." }), caption: FIXTURE_CAPTION, hashtags: FIXTURE_TAGS }, { step: "queued", note: `Cached plan "${name}": no paid assets.` });
  return "next";
}

const FIXTURE_CAPTION = "One of these was made by AI. Plot twist: so was he. BuPulse writes, designs and posts your week for you, in English, French and Kinyarwanda. Get a free quote at bupulse.com.";
const FIXTURE_TAGS = ["BuPulse", "Kigali", "Rwanda", "SmallBusiness", "SocialMediaMarketing", "AI"];

// ---- Render ---------------------------------------------------------------------------------------------------------

async function render(job: Job): Promise<"next" | "wait"> {
  const edl = job.plan as Edl;
  const work = readWork(job);
  const dir = jobDir(job.id);
  const out = path.join(/*turbopackIgnore: true*/ dir, `ad-v${job.planVersion}.mp4`);
  const fresh = work.render && work.render.version === job.planVersion && Date.now() - work.render.startedAt < RENDER_STALE_MS;
  if (!fresh) {
    const files: Record<string, string> = {};
    for (const [k, a] of Object.entries(edl.assets)) files[k] = await localFile(a.ref, dir);
    await startRender({ edl, files, logo: files[edl.brand.logo ?? ""] ?? null, host: edl.brand.url, workDir: dir }, out);
    work.render = { startedAt: Date.now(), out, version: job.planVersion };
    await save(job.id, { pending: json(work) }, { step: "rendering", note: `Rendering version ${job.planVersion}.` });
    return "wait";
  }
  const result = await readRenderResult(out);
  if (!result) return "wait";
  if (!result.ok) throw new Error(`The renderer stopped: ${result.error}`);
  const stored = `jobs/${job.id}/ad-v${job.planVersion}.mp4`;
  await uploadFile(stored, await fs.readFile(out), "video/mp4");
  work.render = { ...work.render!, stored };
  await save(job.id, { pending: json(work), status: "judging" }, { step: "rendering", note: `Rendered in ${result.renderSeconds} s (${(result.bytes / 1e6).toFixed(1)} MB).` });
  return "next";
}

async function adFile(job: Job): Promise<string> {
  const work = readWork(job);
  const out = work.render?.out;
  if (out && (await fs.stat(out).catch(() => null))) return out;
  if (!work.render?.stored) throw new Error("The rendered ad is missing.");
  const file = path.join(/*turbopackIgnore: true*/ jobDir(job.id), `ad-v${job.planVersion}.mp4`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, await downloadFile(work.render.stored));
  return file;
}

// ---- Judge and fix --------------------------------------------------------------------------------------------------

async function judge(job: Job, ctx: LedgerContext): Promise<"next"> {
  await allow(job, "the judge", UNIT_USD.judge);
  const edl = job.plan as Edl;
  const file = await adFile(job);
  // The ad at 720p (the file itself when small enough), looked at JUDGE_LOOKS times at once, the looks combined.
  const copy = await judgeCopy(file, file.replace(/\.mp4$/, "-judge.mp4"));
  const bytes = await fs.readFile(/*turbopackIgnore: true*/ copy);
  const looks = await Promise.all(
    Array.from({ length: JUDGE_LOOKS }, async () => {
      const r = await withLedger(ctx, { provider: "gemini", model: MODELS.think() }, () => askAboutMedia<unknown>(process.env.GEMINI_API_KEY ?? "", { bytes, mimeType: "video/mp4", prompt: judgePrompt(edl) }), (x) => ({ provider: "gemini", model: x.model, usage: x.usage }));
      await addCost(job.id, estimateCostUsd(r.model, r.usage));
      return judgeSchema.safeParse(r.answer);
    }),
  );
  const readable = looks.flatMap((l) => (l.success ? [l.data] : []));
  if (!readable.length) throw new ProviderError("The judge's answer could not be read.");
  const a = combineJudgements(readable);
  const scores = [...((job.scores ?? []) as unknown[]), { at: new Date().toISOString(), version: job.planVersion, ...a }];
  const decision = decideFix(a, edl, job.fixedOnce);
  const note = `Judge: ${a.overall}/10 (hook ${a.scores.thumbStop}, retention ${a.scores.retention}, clarity ${a.scores.productClarity}, sound ${a.scores.sound}). ${decision.note}`;
  if (decision.action === "deliver") {
    await save(job.id, { scores: json(scores), status: "delivering" }, { step: "judging", note });
    return "next";
  }
  if (decision.action === "remix") {
    await save(job.id, { scores: json(scores), plan: json(lowerMusic(edl)), planVersion: { increment: 1 }, fixedOnce: true, status: "rendering" }, { step: "judging", note });
    return "next";
  }
  // A re-roll: only when it still fits the limits; else the ad is delivered as it is.
  const recipe = recipeById((job.concept as Concept).recipe)!;
  const script = job.script as Script | null;
  if (!script || job.mode !== "real") {
    await save(job.id, { scores: json(scores), status: "delivering" }, { step: "judging", note: `${note} (a cached plan is not re-rolled)` });
    return "next";
  }
  const work = readWork(job);
  const beatKeys = [`frame:${decision.beat}`, `clip:${decision.beat}`];
  const needs = assetNeeds(recipe, script, job.concept as Concept).filter((n) => beatKeys.includes(n.key));
  const cost = needsCost(needs).reduce((s, l) => s + l.usd, 0) + UNIT_USD.judge;
  const [row, month, limits] = await Promise.all([prisma.adJob.findUniqueOrThrow({ where: { id: job.id }, select: { costUsd: true } }), monthSpentUsd(), adLimits()]);
  if (!needs.length || !checkSpend({ adSpentUsd: Number(row.costUsd), monthSpentUsd: month, nextUsd: cost, limits, what: "the re-roll" }).ok) {
    await save(job.id, { scores: json(scores), status: "delivering" }, { step: "judging", note: `${note} The re-roll (about ${usd(cost)}) would pass a limit, so the ad is delivered as it is.` });
    return "next";
  }
  const fix = a.fix.replace(/\s+/g, " ").slice(0, 300);
  const beat = recipe.beats.find((b) => b.id === decision.beat);
  const next: Script = { ...script, beats: script.beats.map((b) => (b.beat !== decision.beat ? b : beat?.picture === "clip" ? { ...b, action: `${b.action ?? ""} ${fix}`.trim() } : { ...b, scene: `${b.scene ?? ""} ${fix}`.trim() })) };
  for (const k of beatKeys) delete work.made[k];
  await save(job.id, { scores: json(scores), script: json(next), pending: json({ ...work, render: undefined }), fixedOnce: true, status: "assets" }, { step: "judging", note });
  return "next";
}

// ---- Deliver --------------------------------------------------------------------------------------------------------

async function deliver(job: Job, account: { userId: string; businessId: string; timezone: string }): Promise<"next"> {
  const work = readWork(job);
  // The Gallery copy is kept on the job, so a retry of the next part never uploads the ad twice.
  if (!work.gallery || work.gallery.version !== job.planVersion) {
    const bytes = await fs.readFile(/*turbopackIgnore: true*/ await adFile(job));
    const item = await saveAdToGallery({ jobId: job.id, userId: account.userId, businessId: job.businessId, bytes, title: `Ad - ${(job.concept as Concept | null)?.recipe ?? "ad"} - ${new Date().toISOString().slice(0, 10)}` });
    work.gallery = { ...item, version: job.planVersion };
    await save(job.id, { pending: json(work) });
  }
  const last = ((job.scores ?? []) as JudgeAnswer[]).at(-1);
  const broken = last ? hardRuleFailures(last) : [];
  const edl = job.plan as Edl;
  const out = await deliverAd({ jobId: job.id, userId: account.userId, businessId: job.businessId, timezone: account.timezone, item: work.gallery, seconds: edl.canvas.seconds, caption: job.caption, hashtags: job.hashtags, makePosts: broken.length === 0, reviewNote: last ? `Made by the Ad Brain (judge ${last.overall}/10). Watch it before you approve.` : null });
  await save(job.id, { status: "ready", videoPath: out.videoPath, videoJobId: out.videoJobId, postGroupId: out.postGroupId, error: broken.length ? `Not posted: the judge flagged ${broken.join(", ")}. The video is in the Videos library.` : null }, { step: "delivering", note: out.posts ? `In the Videos library and ${out.posts} posts waiting for your OK.` : "In the Videos library (no posts made)." });
  return "next";
}
