import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { refundUsage } from "@/lib/usage";

// The Video Studio's sweep (/api/cron/video-jobs, docs/VIDEO_APP_INTEGRATION.md task 8): a design whose request died
// (the Worker stopped, the browser left) stays "designing" with its credits taken. Once its lease has passed it is
// failed and its credits are given back, exactly once: the job is claimed with a conditional update (still
// "designing", lease over, never refunded) before the refund, and the design request claims it the same way, so the
// two can never both refund it or both finish it. Later this cron also polls Seedance.

export const STRANDED_MESSAGE = "The design was interrupted before it finished. Your credits are back; please try again.";
/** Jobs looked at per run; the rest wait for the next run. */
export const SWEEP_BATCH = 100;

export type SweepResult = { stranded: number; refunded: number; credits: number; refundErrors: number };

export async function sweepVideoJobs(now = new Date()): Promise<SweepResult> {
  const stale = await prisma.videoJob.findMany({
    where: { status: "designing", leaseUntil: { lt: now }, refundedAt: null },
    orderBy: { leaseUntil: "asc" },
    take: SWEEP_BATCH,
    select: { id: true, credits: true, periodStart: true, business: { select: { userId: true } } },
  });
  const result: SweepResult = { stranded: 0, refunded: 0, credits: 0, refundErrors: 0 };
  for (const job of stale) {
    const { count } = await prisma.videoJob.updateMany({
      where: { id: job.id, status: "designing", leaseUntil: { lt: now }, refundedAt: null },
      data: { status: "failed", error: STRANDED_MESSAGE, refundedAt: now, leaseUntil: null },
    });
    if (count !== 1) continue; // the design finished, or another run took it, meanwhile
    result.stranded += 1;
    if (job.credits <= 0 || !job.periodStart) continue;
    try {
      await refundUsage(job.business.userId, "videoCredits", job.periodStart, job.credits);
      result.refunded += 1;
      result.credits += job.credits;
    } catch (error) {
      result.refundErrors += 1;
      await logError(error, { source: "video.sweep" }).catch(() => {});
    }
  }
  return result;
}
