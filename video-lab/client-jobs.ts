// A client's Motion videos in the studio (docs/STUDIO_DEPLOY.md, items 5 and 6): every design is a VideoJob row made
// by lib/video-studio/jobs.ts (credits from the plan, Claude through the API key, cost ledger, refunds), and every MP4
// is saved into the business's Gallery (lib/video-studio/library.ts, the Gallery's own checks). The Create page was
// written for the owner's local test jobs, so a row is shown to it in that shape (`labJob`). The owner's own studio
// keeps the local jobs (video-lab/store.ts) and is not touched here.
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { GALLERY_VIDEO_BUCKET } from "@/lib/media/rules";
import { MediaError, signedUrls } from "@/lib/media/service";
import { subscriptionTransport } from "./claude-cli";
import { DESIGN_MODES, isPlatform, type BriefClip, type DesignMode } from "@/lib/video-engine/designer";
import { recipeWhy, type ViralRecipe } from "@/lib/video-engine/brain/viral";
import { SPEC_LIMITS, isRatio, totalMs, type MotionSpec } from "@/lib/video-engine/spec";
import { VIRAL_STYLE_ID } from "@/lib/video-engine/templates";
import { castById } from "@/lib/video-engine/cast";
import { BriefError, type StoredPhoto } from "@/lib/video-studio/brief";
import { VideoStudioError, designMotionJobs, type DesignJobInput, type StudioOwner } from "@/lib/video-studio/jobs";
import { prepareJobVideo, saveJobVideo } from "@/lib/video-studio/library";
import { makeJobVoice } from "@/lib/video-studio/voice";
import { UsageLimitError } from "@/lib/usage";
import { RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { CLAUDE_VIDEO_CREDITS, usageMessage } from "./credits";
import type { StudioIdentity } from "./session";
import { MAX_CLIPS, clientClipPath, clipLengthOk } from "./clip-rules";
import { aiClipRecipe, aiClipsForBrief, aiClipsRecord } from "./ai-clips";

/** A failure with the HTTP status and the plain-English message the page shows. */
export class ClientJobError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const ownerOf = (id: StudioIdentity): StudioOwner => ({ userId: id.companyUserId, actorId: id.userId, businessId: id.businessId });

/** Real ids of VideoJobs (cuids); the owner's local test jobs look like 20261019-1a2b3c4d. */
export const CLIENT_JOB_ID = /^c[a-z0-9]{20,30}$/;

const ROW = {
  id: true, status: true, engine: true, mode: true, spec: true, brief: true, caption: true, hashtags: true, warnings: true, score: true, captionScore: true, error: true, parentId: true, productId: true,
  templateId: true, hookId: true, platform: true, ratio: true, seconds: true, videoPath: true, posterPath: true, bytes: true, durationMs: true, quality: true, credits: true, createdAt: true, updatedAt: true,
  product: { select: { name: true } },
  business: { select: { name: true } },
} as const satisfies Prisma.VideoJobSelect;
type Row = Prisma.VideoJobGetPayload<{ select: typeof ROW }>;

type Brief = { photos?: StoredPhoto[]; note?: string | null; fixedLens?: boolean; purpose?: "ad" | "post"; variation?: { index: number; of: number } | null; recipe?: ViralRecipe | null; clips?: BriefClip[] };

/** Asset ids of the photos a set of rows used, by Storage path (the page draws them through /api/photo/<id>). */
async function assetIdsByPath(businessId: string, rows: Row[]): Promise<Map<string, string>> {
  const paths = [...new Set(rows.flatMap((r) => ((r.brief as Brief | null)?.photos ?? []).map((p) => p.path)))];
  if (!paths.length) return new Map();
  const assets = await prisma.mediaAsset.findMany({ where: { businessId, path: { in: paths } }, select: { id: true, path: true } });
  return new Map(assets.map((a) => [a.path, a.id]));
}

/** A VideoJob as the Create page reads a job: the owner's local job shape (video-lab/store.ts LabJob). */
export function labJob(row: Row, ids: Map<string, string>, withSpec = true) {
  const brief = (row.brief as Brief | null) ?? {};
  const caption = row.captionScore as { score?: number; missed?: string[] } | null;
  const variation = brief.variation;
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    engine: "claude" as const,
    productId: row.productId ?? "",
    productName: row.product?.name ?? "",
    businessName: row.business?.name ?? "",
    styleId: row.templateId ?? "",
    hookId: row.hookId ?? "auto",
    ratio: row.ratio,
    seconds: row.seconds,
    note: brief.note ?? null,
    photoIds: (brief.photos ?? []).map((p) => ids.get(p.path)).filter((x): x is string => !!x),
    spec: withSpec ? ((row.spec as MotionSpec | null) ?? null) : null,
    usage: [],
    status: row.status === "failed" || row.status === "designing" ? row.status : "designed",
    error: row.error,
    video: row.videoPath ? { bytes: row.bytes, renderMs: 0, savedAt: row.updatedAt.toISOString(), quality: row.quality ?? "1080p" } : null,
    edited: false,
    mode: row.mode ?? undefined,
    fixedLens: brief.fixedLens ?? false,
    purpose: brief.purpose ?? "ad",
    parentId: row.parentId,
    version: variation ? `${variation.index}/${variation.of}` : null,
    warnings: row.warnings,
    score: row.score ?? undefined,
    captionScore: caption?.score,
    captionMissed: caption?.missed ?? [],
    // A viral video's "Why this video" (plain English, no names or frames) and the clips it could place.
    why: brief.recipe?.version === 1 ? recipeWhy(brief.recipe) : undefined,
    viralSources: brief.recipe?.version === 1 ? brief.recipe.sources.map((s) => s.id) : undefined,
    clipIds: (brief.clips ?? []).map((c) => c.path.replace(/^\/api\/clip\//, "")),
  };
}

async function shaped(businessId: string, rows: Row[], withSpec = true) {
  const ids = await assetIdsByPath(businessId, rows);
  return rows.map((r) => ({ ...labJob(r, ids, withSpec), businessId }));
}

/** The business's Motion videos, newest first (the list leaves the designs out, as the owner's does). */
export async function listClientJobs(id: StudioIdentity, limit = 40) {
  // Without the design (it is large, and the list leaves it out): the page reads one job's design when it needs it.
  const rows = await prisma.videoJob.findMany({ where: { businessId: id.businessId, engine: "motion" }, orderBy: { createdAt: "desc" }, take: limit, select: { ...ROW, spec: false } });
  return shaped(id.businessId, rows.map((r) => ({ ...r, spec: null })) as Row[], false);
}

export async function getClientJob(id: StudioIdentity, jobId: string) {
  if (!CLIENT_JOB_ID.test(jobId)) return null;
  const row = await prisma.videoJob.findFirst({ where: { id: jobId, businessId: id.businessId, engine: "motion" }, select: ROW });
  return row ? (await shaped(id.businessId, [row]))[0] : null;
}

export type ClientJob = NonNullable<Awaited<ReturnType<typeof getClientJob>>>;

/** The hand-edited design, saved on the job (checked by the caller like Claude's answer). */
export async function saveClientSpec(id: StudioIdentity, jobId: string, spec: MotionSpec): Promise<void> {
  const { count } = await prisma.videoJob.updateMany({ where: { id: jobId, businessId: id.businessId, engine: "motion" }, data: { spec: spec as object, ratio: spec.ratio } });
  if (count !== 1) throw new ClientJobError("Test not found.", 404);
}

/** A free re-shape: the same design for another network's shape, saved as a child job (no credits). */
export async function createClientReshape(id: StudioIdentity, parent: ClientJob, spec: MotionSpec): Promise<ClientJob> {
  const p = await prisma.videoJob.findFirstOrThrow({ where: { id: parent.id, businessId: id.businessId }, select: { brief: true, mode: true, templateId: true, hookId: true, platform: true, caption: true, hashtags: true, warnings: true, score: true, captionScore: true, productId: true } });
  const row = await prisma.videoJob.create({
    data: {
      businessId: id.businessId, userId: id.userId, productId: p.productId, parentId: parent.id, engine: "motion", mode: p.mode, status: "designed", templateId: p.templateId, hookId: p.hookId, platform: p.platform,
      ratio: spec.ratio, seconds: Math.max(4, Math.min(30, Math.round(totalMs(spec) / 1000))), brief: p.brief as object, spec: spec as object, caption: p.caption, hashtags: p.hashtags,
      warnings: (p.warnings ?? []) as object, score: (p.score ?? undefined) as object | undefined, captionScore: (p.captionScore ?? undefined) as object | undefined, credits: 0,
    },
    select: { id: true },
  });
  return (await getClientJob(id, row.id)) as ClientJob;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * A design request from the Create page as designMotionJobs reads it: the page sends photo ids (Gallery assets of the
 * business), the template as `styleId` and the job an edit or extend changes as `baseJobId`. Everything is checked
 * against the business; the business is the session's, never the request's.
 */
export async function designInput(id: StudioIdentity, body: Record<string, unknown>): Promise<DesignJobInput> {
  const mode: DesignMode = (DESIGN_MODES as readonly string[]).includes(String(body.mode)) ? (body.mode as DesignMode) : "reference";
  const editing = mode === "edit" || mode === "extend";
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 600) : null;
  if (mode === "edit" && !note) throw new ClientJobError("Describe the change you want.", 400);
  let parentSpec: MotionSpec | null = null;
  let parentId: string | null = null;
  if (editing) {
    const parent = CLIENT_JOB_ID.test(String(body.baseJobId ?? ""))
      ? await prisma.videoJob.findFirst({ where: { id: String(body.baseJobId), businessId: id.businessId, engine: "motion" }, select: { id: true, spec: true } })
      : null;
    if (!parent?.spec) throw new ClientJobError("Pick a finished video to edit or extend.", 404);
    parentSpec = parent.spec as unknown as MotionSpec;
    parentId = parent.id;
  }
  const maxExtra = parentSpec ? Math.max(0, SPEC_LIMITS.maxTotalSeconds - totalMs(parentSpec) / 1000) : 0;
  if (mode === "extend" && maxExtra < 2) throw new ClientJobError("This video is already 30 seconds, the longest a video can be.", 400);
  const seconds = mode === "extend" ? Math.min(maxExtra, Math.max(2, Number(body.seconds) || 5)) : Math.min(SPEC_LIMITS.maxTotalSeconds, Math.max(4, Number(body.seconds) || 15));
  // Photos: ids of the business's Gallery photos, in the page's order; none chosen means the product's album.
  let photoPaths: string[] | undefined;
  if (!editing && Array.isArray(body.photoIds) && body.photoIds.length) {
    const wanted = body.photoIds.map(String).slice(0, 4);
    const assets = await prisma.mediaAsset.findMany({ where: { id: { in: wanted }, businessId: id.businessId, kind: "photo" }, select: { id: true, path: true } });
    photoPaths = wanted.flatMap((w) => assets.filter((a) => a.id === w).map((a) => a.path));
    if (!photoPaths.length) throw new ClientJobError("Use photos from your BuPulse gallery.", 400);
  }
  const hook = body.chosenHook as { hookId?: unknown; line?: unknown } | null | undefined;
  // The client's phone clips, then the AI clips made for this video (video-lab/ai-clips.ts: their own, ready, at most 3).
  const clips = editing || mode === "text" ? [] : [...(await clipsForDesign(id, body.clipIds)), ...(await aiClipsForBrief(body.aiClipIds, id.businessId))];
  const aiIds = clips.filter((c) => c.source === "ai").map((c) => c.path.replace(/^\/videos\/veo\/|\.mp4$/g, ""));
  return {
    productId: str(body.productId, 40),
    photoPaths,
    // Viral techniques by default (owner decision, 19 October 2026); a template only when the page picked one.
    templateId: str(body.styleId, 40) || VIRAL_STYLE_ID,
    hookId: str(body.hookId, 40) || "auto",
    ratio: isRatio(body.ratio) ? body.ratio : "9:16",
    seconds,
    note,
    mode,
    parentId,
    fixedLens: body.fixedLens === true,
    cartoonId: castById(String(body.cartoonId ?? ""))?.id ?? null,
    platform: isPlatform(body.platform) ? body.platform : null,
    versions: editing ? 1 : Math.min(4, Math.max(1, Math.round(Number(body.versions) || 1))),
    voice: body.voice !== false,
    chosenHook: hook && typeof hook.hookId === "string" && typeof hook.line === "string" ? { hookId: hook.hookId.slice(0, 60), line: hook.line.slice(0, 120) } : null,
    purpose: body.purpose === "post" ? "post" : "ad",
    clips,
    aiClipsRecord: aiIds.length ? await aiClipsRecord(aiIds) : null,
    aiClipRecipe: aiIds.length ? await aiClipRecipe(aiIds, id.businessId) : null,
  };
}

/** The phone clips a client's design may place: their own Gallery videos of 5 to 10 s, in the page's order, at most 4. */
export async function clipsForDesign(id: StudioIdentity, ids: unknown): Promise<BriefClip[]> {
  const wanted = (Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[A-Za-z0-9-]{10,40}$/.test(x)).slice(0, MAX_CLIPS);
  if (!wanted.length) return [];
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: wanted }, businessId: id.businessId, kind: "video" }, select: { id: true, width: true, height: true, durationMs: true, description: true } });
  return wanted.flatMap((w) => {
    const a = assets.find((x) => x.id === w);
    const seconds = (a?.durationMs ?? 0) / 1000;
    if (!a || !clipLengthOk(seconds)) return [];
    return [{ path: clientClipPath(a.id), source: "phone" as const, seconds, width: a.width ?? 1080, height: a.height ?? 1920, ...(a.description ? { note: a.description } : {}) }];
  });
}

