// The temporary reel engine (docs/REEL_ENGINE.md; owner decision 23 October 2026, until the Video Studio's Seedance
// engine is ready): 30-second reels from 4 Google Veo clips, with the company's own AI presenter, through the existing
// GEMINI_API_KEY. A team like the image engine's: the Brain (loadFacts), the Director (story.ts directReel), the
// Prompter (writer.ts), the Painter for each clip's start frame (Nano Banana 2, checked for slop), the Filmmaker (Veo
// 3.1 Lite, or Fast as Pro), then the owner's browser joins the clips with subtitles and music (lib/video-engine encode).
// TEST ONLY for now: on when the "veo" service is switched on and the company is in REEL_ENGINE_BUSINESSES, and every
// reel stops at the owner's test cap (REEL_TEST_CAP_USD, $10). No credits are charged yet (price later: owner decision).
// One step per call (stepReel), so no request runs long.
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/errors";
import { isServiceEnabled } from "@/lib/admin/switch";
import { getTextProvider } from "@/lib/ai";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";
import { createEngineDesign, designUrls } from "@/lib/designs/service";
import { checkPicture } from "@/lib/image-engine/check";
import { claudeJson } from "@/lib/image-engine/planner";
import { loadFacts } from "@/lib/image-engine/engine";
import { realismBlock } from "@/lib/image-engine/realism";
import { musicUrl, trackForVideo } from "@/lib/music/service";
import { createSignedUploadUrl } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import * as veo from "@/lib/video-engine/veo";
import { downloadVeo, getVeoOperation, submitVeo, veoClipUsd, veoLedgerUsage, veoModel } from "@/lib/video-engine/veo";
import { CLIP_SECONDS, directReel, reelCostUsd, variantOf, veoClipPrompt, type ReelClip, type ReelLanguage, type ReelPlan, type ReelTier } from "./story";
import { readReel, reelPrompt, REEL_SCHEMA, REEL_SYSTEM, ruleReel, type ReelInput } from "./writer";

export class ReelError extends Error {}

type Owner = { userId: string; businessId: string };
const json = (v: unknown) => v as Prisma.InputJsonValue;
const FRAME_MODEL = () => process.env.GEMINI_IMAGE_LITE_MODEL || "gemini-3.1-flash-image";
const PORTRAIT_MODEL = () => process.env.GEMINI_IMAGE_PRO_MODEL || "gemini-3-pro-image";
const FRAME_USD = 0.067;
const PORTRAIT_USD = 0.134;
const STEP_LEASE_MS = 3 * 60 * 1000;
const CLIPS_BUCKET = "gallery-videos";

/** The owner's test cap in USD for all reels together. */
export const reelTestCapUsd = () => Number(process.env.REEL_TEST_CAP_USD) > 0 ? Number(process.env.REEL_TEST_CAP_USD) : 10;

/** On only while testing: the Veo switch on and the company named in REEL_ENGINE_BUSINESSES. */
export async function reelEngineOn(businessId: string): Promise<boolean> {
  const allowed = (process.env.REEL_ENGINE_BUSINESSES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(businessId) || !process.env.GEMINI_API_KEY) return false;
  return isServiceEnabled("veo").catch(() => false);
}

/** What every reel together has cost so far (the test cap). */
export async function reelTestSpentUsd(): Promise<number> {
  const sum = await prisma.reelJob.aggregate({ _sum: { costUsd: true } });
  return Math.round((sum._sum.costUsd ?? 0) * 100) / 100;
}

const addCost = (id: string, usd: number) => prisma.reelJob.update({ where: { id }, data: { costUsd: { increment: usd } } });

/** Who the company's presenter is, from what the business sells and to whom (a Black Rwandan adult, owner decision). */
export function presenterDescription(seed: string, audience: string | null): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const woman = /\b(women|woman|ladies|mothers|female)\b/i.test(audience ?? "") || h % 2 === 0;
  const age = ["late twenties", "early thirties", "mid thirties", "early forties"][h % 4];
  const hair = woman ? ["short natural hair", "neat braids", "a low bun", "short twists"][(h >>> 3) % 4] : ["a short fade", "close-cropped hair", "a neat short beard", "short twists"][(h >>> 3) % 4];
  return `a Black Rwandan ${woman ? "woman" : "man"} in ${woman ? "her" : "his"} ${age}, ${hair}, a warm confident smile, smart-casual clothes in the brand's colour`;
}

