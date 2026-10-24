import "server-only";
// The editor's real reels (docs/research/EDITOR.md): the finished ReelJobs to pick from, and one opened with the same
// server code the Videos page uses (reelView: the clips' signed links and the music; reelContact: how to reach the business).
import { prisma } from "@/lib/db";
import { reelContact, reelView, type ReelView } from "@/lib/reel-engine/engine";
import type { ReelLab } from "@/components/editor/lab-notes";

export const REELS_MAX = 20;

export type ReelChoice = { id: string; business: string; title: string; createdAt: string };
export type OpenedReel = { view: ReelView; brand: { name: string; color: string; contact: string | null }; lab: ReelLab };

const strings = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, max) : []);

/** What the Training Lab did to a reel, from its plan (engine.ts LabPlan); anything missing or malformed is left out. */
export function reelLab(plan: unknown): ReelLab {
  const p = (plan && typeof plan === "object" ? plan : {}) as Record<string, unknown>;
  const fixes = (Array.isArray(p.labSpellingFixes) ? p.labSpellingFixes : [])
    .flatMap((f): ReelLab["fixes"] => {
      const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      return typeof o.from === "string" && typeof o.to === "string" ? [{ where: typeof o.where === "string" ? o.where : "", from: o.from, to: o.to }] : [];
    })
    .slice(0, 20);
  const issues = (Array.isArray(p.languageIssues) ? p.languageIssues : []).map((i) => (i && typeof i === "object" ? (i as { message?: unknown }).message : null)).filter((m): m is string => typeof m === "string" && !!m.trim()).slice(0, 20);
  return { examplesRead: strings(p.labExampleIds, 1000).length, fixes, issues, avoid: strings(p.labAvoid) };
}

/** The 20 newest finished reels, from every business (the owner's test site). */
export async function listFinishedReels(): Promise<ReelChoice[]> {
  const jobs = await prisma.reelJob.findMany({ where: { status: "done" }, orderBy: { createdAt: "desc" }, take: REELS_MAX, select: { id: true, plan: true, createdAt: true, business: { select: { name: true } } } });
  return jobs.map((j) => ({ id: j.id, business: j.business.name, title: String((j.plan as { title?: unknown } | null)?.title ?? "").trim() || "Untitled reel", createdAt: j.createdAt.toISOString() }));
}

/** One finished reel with fresh signed links (they last an hour), or null. */
export async function openFinishedReel(id: string): Promise<OpenedReel | null> {
  const job = typeof id === "string" && id ? await prisma.reelJob.findFirst({ where: { id, status: "done" }, select: { id: true, businessId: true, plan: true, business: { select: { userId: true, name: true, brandColors: true } } } }) : null;
  if (!job) return null;
  const [view, contact] = await Promise.all([reelView({ userId: job.business.userId, businessId: job.businessId }, job.id), reelContact(job.businessId)]);
  if (!view) return null;
  // The brand colour as the Videos page picks it: the first valid hex, else the BuPulse green.
  const color = job.business.brandColors.find((c) => /^#[0-9a-f]{6}$/i.test(c)) ?? "#1B5E20";
  return { view, brand: { name: job.business.name, color, contact }, lab: reelLab(job.plan) };
}
