// What Admin -> Ad Brain does: start an ad for the BuPulse company account (owner decision: the Ad Brain markets
// BuPulse only), list the ads with their status, cost and judge scores, cancel one, move them on now, and load the
// real dashboard captures until the screen robot (phase 2) takes them.
import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Edl } from "./edl";
import { companyAccount, listScreens, seedPrototypeScreens } from "./facts";
import { isFixtureName } from "./fixtures";
import { adLimits, monthSpentUsd, sweepAdJobs, TERMINAL } from "./pipeline";
import { GALLERY_VIDEO_BUCKET } from "@/lib/media/rules";

export class AdBrainError extends Error {}

/** Ads being made at once: one (each runs a renderer and up to four paid calls). */
export const MAX_OPEN = 1;

export async function startAdJob(input: { createdBy: string; notes?: string; fixture?: string | null }): Promise<{ id: string }> {
  const account = await companyAccount();
  const open = await prisma.adJob.count({ where: { status: { notIn: [...TERMINAL] } } });
  if (open >= MAX_OPEN) throw new AdBrainError("An ad is already being made. Wait for it to finish (or cancel it) first.");
  if (input.fixture && !isFixtureName(input.fixture)) throw new AdBrainError("There is no cached plan with that name.");
  const notes = (input.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const job = await prisma.adJob.create({
    data: { businessId: account.businessId, createdBy: input.createdBy.slice(0, 120), mode: input.fixture ? `fixture:${input.fixture}` : "real", brief: { notes, goal: null } as Prisma.InputJsonValue, log: [{ at: new Date().toISOString(), step: "queued", note: input.fixture ? `Queued from the cached plan "${input.fixture}".` : `Queued${notes ? `: ${notes}` : ""}.` }] as Prisma.InputJsonValue },
    select: { id: true },
  });
  return job;
}

export async function cancelAdJob(id: string): Promise<void> {
  const { count } = await prisma.adJob.updateMany({ where: { id, status: { notIn: [...TERMINAL] } }, data: { status: "cancelled", error: "Cancelled by an admin.", leaseUntil: null } });
  if (count === 0) throw new AdBrainError("That ad is already finished.");
}

export type AdJobView = {
  id: string;
  status: string;
  mode: string;
  createdAt: string;
  createdBy: string | null;
  costUsd: number;
  recipe: string | null;
  effects: string[];
  line: string | null;
  overall: number | null;
  scores: Record<string, number> | null;
  checks: Record<string, boolean> | null;
  error: string | null;
  log: { at: string; step: string; note: string }[];
  seconds: number | null;
  segments: { id: string; start: number; end: number; source: string; tags?: Record<string, string | undefined> }[];
  voice: { text: string; at: number; source: string; cta: boolean }[];
  caption: string;
  hashtags: string[];
  videoUrl: string | null;
  postGroupId: string | null;
};

/** The latest ads, newest first, with a signed link to each finished MP4 (an hour). */
export async function listAdJobs(limit = 20): Promise<AdJobView[]> {
  const rows = await prisma.adJob.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const paths = rows.flatMap((r) => (r.videoPath ? [r.videoPath] : []));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).createSignedUrls(paths, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  return rows.map((r) => {
    const concept = (r.concept ?? null) as { recipe?: string; effects?: string[]; line?: string } | null;
    const last = ((r.scores ?? []) as { overall?: number; scores?: Record<string, number>; checks?: Record<string, boolean> }[]).at(-1);
    const plan = (r.plan ?? null) as Edl | null;
    return {
      id: r.id,
      status: r.status,
      mode: r.mode,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      costUsd: Number(r.costUsd),
      recipe: concept?.recipe ?? null,
      effects: concept?.effects ?? [],
      line: concept?.line ?? null,
      overall: last?.overall ?? null,
      scores: last?.scores ?? null,
      checks: last?.checks ?? null,
      error: r.error,
      log: ((r.log ?? []) as AdJobView["log"]).slice(-30),
      seconds: plan?.canvas.seconds ?? null,
      segments: (plan?.segments ?? []).map((s) => ({ id: s.id, start: s.start, end: s.end, source: s.source, tags: s.tags })),
      voice: (plan?.voice ?? []).map((v) => ({ text: v.text, at: v.at, source: v.source, cta: v.cta })),
      caption: r.caption,
      hashtags: r.hashtags,
      videoUrl: r.videoPath ? (urls.get(r.videoPath) ?? null) : null,
      postGroupId: r.postGroupId,
    };
  });
}

export async function adBrainOverview(): Promise<{ limits: { perAdUsd: number; monthlyUsd: number }; monthSpentUsd: number; screens: number; account: { email: string; name: string } | { error: string } }> {
  const [limits, spent, screens, account] = await Promise.all([adLimits(), monthSpentUsd(), listScreens().then((s) => s.length), companyAccount().then((a) => ({ email: process.env.AD_BRAIN_COMPANY_EMAIL?.trim() || "office@bupulse.com", name: a.name })).catch((e: Error) => ({ error: e.message }))]);
  return { limits, monthSpentUsd: spent, screens, account };
}

/** "Move it on now": one sweep from Admin (the video-jobs cron does the same every few minutes). */
export const runAdJobsNow = () => sweepAdJobs({ budgetMs: 100_000 });

export const loadRealCaptures = () => seedPrototypeScreens(null);