/** The company's presenter: made once (a Nano Banana Pro portrait), then reused in every reel. */
export async function ensurePresenter(owner: Owner, jobId: string | null, audience: string | null): Promise<{ path: string; description: string }> {
  const known = await prisma.reelPresenter.findUnique({ where: { businessId: owner.businessId } });
  if (known) return known;
  const description = presenterDescription(owner.businessId, audience);
  const made = await createEngineDesign({
    userId: owner.userId,
    businessId: owner.businessId,
    model: PORTRAIT_MODEL(),
    aspectRatio: "4:5",
    prompt: [`A portrait photograph of ${description}, standing in a bright, real Kigali street or shop, looking at the camera, chest up.`, realismBlock("an editorial magazine photo (Sony A7 IV, 50mm f/1.8, natural light, honest colour)"), "No words, letters or logos anywhere."].join("\n"),
  });
  if (jobId) await addCost(jobId, PORTRAIT_USD);
  return prisma.reelPresenter.upsert({ where: { businessId: owner.businessId }, create: { businessId: owner.businessId, path: made.path, description }, update: {} });
}

async function writeReel(owner: Owner, input: ReelInput): Promise<ReelPlan> {
  const parse = (t: string) => {
    try {
      return JSON.parse(t.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      return null;
    }
  };
  try {
    // Gemini writes Kinyarwanda; English goes to Claude when it is there.
    const claude = input.language === "English" ? await claudeJson(owner, REEL_SYSTEM, reelPrompt(input), REEL_SCHEMA, "reelEngine") : null;
    const fromClaude = claude ? readReel(parse(claude), input) : null;
    if (fromClaude) return fromClaude;
    const provider = getTextProvider();
    const model = provider.name === "claude" ? (process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5") : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL);
    const result = await withLedger({ ...owner, feature: "reelEngine" }, { provider: provider.name, model }, () => provider.generate({ system: REEL_SYSTEM, prompt: reelPrompt(input), jsonSchema: REEL_SCHEMA, maxOutputTokens: 4000 }), (r) => ({ provider: r.provider, model: r.model, usage: r.usage }));
    return readReel(parse(result.text), input) ?? ruleReel(input);
  } catch (error) {
    await logError(error, { source: "reel-engine.writer", level: "warn", businessId: owner.businessId });
    return ruleReel(input);
  }
}

/** Plans a reel: the presenter, the Director's beats and the Prompter's clips. Throws ReelError the owner can read. */
export async function startReel(owner: Owner, request: { subjectId?: string | null; brief?: string | null; language: ReelLanguage; tier: ReelTier }): Promise<string> {
  if (!(await reelEngineOn(owner.businessId))) throw new ReelError("AI reels are being tested and are not on for your business yet.");
  const spent = await reelTestSpentUsd();
  if (spent + reelCostUsd(veoClipUsd(CLIP_SECONDS, veoModel())) > reelTestCapUsd()) throw new ReelError(`The test budget is used: $${spent.toFixed(2)} of $${reelTestCapUsd()}. Ask to raise it before the next reel.`);
  const loaded = await loadFacts(owner, request.subjectId);
  const job = await prisma.reelJob.create({ data: { businessId: owner.businessId, subjectId: request.subjectId ?? null, language: request.language, tier: request.tier, status: "filming", plan: json({ clips: [] }), stepUntil: new Date(Date.now() + STEP_LEASE_MS) } });
  try {
    const presenter = await ensurePresenter(owner, job.id, loaded.business.audience);
    const recentJobs = await prisma.reelJob.findMany({ where: { businessId: owner.businessId, id: { not: job.id } }, orderBy: { createdAt: "desc" }, take: 10, select: { plan: true } });
    const recentClips = recentJobs.flatMap((j) => ((j.plan as unknown as ReelPlan).clips ?? []).map((c) => ({ variant: c.variant, camera: c.camera })));
    const beats = directReel(recentClips, job.id);
    const plan = await writeReel(owner, { business: loaded.facts, subject: loaded.subject, brief: request.brief?.trim() || null, language: request.language, presenter: presenter.description, beats, recent: recentJobs.map((j) => (j.plan as unknown as ReelPlan).title).filter(Boolean) });
    await prisma.reelJob.update({ where: { id: job.id }, data: { plan: json(plan), stepUntil: null } });
    return job.id;
  } catch (error) {
    await prisma.reelJob.update({ where: { id: job.id }, data: { status: "failed", stepUntil: null, error: "The reel could not be planned. Please try again." } });
    throw error;
  }
}

async function bytesOf(bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await createAdminClient().storage.from(bucket).download(path);
  if (error || !data) throw new ReelError("A file of this reel could not be read.");
  return new Uint8Array(await data.arrayBuffer());
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The start frame of one clip: the presenter's portrait and the product photo as references, checked for slop once. */
async function frameFor(owner: Owner, job: { id: string; subjectId: string | null }, plan: ReelPlan, clip: ReelClip, presenterPath: string, productPhoto: string | null): Promise<string> {
  const prompt = [
    `A tall vertical (9:16) photograph, the first frame of a video clip. ${clip.frame}`,
    clip.presenter ? `The presenter is ${plan.presenter}: the same person as in the first attached portrait.` : null,
    productPhoto ? "The product is exactly the one in the last attached photo." : null,
    realismBlock("a 35mm documentary photo (Canon EOS R6, 35mm f/2 lens, available light, photojournalism style)"),
    "No words, letters, captions or logos anywhere in the picture.",
  ].filter(Boolean).join("\n");
  const paint = () => createEngineDesign({ userId: owner.userId, businessId: owner.businessId, subjectId: job.subjectId, service: true, model: FRAME_MODEL(), aspectRatio: "9:16", prompt, references: clip.presenter ? [presenterPath] : [], usePhotoPath: productPhoto });
  let made = await paint();
  await addCost(job.id, FRAME_USD);
  const verdict = await checkPicture(owner, made, { headline: "", subline: "", cta: "", productShown: false, product: "" });
  if (!verdict.ok) {
    made = await paint();
    await addCost(job.id, FRAME_USD);
  }
  return made.path;
}

/** One unit of work on a reel: a start frame, or sending the framed clips to Veo, or checking the clips being filmed. */
export async function stepReel(owner: Owner, jobId: string, now: Date = new Date()): Promise<void> {
  const { count } = await prisma.reelJob.updateMany({ where: { id: jobId, businessId: owner.businessId, status: "filming", OR: [{ stepUntil: null }, { stepUntil: { lt: now } }] }, data: { stepUntil: new Date(now.getTime() + STEP_LEASE_MS) } });
  if (count === 0) return;
  const job = (await prisma.reelJob.findUnique({ where: { id: jobId } }))!;
  const plan = job.plan as unknown as ReelPlan;
  const save = (data: Prisma.ReelJobUpdateInput = {}) => prisma.reelJob.update({ where: { id: jobId }, data: { plan: json(plan), stepUntil: null, ...data } });
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  // Google's video model in lib/video-engine/veo.ts (Veo 3.1 Lite was retired on 23 October 2026; the shared client
  // moves to Gemini Omni Flash). One model for now: the tier is kept for when there are two again.
  const model = veoModel();
  try {
    // 1. The next start frame.
    const toFrame = plan.clips.find((c) => !c.framePath);
    if (toFrame) {
      const presenter = await ensurePresenter(owner, job.id, null);
      const loaded = await loadFacts(owner, job.subjectId);
      const photo = loaded.photos.length ? loaded.photos[plan.clips.indexOf(toFrame) % loaded.photos.length] : null;
      toFrame.framePath = await frameFor(owner, job, plan, toFrame, presenter.path, photo);
      toFrame.status = "framed";
      await save();
      return;
    }
    // 2. Every framed clip to Veo (each answers in seconds with an operation to check later).
    for (const clip of plan.clips.filter((c) => c.status === "framed")) {
      const frame = await bytesOf("designs", clip.framePath!);
      const mimeType = frame[0] === 0x89 ? "image/png" : "image/jpeg";
      clip.operation = await submitVeo({ model, prompt: veoClipPrompt(clip, job.language as ReelLanguage), image: { base64: base64(frame), mimeType }, ratio: "9:16", seconds: CLIP_SECONDS, resolution: "720p" }, { apiKey });
      clip.status = "filming";
    }
    // 3. The clips being filmed: done ones are downloaded, through the cost ledger.
    for (const [i, clip] of plan.clips.entries()) {
      if (clip.status !== "filming" || !clip.operation) continue;
      const op = await getVeoOperation(clip.operation, { apiKey });
      if (!op.done) continue;
      if (op.error || (!op.videoUri && !(op as { videoBytes?: Buffer | null }).videoBytes)) {
        clip.status = "failed";
        clip.error = op.error?.message ?? "Veo could not make this clip.";
        continue;
      }
      // The clip comes back as a link (Veo) or inline (Omni: veoClipBytes); both are read the same way.
      const clipBytes = (veo as { veoClipBytes?: (o: typeof op, opts: { apiKey: string }) => Promise<Buffer> }).veoClipBytes;
      const bytes = await withLedger({ ...owner, feature: "reelEngine" }, { provider: "veo", model }, () => (clipBytes ? clipBytes(op, { apiKey }) : downloadVeo(op.videoUri!, { apiKey })), () => veoLedgerUsage(model, CLIP_SECONDS));
      const path = `${owner.userId}/clips/reels/${job.id}-${i}.mp4`;
      const { error } = await createAdminClient().storage.from(CLIPS_BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (error) throw new ReelError("A clip could not be saved. Please try again.");
      clip.clipPath = path;
      clip.status = "done";
      await addCost(job.id, veoClipUsd(CLIP_SECONDS, model));
    }
    const failed = plan.clips.find((c) => c.status === "failed");
    if (failed) return void (await save({ status: "failed", error: `A clip could not be made: ${failed.error}` }));
    await save(plan.clips.every((c) => c.status === "done") ? { status: "assembling" } : {});
  } catch (error) {
    await logError(error, { source: "reel-engine.step", businessId: owner.businessId });
    await save({ status: "failed", error: error instanceof ReelError || (error as Error).name === "VeoError" ? (error as Error).message : "The reel could not be made. Please try again." });
  }
}

export type ReelView = {
  id: string;
  status: string;
  language: string;
  tier: string;
  title: string;
  caption: string;
  hashtags: string[];
  costUsd: number;
  error: string | null;
  presenter: string | null;
  clips: { beat: string; label: string; line: string; status: string; frameUrl: string | null; clipUrl: string | null }[];
  musicUrl: string | null;
  reelUrl: string | null;
};

async function signedClips(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data } = await createAdminClient().storage.from(CLIPS_BUCKET).createSignedUrls(paths, 60 * 60);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

export async function reelView(owner: Owner, jobId: string): Promise<ReelView | null> {
  const job = await prisma.reelJob.findFirst({ where: { id: jobId, businessId: owner.businessId } });
  if (!job) return null;
  const plan = job.plan as unknown as ReelPlan;
  const clips = plan.clips ?? [];
  const [frames, files, music] = await Promise.all([
    designUrls(clips.flatMap((c) => (c.framePath ? [c.framePath] : []))),
    signedClips([...clips.flatMap((c) => (c.clipPath ? [c.clipPath] : [])), ...(job.path ? [job.path] : [])]),
    plan.music ? trackForVideo(plan.music, job.id) : null,
  ]);
  return {
    id: job.id,
    status: job.status,
    language: job.language,
    tier: job.tier,
    title: plan.title ?? "",
    caption: plan.caption ?? "",
    hashtags: plan.hashtags ?? [],
    costUsd: job.costUsd,
    error: job.error,
    presenter: plan.presenter ?? null,
    clips: clips.map((c) => ({ beat: c.beat, label: variantOf(c.variant)?.idea ?? c.beat, line: c.line, status: c.status, frameUrl: c.framePath ? (frames.get(c.framePath) ?? null) : null, clipUrl: c.clipPath ? (files.get(c.clipPath) ?? null) : null })),
    musicUrl: music ? musicUrl(music.path) : null,
    reelUrl: job.path ? (files.get(job.path) ?? null) : null,
  };
}

/** Where the browser uploads the finished reel. */
export async function reelUploadTarget(owner: Owner, jobId: string): Promise<{ path: string; token: string }> {
  const job = await prisma.reelJob.findFirst({ where: { id: jobId, businessId: owner.businessId, status: "assembling" } });
  if (!job) throw new ReelError("This reel is not ready to be put together.");
  const path = `${owner.userId}/clips/reels/${job.id}.mp4`;
  const { token } = await createSignedUploadUrl(CLIPS_BUCKET, path, { service: true });
  return { path, token };
}

/** The finished reel is saved: done. */
export async function finishReel(owner: Owner, jobId: string): Promise<void> {
  const job = await prisma.reelJob.findFirst({ where: { id: jobId, businessId: owner.businessId, status: "assembling" } });
  if (!job) throw new ReelError("This reel is not ready.");
  const path = `${owner.userId}/clips/reels/${job.id}.mp4`;
  const { data } = await createAdminClient().storage.from(CLIPS_BUCKET).info(path);
  if (!data) throw new ReelError("The finished reel was not uploaded. Please try again.");
  await prisma.reelJob.update({ where: { id: job.id }, data: { status: "done", path } });
}
