import "server-only";
import { recipeWhy, type ViralRecipe } from "@/lib/video-engine/brain/viral";
import type { MotionSpec } from "@/lib/video-engine/spec";

// A Video Studio job as the app shows it, and the studio's error, apart from jobs.ts (which re-exports them): the
// voice-over, the schedule, the library and the Seedance jobs need these, not the designer, so the routes that use only
// them (the voice route, the video-jobs cron) do not carry the whole engine in the Cloudflare Worker (docs/DEPLOY.md).

export class VideoStudioError extends Error {
  constructor(
    message: string,
    public code: "unavailable" | "not_found" | "invalid",
    public status: number,
  ) {
    super(message);
    this.name = "VideoStudioError";
  }
}

export type VideoJobView = {
  id: string;
  status: string;
  engine: string;
  spec: MotionSpec | null;
  caption: string;
  hashtags: string[];
  warnings: unknown;
  score: unknown;
  captionScore: unknown;
  credits: number;
  error: string | null;
  parentId: string | null;
  productId: string | null;
  templateId: string | null;
  platform: string | null;
  ratio: string;
  seconds: number;
  /** The MP4 in the Gallery, once the browser made it (status "ready"). */
  videoPath: string | null;
  /** Whether the owner asked for a voice-over (the MP4 step then records it). */
  voice: boolean;
  /** The library track in the MP4 (its title, and the credit line its licence asks for, if any). */
  music: { trackId: string; title: string; credit: string | null } | null;
  /** A viral video's "Why this video" lines (plain English, no names) and the viral ids its techniques came from. */
  viral: { why: string[]; sources: string[] } | null;
  createdAt: string;
};

/** The company account (Business.userId, whose credits are used), the person, and the business. */
export type StudioOwner = { userId: string; actorId: string; businessId: string };

export type JobRow = { id: string; status: string; engine: string; spec: unknown; caption: string; hashtags: string[]; warnings: unknown; score: unknown; captionScore: unknown; credits: number; error: string | null; parentId: string | null; productId?: string | null; templateId?: string | null; platform?: string | null; ratio?: string; seconds?: number; videoPath?: string | null; brief?: unknown; music?: unknown; createdAt: Date };

function musicOf(v: unknown): VideoJobView["music"] {
  const m = v as { trackId?: unknown; title?: unknown; attribution?: unknown; owned?: unknown } | null | undefined;
  if (!m || typeof m.trackId !== "string" || typeof m.title !== "string") return null;
  return { trackId: m.trackId, title: m.title, credit: m.owned === false && typeof m.attribution === "string" && m.attribution.trim() ? m.attribution : null };
}

export const view = (j: JobRow): VideoJobView => ({
  id: j.id,
  status: j.status,
  engine: j.engine,
  spec: (j.spec as MotionSpec | null) ?? null,
  caption: j.caption,
  hashtags: j.hashtags,
  warnings: j.warnings,
  score: j.score,
  captionScore: j.captionScore,
  credits: j.credits,
  error: j.error,
  parentId: j.parentId,
  productId: j.productId ?? null,
  templateId: j.templateId ?? null,
  platform: j.platform ?? null,
  ratio: j.ratio ?? "9:16",
  seconds: j.seconds ?? 15,
  videoPath: j.videoPath ?? null,
  voice: (j.brief as { voice?: unknown } | null | undefined)?.voice !== false,
  music: musicOf(j.music),
  viral: viralOf(j.brief),
  createdAt: j.createdAt.toISOString(),
});

/** The recipe a job's brief keeps (styleId "viral"), or null. */
export function recipeOf(brief: unknown): ViralRecipe | null {
  const r = (brief as { recipe?: ViralRecipe } | null | undefined)?.recipe;
  return r && r.version === 1 && Array.isArray(r.sources) && Array.isArray(r.beats) ? r : null;
}
function viralOf(brief: unknown): VideoJobView["viral"] {
  const r = recipeOf(brief);
  return r ? { why: recipeWhy(r), sources: r.sources.map((s) => s.id) } : null;
}