/**
 * Designs 1 to 4 versions through lib/video-studio/jobs.ts. In production Claude is reached with the API key only; the
 * owner's test studio (STUDIO_ENV not production, no API key) may use the Claude subscription for a client session.
 */
export async function designForClient(id: StudioIdentity, body: Record<string, unknown>): Promise<{ jobs: ClientJob[]; error: string | null }> {
  const input = await designInput(id, body);
  const owner = ownerOf(id);
  const test = process.env.STUDIO_ENV !== "production" && !process.env.ANTHROPIC_API_KEY?.trim();
  let views;
  try {
    views = await designMotionJobs(owner, input, test ? { env: { ...process.env, ANTHROPIC_API_KEY: "subscription" }, transport: subscriptionTransport() } : {});
  } catch (error) {
    throw await asClientError(error, CLAUDE_VIDEO_CREDITS * (input.versions ?? 1), owner.userId);
  }
  const rows = await prisma.videoJob.findMany({ where: { id: { in: views.map((v) => v.id) } }, select: ROW });
  const jobs = await shaped(id.businessId, rows);
  const ok = jobs.filter((j) => j.status !== "failed");
  return { jobs, error: ok.length ? null : (jobs[0]?.error ?? "The design failed.") };
}

/** The plain-English error for the page: the lib's own messages, the plan's credits, or a general line. */
export async function asClientError(error: unknown, credits: number, companyUserId: string): Promise<ClientJobError> {
  if (error instanceof ClientJobError) return error;
  if (error instanceof RateLimitError) return new ClientJobError(rateLimitMessage(error), 429);
  if (error instanceof VideoStudioError) return new ClientJobError(error.message, error.status);
  if (error instanceof BriefError) return new ClientJobError(error.message, error.code === "not_found" ? 404 : 400);
  if (error instanceof MediaError) return new ClientJobError(error.message, 400);
  if (error instanceof UsageLimitError) return new ClientJobError((await usageMessage(error, credits, companyUserId)) ?? "Videos cannot be made right now.", 402);
  console.log(`[lab] client job failed: ${error instanceof Error ? error.message : String(error)}`);
  return new ClientJobError("Something went wrong. Please try again.", 500);
}

