import "server-only";
// The editor's real reels (docs/research/EDITOR.md): the finished ReelJobs to pick from, and one opened with the same
// server code the Videos page uses (reelView: the clips' signed links and the music; reelContact: how to reach the business).
import { prisma } from "@/lib/db";
import { reelContact, reelView, type ReelView } from "@/lib/reel-engine/engine";

export const REELS_MAX = 20;

export type ReelChoice = { id: string; business: string; title: string; createdAt: string };
export type OpenedReel = { view: ReelView; brand: { name: string; color: string; contact: string | null } };

/** The 20 newest finished reels, from every business (the owner's test site). */
export async function listFinishedReels(): Promise<ReelChoice[]> {
  const jobs = await prisma.reelJob.findMany({ where: { status: "done" }, orderBy: { createdAt: "desc" }, take: REELS_MAX, select: { id: true, plan: true, createdAt: true, business: { select: { name: true } } } });
  return jobs.map((j) => ({ id: j.id, business: j.business.name, title: String((j.plan as { title?: unknown } | null)?.title ?? "").trim() || "Untitled reel", createdAt: j.createdAt.toISOString() }));
}

/** One finished reel with fresh signed links (they last an hour), or null. */
export async function openFinishedReel(id: string): Promise<OpenedReel | null> {
  const job = typeof id === "string" && id ? await prisma.reelJob.findFirst({ where: { id, status: "done" }, select: { id: true, businessId: true, business: { select: { userId: true, name: true, brandColors: true } } } }) : null;
  if (!job) return null;
  const [view, contact] = await Promise.all([reelView({ userId: job.business.userId, businessId: job.businessId }, job.id), reelContact(job.businessId)]);
  if (!view) return null;
  // The brand colour as the Videos page picks it: the first valid hex, else the BuPulse green.
  const color = job.business.brandColors.find((c) => /^#[0-9a-f]{6}$/i.test(c)) ?? "#1B5E20";
  return { view, brand: { name: job.business.name, color, contact } };
}
