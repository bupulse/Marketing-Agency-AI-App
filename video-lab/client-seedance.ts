// A client's Seedance clips in the studio (docs/STUDIO_DEPLOY.md, build item 8): each is a VideoJob row made by
// lib/video-studio/seedance-jobs.ts (credits from the plan, refunds, the poller, the Gallery). Until the BytePlus key
// is set, or while the Seedance switch is off, real video is "coming soon": a submission is a free preview (the
// storyboard), or is refused before anything is charged. The Create page was written for the owner's local Seedance
// jobs (video-lab/seedance-jobs.ts), so a row is shown to it in that shape (`labSeedanceJob`); the owner keeps the local
// jobs. BuPulse's text over a clip is a child Motion job, saved and turned into an MP4 like any Motion video.
import { prisma } from "@/lib/db";
import { isRatio, totalMs, type Ratio } from "@/lib/video-engine/spec";
import type { SeedanceRequest } from "@/lib/video-engine/seedance";
import { seedanceOverlayCaption, seedanceOverlaySpec } from "@/lib/video-engine/seedance-overlay";
import type { PromptBrief } from "@/lib/video-engine/seedance-prompt";
import { isPlatform } from "@/lib/video-engine/designer";
import { validateSpec } from "@/lib/video-engine/validate";
import { loadBriefFacts } from "@/lib/video-studio/brief";
import { SEEDANCE_MESSAGES, cancelSeedanceJob, createSeedancePreview, saveSeedanceOverlayJob, seedanceUnavailable, submitSeedanceJob, type SeedanceJobInput } from "@/lib/video-studio/seedance-jobs";
import { ClientJobError, asClientError, clientVideoUrl, getClientJob, ownerOf } from "./client-jobs";
import { seedanceCredits } from "./credits";
import { PREVIEW_NOTICE, buildStoryboard } from "./seedance-mock/storyboard";
import { previewDelayMs, previewThumbs } from "./seedance-mock/preview";
import type { StudioIdentity } from "./session";

/** Real ids of VideoJobs (cuids). */
export const CLIENT_SEEDANCE_ID = /^c[a-z0-9]{20,30}$/;

type Row = Awaited<ReturnType<typeof rowOf>>;
const SELECT = { id: true, status: true, createdAt: true, updatedAt: true, providerTaskId: true, brief: true, credits: true, costUsd: true, error: true, businessId: true, productId: true, videoPath: true, bytes: true, storyboard: true } as const;
const rowOf = (id: StudioIdentity, jobId: string) => prisma.videoJob.findFirst({ where: { id: jobId, businessId: id.businessId, engine: "seedance" }, select: SELECT });
type Brief = { title?: string; request?: Record<string, unknown> & { referenceNotes?: string[] }; estimateUsd?: number; preview?: { notice: string; readyAt: string; wouldCostCredits: number } };

/** The row's status in the local jobs' words (the page's): "submitted" is queued, "ready" succeeded, a preview due is ready. */
function labStatus(row: NonNullable<Row>, now: number): string {
  const brief = (row.brief ?? {}) as Brief;
  if (row.status === "preview") return brief.preview && now >= Date.parse(brief.preview.readyAt) ? "preview-ready" : "preview";
  return ({ submitted: "queued", ready: "succeeded" } as Record<string, string>)[row.status] ?? row.status;
}

/** A VideoJob as the Create page reads a Seedance job (video-lab/seedance-jobs.ts SeedanceJob). */
export function labSeedanceJob(row: NonNullable<Row>, now = Date.now()) {
  const brief = (row.brief ?? {}) as Brief;
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    taskId: row.providerTaskId,
    request: { ...(brief.request ?? {}), referenceNotes: brief.request?.referenceNotes ?? [] },
    status: labStatus(row, now),
    credits: row.credits,
    estimateUsd: brief.estimateUsd ?? 0,
    tokens: 0,
    costUsd: Number(row.costUsd),
    seed: null,
    videoFile: row.videoPath ? `${row.id}.mp4` : null,
    bytes: row.videoPath ? row.bytes : null,
    error: row.error,
    businessId: row.businessId,
    productId: row.productId,
    title: brief.title ?? "Real video",
    ...(brief.preview ? { preview: brief.preview } : {}),
  };
}

