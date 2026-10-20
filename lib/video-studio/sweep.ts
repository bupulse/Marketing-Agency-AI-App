import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { refundUsage } from "@/lib/usage";
import { sweepSeedanceJobs } from "./seedance-jobs";

// The Video Studio's sweep (/api/cron/video-jobs, docs/VIDEO_APP_INTEGRATION.md task 8): a design whose request died
// (the Worker stopped, the browser left) stays "designing" with its credits taken. Once its lease has passed it is
// failed and its credits are given back, exactly once: the job is claimed with a conditional update (still
// "designing", lease over, never refunded) before the refund, and the design request claims it the same way, so the
// two can never both refund it or both finish it. A voice-over's credits held on a job (lib/video-studio/voice.ts) are
// given back the same way once VOICE_LEASE_MS has passed. Seedance clips (lib/video-studio/seedance-jobs.ts): a submit
// that died before BytePlus answered, and a task BytePlus has ended, are failed with their credits back the same way
// (the studio's poller does the polling itself).

export const STRANDED_MESSAGE = "The design was interrupted before it finished. Your credits are back; please try again.";
/** How long a voice-over's credits may stay held on a job (lib/video-studio/voice.ts): well over its route's 120 s. */
export const VOICE_LEASE_MS = 10 * 60_000;
/** Jobs looked at per run; the rest wait for the next run. */
export const SWEEP_BATCH = 100;

export type SweepResult = { stranded: number; refunded: number; credits: number; refundErrors: number; voiceRefunded: number; voiceCredits: number; seedance?: { stranded: number; expired: number } };

export async function sweepVideoJobs(now = new Date()): Promise<SweepResult> {
  const stale = await prisma.videoJob.findMany({
    where: { status: "designing", leaseUntil: { lt: now }, refundedAt: null },
    orderBy: { leaseUntil: "asc" },
    take: SWEEP_BATCH,
    select: { id: true, credits: true, periodStart: true, business: { select: { userId: true } } },
  });
  const result: SweepResult = { stranded: 0, refunded: 0, credits: 0, refundErrors: 0, voiceRefunded: 0, voiceCredits: 0 };
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
  await sweepVoiceReservations(now, result);
  result.seedance = await sweepSeedanceJobs(now).catch(async (error: unknown) => {
    await logError(error, { source: "video.sweep.seedance" }).catch(() => {});
    return { stranded: 0, expired: 0 };
  });
  return result;
}

/** Voice reservations whose request died: cleared (compare-and-set on the reservation time), then refunded once. */
async function sweepVoiceReservations(now: Date, result: SweepResult): Promise<void> {
  const stale = await prisma.videoJob.findMany({
    where: { voiceCredits: { gt: 0 }, voiceReservedAt: { lt: new Date(now.getTime() - VOICE_LEASE_MS) } },
    orderBy: { voiceReservedAt: "asc" },
    take: SWEEP_BATCH,
    select: { id: true, voiceCredits: true, voicePeriodStart: true, voiceReservedAt: true, business: { select: { userId: true } } },
  });
  for (const job of stale) {
    const { count } = await prisma.videoJob.updateMany({
      where: { id: job.id, voiceReservedAt: job.voiceReservedAt, voiceCredits: { gt: 0 } },
      data: { voiceCredits: 0, voicePeriodStart: null, voiceReservedAt: null },
    });
    if (count !== 1 || !job.voicePeriodStart) continue; // settled by its request meanwhile
    try {
      await refundUsage(job.business.userId, "videoCredits", job.voicePeriodStart, job.voiceCredits);
      result.voiceRefunded += 1;
      result.voiceCredits += job.voiceCredits;
    } catch (error) {
      result.refundErrors += 1;
      await logError(error, { source: "video.sweep.voice" }).catch(() => {});
    }
  }
}