/** The voice-over (lib/video-studio/voice.ts: credits held on the job, a take the company has is free). */
export async function voiceForClient(id: StudioIdentity, jobId: string, voiceId: string | null) {
  const owner = ownerOf(id);
  try {
    const out = await makeJobVoice(owner, jobId, { voiceId });
    return { voice: out.voice, credits: out.credits };
  } catch (error) {
    throw await asClientError(error, 0, owner.userId);
  }
}

// ---- The MP4 (item 6) ---------------------------------------------------------------------------------------------

/** The poster the page sent before the MP4 (a small JPEG), kept a few minutes for the save that follows. */
const posters = new Map<string, { bytes: Buffer; at: number }>();
/** The poster kept for a job (tests, and the save). */
export const keptPoster = (jobId: string) => posters.get(jobId)?.bytes ?? null;
/** The Gallery drops a poster over 1,280 px on its long side (lib/media/service.ts), leaving the video without one. */
const POSTER_MAX_SIDE = 1280;
/**
 * Keeps the poster for the job's MP4, shrunk to at most 1,280 px on the long side (a JPEG the Gallery will accept) when
 * the page sent a larger one. Returns false when the bytes are not a readable image.
 */
export async function keepPoster(jobId: string, bytes: Buffer): Promise<boolean> {
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(bytes).metadata();
    const big = Math.max(meta.width ?? 0, meta.height ?? 0) > POSTER_MAX_SIDE;
    const out = big || meta.format !== "jpeg" ? await sharp(bytes).resize({ width: POSTER_MAX_SIDE, height: POSTER_MAX_SIDE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer() : bytes;
    // The Gallery also drops a poster over 400 KB: a smaller copy then.
    const small = out.length > 400 * 1024 ? await sharp(out).resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer() : out;
    const now = Date.now();
    for (const [k, v] of posters) if (now - v.at > 10 * 60_000) posters.delete(k);
    posters.set(jobId, { bytes: small, at: now });
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves the MP4 the browser made into the business's Gallery ("Video Studio" folder) and turns the job "ready" with
 * its video, poster, size and length (lib/video-studio/library.ts: the Gallery's own checks, the plan's videos counted
 * once per job). The bytes come through this server, which uploads them to Storage with the signed target the Gallery
 * issued, so the page needs no Storage key.
 */
export async function saveClientVideo(id: StudioIdentity, jobId: string, bytes: Buffer, opts: { musicTrackId?: string | null; width?: number | null; height?: number | null }): Promise<ClientJob> {
  const job = await getClientJob(id, jobId);
  if (!job) throw new ClientJobError("Test not found.", 404);
  if (bytes.length < 1000 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") throw new ClientJobError("That is not an MP4 file.", 400);
  const ctx = { userId: id.companyUserId, businessId: id.businessId };
  let uploaded: string | null = null;
  try {
    const { target, destination } = await prepareJobVideo(ctx, jobId, { bytes: bytes.length });
    const bucket = createAdminClient().storage.from(GALLERY_VIDEO_BUCKET);
    const up = await bucket.uploadToSignedUrl(target.path, target.token, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), { contentType: "video/mp4" });
    if (up.error) throw new ClientJobError("The video did not upload. Please try again.", 502);
    uploaded = target.path;
    const poster = posters.get(jobId);
    if (target.poster && poster) await bucket.uploadToSignedUrl(target.poster.path, target.poster.token, new Blob([new Uint8Array(poster.bytes)], { type: "image/jpeg" }), { contentType: "image/jpeg" }).catch(() => null);
    posters.delete(jobId);
    await saveJobVideo(ctx, jobId, { path: target.path, destination, name: `${job.productName || "Video"} - ${job.styleId}`.slice(0, 120), width: opts.width ?? null, height: opts.height ?? null, musicTrackId: opts.musicTrackId ?? null });
    uploaded = null;
  } catch (error) {
    if (uploaded) await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).remove([uploaded]).catch(() => undefined);
    throw await asClientError(error, 0, id.companyUserId);
  }
  return (await getClientJob(id, jobId)) as ClientJob;
}

/** A short-lived link to a ready video of the business (Storage serves it, with Range), or null. */
export async function clientVideoUrl(id: StudioIdentity, jobId: string): Promise<string | null> {
  if (!CLIENT_JOB_ID.test(jobId)) return null;
  const row = await prisma.videoJob.findFirst({ where: { id: jobId, businessId: id.businessId, videoPath: { not: null } }, select: { videoPath: true } });
  return row?.videoPath ? ((await signedUrls([row.videoPath])).get(row.videoPath) ?? null) : null;
}