export async function listClientSeedanceJobs(id: StudioIdentity, limit = 40) {
  const rows = await prisma.videoJob.findMany({ where: { businessId: id.businessId, engine: "seedance" }, orderBy: { createdAt: "desc" }, take: limit, select: SELECT });
  return rows.map((r) => labSeedanceJob(r));
}

export async function getClientSeedanceJob(id: StudioIdentity, jobId: string) {
  if (!CLIENT_SEEDANCE_ID.test(jobId)) return null;
  const row = await rowOf(id, jobId);
  return row ? labSeedanceJob(row) : null;
}

/** The storyboard of a client's preview: not ready yet (and how long), or ready; null for another business's or a real clip. */
export async function clientSeedancePreview(id: StudioIdentity, jobId: string, now = Date.now()) {
  if (!CLIENT_SEEDANCE_ID.test(jobId)) return null;
  const row = await rowOf(id, jobId);
  const preview = (row?.brief as Brief | null)?.preview;
  if (!row || !preview || !row.storyboard) return null;
  if (now < Date.parse(preview.readyAt)) return { ready: false as const, readyInMs: Date.parse(preview.readyAt) - now, notice: preview.notice };
  return { ready: true as const, storyboard: row.storyboard };
}

/**
 * A client's Seedance submission, 1 to 3 versions: real clips when the key is set and the switch is on (credits from
 * their plan), free previews while there is no key, and a plain refusal (nothing charged) while the switch is off.
 */
export async function submitSeedanceForClient(id: StudioIdentity, input: Omit<SeedanceJobInput, "request"> & { request: SeedanceRequest; versions: number }) {
  const owner = ownerOf(id);
  const unavailable = await seedanceUnavailable();
  if (unavailable === "off") throw new ClientJobError(SEEDANCE_MESSAGES.off, 503);
  const jobs = [];
  for (let i = 0; i < Math.min(3, Math.max(1, input.versions)); i++) {
    const request = { ...input.request, seed: i === 0 ? input.request.seed : null };
    const one = { ...input, request };
    try {
      if (unavailable === "no-key") {
        const key = `pv-${crypto.randomUUID().slice(0, 12)}`;
        const credits = seedanceCredits(request.tier, request.draft ? "480p" : request.resolution, Math.min(15, Math.max(4, Math.round(request.seconds))));
        const storyboard = buildStoryboard({ id: key, title: input.title, request, referenceNotes: input.referenceNotes, thumbs: await previewThumbs(request.references), credits });
        jobs.push(await createSeedancePreview(owner, one, { storyboard, readyAt: new Date(Date.now() + previewDelayMs(key)), notice: `${SEEDANCE_MESSAGES.noKey} ${PREVIEW_NOTICE.replace(/^Preview: /, "")}` }));
      } else jobs.push(await submitSeedanceJob(owner, one));
    } catch (error) {
      // A later version that fails leaves the earlier ones; the first one's failure is the answer.
      if (jobs.length) break;
      throw await asClientError(error, 0, id.companyUserId);
    }
  }
  const rows = await prisma.videoJob.findMany({ where: { id: { in: jobs.map((j) => j.id) } }, select: SELECT });
  return rows.map((r) => labSeedanceJob(r));
}

export async function cancelClientSeedanceJob(id: StudioIdentity, jobId: string) {
  if (!CLIENT_SEEDANCE_ID.test(jobId)) return null;
  const done = await cancelSeedanceJob(ownerOf(id), jobId);
  return done ? getClientSeedanceJob(id, jobId) : null;
}

/** The overlay as the page reads it (video-lab/seedance-overlays.ts SeedanceOverlay), from the child Motion job. */
export async function clientSeedanceOverlay(id: StudioIdentity, jobId: string) {
  if (!CLIENT_SEEDANCE_ID.test(jobId)) return null;
  const child = await prisma.videoJob.findFirst({ where: { parentId: jobId, businessId: id.businessId, engine: "motion", mode: "overlay" }, select: { id: true } });
  const job = child ? await getClientJob(id, child.id) : null;
  if (!job?.spec) return null;
  const row = await prisma.videoJob.findUniqueOrThrow({ where: { id: job.id }, select: { brief: true, createdAt: true, updatedAt: true, videoPath: true, bytes: true, quality: true } });
  const o = (row.brief as { overlay?: { clipUrl: string; standIn: boolean } } | null)?.overlay;
  return {
    jobId,
    childJobId: job.id,
    createdAt: row.createdAt.toISOString(),
    spec: job.spec,
    clipUrl: o?.clipUrl ?? `/videos/seedance/${jobId}.mp4`,
    standIn: o?.standIn ?? false,
    captionScore: job.captionScore ?? 0,
    captionMissed: job.captionMissed ?? [],
    video: row.videoPath ? { bytes: row.bytes, savedAt: row.updatedAt.toISOString(), quality: row.quality ?? "1080p" } : null,
  };
}

