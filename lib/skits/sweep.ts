// The skits' part of the video-jobs cron (/api/cron/video-jobs: every 10 minutes on Netlify, 4 on Cloudflare): skits
// not recorded on their day move on (or expire), today's skits are written for the companies whose skit day it is (a
// few per call: one text call each), "Record your skit" notices go out from the morning, recorded skits start their
// video once the switch is on, and videos being made are checked. Idempotent: every step claims its rows.
import "server-only";
import { prisma } from "@/lib/db";
import { featureStatus } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { hasShortRequestLimit, timeBudget } from "@/lib/platform/limits";
import { carryOverSkits, checkSkitVideo, sendSkitNotice, skitCompanies, skitDue, skitVideosOn, startSkitVideo, writeDaySkit, type SkitCarry } from "./service";

export type SkitSweep = { carried: SkitCarry; written: number; notices: number; started: number; ready: number; failed: number };

/** One call writes no new skit after this long (each is one text call of a few seconds). */
const WRITE_BUDGET_MS = 30_000;
/** A skit MAKING without a request id for this long was interrupted. */
export const STALE_MAKING_MS = 30 * 60 * 1000;

export async function sweepSkits(options: { now?: Date; writeLimit?: number; budgetMs?: number } = {}): Promise<SkitSweep> {
  const now = options.now ?? new Date();
  const started = Date.now();
  const budget = options.budgetMs ?? timeBudget(WRITE_BUDGET_MS, 15_000);
  const writeLimit = options.writeLimit ?? (hasShortRequestLimit() ? 2 : 5);
  const out: SkitSweep = { carried: { moved: 0, expired: 0 }, written: 0, notices: 0, started: 0, ready: 0, failed: 0 };
  const step = async <T>(source: string, run: () => Promise<T>, fallback: T): Promise<T> =>
    run().catch(async (error) => {
      await logError(error, { source: `skits.sweep.${source}`, level: "warn" });
      return fallback;
    });

  out.carried = await step("carry", () => carryOverSkits(now), out.carried);

  // Today's skits, a few per call: the next call (minutes later) writes the rest.
  await step(
    "write",
    async () => {
      for (const company of await skitCompanies()) {
        if (out.written >= writeLimit || Date.now() - started > budget) break;
        const day = await skitDue(company, now);
        if (!day) continue;
        // The skit is a video: only while the plan's Video feature is usable (a read-only account answers not_in_plan).
        if ((await featureStatus(company.id, "video")) !== "ok") continue;
        if (await writeDaySkit(company.id, day, now)) out.written += 1;
      }
    },
    undefined,
  );

  await step(
    "notices",
    async () => {
      const waiting = await prisma.skit.findMany({ where: { status: "WAITING_VOICE", notifiedAt: null }, orderBy: { plannedDay: "asc" }, take: 50, select: { id: true } });
      for (const s of waiting) if (await sendSkitNotice(s.id, now).catch(() => false)) out.notices += 1;
    },
    undefined,
  );

  // Recorded skits wait while the switch is off; once it is on, they start here (and right after the last voice note).
  if (await skitVideosOn().catch(() => false)) {
    await step(
      "start",
      async () => {
        const recorded = await prisma.skit.findMany({ where: { status: "VOICE_RECEIVED" }, orderBy: { voiceAt: "asc" }, take: 5, select: { id: true } });
        for (const s of recorded) if ((await startSkitVideo(s.id, now)) === "started") out.started += 1;
      },
      undefined,
    );
  }

  await step(
    "check",
    async () => {
      // A start or a copy that died part-way leaves MAKING without a request id: failed for BuPulse to look at, never sent
      // again on its own (Higgsfield may have taken, and billed, the first one).
      const stale = await prisma.skit.updateMany({ where: { status: "MAKING", taskId: null, updatedAt: { lt: new Date(now.getTime() - STALE_MAKING_MS) } }, data: { status: "FAILED", error: "Making the video was interrupted." } });
      out.failed += stale.count;
      const making = await prisma.skit.findMany({ where: { status: "MAKING", taskId: { not: null } }, orderBy: { taskStartedAt: "asc" }, take: 10, select: { id: true } });
      for (const s of making) {
        const r = await checkSkitVideo(s.id, now);
        if (r === "ready") out.ready += 1;
        else if (r === "failed") out.failed += 1;
      }
    },
    undefined,
  );
  return out;
}
