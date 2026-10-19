// A client's Premium 3D clips in the studio (docs/STUDIO_DEPLOY.md, build item 9): VideoJob rows (engine "premium3d")
// made by lib/video-studio/premium-jobs.ts, credits from the plan, Claude through the API key (the owner's test studio
// may use the subscription, as for Motion), rendered by this computer's Blender one at a time (the same queue as the
// owner's own clips, video-lab/premium-jobs.ts oneRenderAtATime) and saved into the business's Gallery. The Create page
// was written for the owner's local Premium jobs, so a row is shown to it in that shape (`labPremiumJob`).
import path from "node:path";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isPremiumQuality } from "@/lib/video-engine/credits";
import { isPlatform } from "@/lib/video-engine/designer";
import { isRatio } from "@/lib/video-engine/spec";
import { VIDEO_TEMPLATES } from "@/lib/video-engine/templates";
import { PREMIUM_ENGINE, premiumProgress, recoverPremiumJobs, rerenderPremiumJob, startPremiumJob, startPremiumRenderLoop, type PremiumDeps, type PremiumJobInput } from "@/lib/video-studio/premium-jobs";
import { renderBlenderScene } from "./blender-jobs";
import { subscriptionTransport } from "./claude-cli";
import { ClientJobError, asClientError, ownerOf } from "./client-jobs";
import { PREMIUM_3D_CREDITS, PREMIUM_RERENDER_CREDITS } from "./credits";
import { oneRenderAtATime } from "./premium-jobs";
import type { StudioIdentity } from "./session";

/** Where the client clips' photo files and MP4s are written on this computer (one folder per job). */
export const CLIENT_PREMIUM_DIR = path.resolve(process.env.PREMIUM_JOBS_DIR || "video-lab/data/blender/vj");
const CLIENT_ID = /^c[a-z0-9]{20,30}$/;

let loop: { poke: () => void; stop: () => void } | null = null;

/** Starts this computer's render loop for client clips (after recovering the ones a restart stopped). */
export async function startClientPremiumLoop(): Promise<{ failed: number; requeued: number }> {
  const recovered = await recoverPremiumJobs();
  loop ??= startPremiumRenderLoop({
    dataDir: CLIENT_PREMIUM_DIR,
    serial: oneRenderAtATime,
    render: async (scene, outPath, opts) => {
      const out = await renderBlenderScene(scene, outPath, { photos: opts.photos, jobDir: opts.jobDir, ...(opts.music ? { music: opts.music } : {}), onProgress: opts.onProgress });
      return { bytes: out.bytes, seconds: out.seconds };
    },
  });
  return recovered;
}

/** The design's Claude: the API key, or the subscription on the owner's test studio (as designForClient). */
function deps(): PremiumDeps {
  const test = process.env.STUDIO_ENV !== "production" && !process.env.ANTHROPIC_API_KEY?.trim();
  return { dataDir: CLIENT_PREMIUM_DIR, onQueued: () => loop?.poke(), ...(test ? { env: { ...process.env, ANTHROPIC_API_KEY: "subscription" }, transport: subscriptionTransport() } : {}) };
}

const ROW = { id: true, status: true, quality: true, parentId: true, credits: true, seconds: true, caption: true, hashtags: true, warnings: true, brief: true, error: true, durationMs: true, videoPath: true, createdAt: true, updatedAt: true, product: { select: { name: true } } } as const satisfies Prisma.VideoJobSelect;
type Row = Prisma.VideoJobGetPayload<{ select: typeof ROW }>;

/** A row in the owner's local Premium job shape (video-lab/premium-jobs.ts PremiumJob), as the Create page reads it. */
export function labPremiumJob(r: Row) {
  const brief = (r.brief ?? {}) as { say?: string; repairs?: string[]; music?: boolean };
  const status = r.status === "ready" ? "succeeded" : r.status === "cancelled" ? "failed" : (r.status as "designing" | "queued" | "rendering" | "failed");
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    status,
    progress: r.status === "ready" ? 1 : (premiumProgress(r.id) ?? 0),
    credits: r.credits,
    quality: r.quality ?? "540p",
    parentId: r.parentId,
    title: r.product?.name ?? "Premium 3D",
    seconds: r.seconds,
    caption: r.caption || null,
    hashtags: r.hashtags,
    say: brief.say || null,
    repairs: brief.repairs ?? [],
    warnings: (r.warnings ?? []) as unknown[],
    // Client clips get library music; their voice-over comes later (lib/video-studio/premium-jobs.ts).
    audio: { voice: false, music: brief.music !== false, voiceFile: null, voiceNote: null, voiceCredits: 0, musicFile: null, musicTitle: null },
    renderSeconds: null,
    bytes: null,
    videoFile: r.videoPath ? `${r.id}.mp4` : null,
    error: r.error,
  };
}

export async function listClientPremium(id: StudioIdentity) {
  const rows = await prisma.videoJob.findMany({ where: { businessId: id.businessId, engine: PREMIUM_ENGINE }, orderBy: { createdAt: "desc" }, take: 40, select: ROW });
  return rows.map(labPremiumJob);
}

export async function getClientPremium(id: StudioIdentity, jobId: string) {
  if (!CLIENT_ID.test(jobId)) return null;
  const row = await prisma.videoJob.findFirst({ where: { id: jobId, businessId: id.businessId, engine: PREMIUM_ENGINE }, select: ROW });
  return row ? labPremiumJob(row) : null;
}

/** The Create page's Premium request, checked against the business (photos are its Gallery photos). */
async function premiumInput(id: StudioIdentity, body: Record<string, unknown>): Promise<PremiumJobInput> {
  let photoPaths: string[] | undefined;
  if (Array.isArray(body.photoIds) && body.photoIds.length) {
    const wanted = body.photoIds.map(String).slice(0, 4);
    const assets = await prisma.mediaAsset.findMany({ where: { id: { in: wanted }, businessId: id.businessId, kind: "photo" }, select: { id: true, path: true } });
    photoPaths = wanted.flatMap((w) => assets.filter((a) => a.id === w).map((a) => a.path));
    if (!photoPaths.length) throw new ClientJobError("Use photos from your BuPulse gallery.", 400);
  }
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    productId: str(body.productId, 40),
    photoPaths,
    templateId: str(body.styleId, 40) || VIDEO_TEMPLATES[0].id,
    hookId: str(body.hookId, 40) || "auto",
    ratio: isRatio(body.ratio) ? body.ratio : "9:16",
    seconds: Math.min(8, Math.max(4, Number(body.seconds) || 6)),
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 600) : null,
    platform: isPlatform(body.platform) ? body.platform : null,
    purpose: body.purpose === "post" ? "post" : "ad",
    quality: isPremiumQuality(body.quality) ? body.quality : "540p",
    music: body.music !== false,
  };
}

export async function premiumForClient(id: StudioIdentity, body: Record<string, unknown>) {
  const owner = ownerOf(id);
  const input = await premiumInput(id, body);
  try {
    const jobId = await startPremiumJob(owner, input, deps());
    return (await getClientPremium(id, jobId))!;
  } catch (error) {
    throw await asClientError(error, PREMIUM_3D_CREDITS[input.quality], owner.userId);
  }
}

export async function rerenderForClient(id: StudioIdentity, jobId: string, body: Record<string, unknown>) {
  const owner = ownerOf(id);
  try {
    const childId = await rerenderPremiumJob(owner, jobId, isPremiumQuality(body.quality) ? body.quality : "720p", deps());
    return (await getClientPremium(id, childId))!;
  } catch (error) {
    throw await asClientError(error, PREMIUM_RERENDER_CREDITS, owner.userId);
  }
}