/**
 * "Add BuPulse text" on a client's clip: the overlay design (free, no AI) over the finished clip, or, while Seedance is
 * in preview, over their newest finished Motion MP4 so the step can be tried; saved as the child Motion job.
 */
export async function addClientSeedanceOverlay(id: StudioIdentity, jobId: string, body: Record<string, unknown>) {
  if (!CLIENT_SEEDANCE_ID.test(jobId)) throw new ClientJobError("Not found", 404);
  const row = await rowOf(id, jobId);
  if (!row) throw new ClientJobError("Not found", 404);
  const brief = (row.brief ?? {}) as Brief;
  const preview = row.status === "preview";
  if (!preview && (row.status !== "ready" || !row.videoPath)) throw new ClientJobError("The clip is not ready yet.", 400);
  if (!row.productId) throw new ClientJobError("This clip was made without a product, so there is no price or number to add.", 400);
  const request = (brief.request ?? {}) as { ratio?: string; seconds?: number; audio?: boolean; prompt?: string; referenceNotes?: string[] };
  const ratio = request.ratio && request.ratio !== "adaptive" && isRatio(request.ratio) ? request.ratio : "9:16";
  let clipUrl = `/videos/seedance/${jobId}.mp4`;
  if (preview) {
    // The newest finished Motion MP4 of the same shape, else of any shape.
    const newest = (where: { ratio?: string }) => prisma.videoJob.findFirst({ where: { businessId: id.businessId, engine: "motion", videoPath: { not: null }, ...where }, orderBy: { updatedAt: "desc" }, select: { id: true } });
    const stand = (await newest({ ratio })) ?? (await newest({}));
    if (!stand || !(await clientVideoUrl(id, stand.id))) throw new ClientJobError("There is no finished studio video to stand in for the Seedance clip yet. Make a Motion MP4 first.", 400);
    clipUrl = `/videos/${stand.id}.mp4`;
  }
  try {
    const facts = await loadBriefFacts(id.businessId, row.productId);
    const platform = isPlatform(body.platform) ? body.platform : null;
    const promptBrief: PromptBrief = { business: { name: facts.business.name, description: facts.business.description, language: facts.business.language, country: facts.business.country, phone: facts.business.phone }, product: facts.product, references: request.referenceNotes ?? [], templateId: "product-hero", seconds: request.seconds ?? 5, ratio, audio: request.audio !== false, platform };
    const raw = seedanceOverlaySpec({ brief: promptBrief, clipUrl, prompt: request.prompt ?? null, seconds: request.seconds ?? 5 });
    const spec = validateSpec(raw, { ratio: (isRatio(raw.ratio) ? raw.ratio : "9:16") as Ratio, photoCount: 0, seconds: totalMs(raw) / 1000, platform, phone: facts.business.phone });
    const cap = seedanceOverlayCaption(promptBrief);
    await saveSeedanceOverlayJob(ownerOf(id), jobId, { spec, clipUrl, standIn: preview, captionScore: cap.score.score, captionMissed: cap.score.missed });
  } catch (error) {
    throw await asClientError(error, 0, id.companyUserId);
  }
  return clientSeedanceOverlay(id, jobId);
}

/** The id of a clip's overlay child (its MP4 is saved and served as a Motion video's). */
export async function overlayChildId(id: StudioIdentity, jobId: string): Promise<string | null> {
  if (!CLIENT_SEEDANCE_ID.test(jobId)) return null;
  const child = await prisma.videoJob.findFirst({ where: { parentId: jobId, businessId: id.businessId, engine: "motion", mode: "overlay" }, select: { id: true } });
  return child?.id ?? null;
}
