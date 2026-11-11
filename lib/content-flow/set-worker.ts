// The day's shared set is drawn on the server, right away (owner decision, 11 November 2026: "made on the server, right
// away ... they finish even if the page is closed"). Until now pictures were drawn only while the content page was
// open (components/visuals/content-visual.tsx called renderVisual step by step).
// - Pressing Create (and the nightly Daily posts) starts the drawing after the answer is sent (Next's after()): every
//   picture of the set one AI step at a time, side by side, until the set is ready; the reel is then planned from the
//   pictures (lib/content-flow/set-reel.ts) and the posts take them (attachToGroup).
// - A DueJob ("visuals.day-set") is the safety net: the every-minute job loop (/api/cron/publish -> runDueJobs)
//   carries a set on, one round of steps per call, when the server restarted or after() could not run (scripts).
// - The browser still draws when the page is open (a harmless speed-up): the drawing lease (renderImageStep) lets only
//   one drawer work on a set at a time, so nothing is ever painted or paid for twice.
import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { cancelJob, registerJobHandler, scheduleJob } from "@/lib/jobs/due";
import { renderImageStep } from "@/lib/visuals/service";

export const SET_JOB = "visuals.day-set";
const jobKey = (groupId: string) => `dayset:${groupId}`;
/** The safety net's first look: after the server's own drawing had time to finish a normal set. */
export const SET_JOB_DELAY_MS = 3 * 60_000;
/** A server drawing stops after this long (a set of 4 pictures takes about 1 to 2 minutes); the job carries on. */
export const SET_DRAW_MS = 10 * 60_000;
/** Steps (rounds of one AI call per picture) one job call takes, so the job loop's minute is not held long. */
const JOB_STEPS = 1;
/** How long the server waits when the browser is drawing the set's step. */
const BUSY_WAIT_MS = 3000;

export type SetDrawOutcome = "ready" | "failed" | "pending" | "busy" | "missing";

/**
 * Draws a set's pictures until ready, failed, out of time or out of steps. "busy": another drawer (the browser, the
 * other path) holds it right now.
 */
export async function drawSet(businessId: string, groupId: string, limits: { budgetMs?: number; maxSteps?: number } = {}): Promise<SetDrawOutcome> {
  const row = await prisma.contentVisual.findFirst({
    where: { businessId, groupId, kind: { not: "video" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, business: { select: { userId: true } } },
  });
  if (!row) return "missing";
  if (row.status !== "pending") return row.status === "ready" ? "ready" : "failed";
  const owner = { userId: row.business.userId, businessId, service: true };
  const started = Date.now();
  const budget = limits.budgetMs ?? SET_DRAW_MS;
  for (let steps = 0; steps < (limits.maxSteps ?? Number.POSITIVE_INFINITY) && Date.now() - started < budget; steps++) {
    const step = await renderImageStep(owner, row.id, { parallel: true, budgetMs: budget });
    if (step.status === "rendering") {
      // The browser holds it for one step: the server waits a moment and carries on (the job path just comes back).
      if (limits.maxSteps !== undefined) return "busy";
      await new Promise((resolve) => setTimeout(resolve, BUSY_WAIT_MS));
      continue;
    }
    if (step.status === "ready") return "ready";
    if (step.status === "failed") return "failed";
  }
  return "pending";
}

/** Draws the sets now (in the background of the current request) and schedules the safety net for each. */
export async function startSets(businessId: string, groupIds: readonly string[], now = new Date()): Promise<void> {
  if (groupIds.length === 0) return;
  for (const groupId of groupIds) {
    await scheduleJob({ kind: SET_JOB, runAt: new Date(now.getTime() + SET_JOB_DELAY_MS), payload: { groupId }, businessId, dedupeKey: jobKey(groupId) }).catch((e) =>
      logError(e, { source: "content-flow.set-job", level: "warn", businessId }),
    );
  }
  const work = async () => {
    await Promise.all(
      groupIds.map(async (groupId) => {
        try {
          const outcome = await drawSet(businessId, groupId);
          if (outcome === "ready" || outcome === "failed" || outcome === "missing") await cancelJob(jobKey(groupId)).catch(() => undefined);
        } catch (error) {
          await logError(error, { source: "content-flow.set-draw", level: "warn", businessId });
        }
      }),
    );
  };
  try {
    after(work);
  } catch {
    // Outside a request (a script or a test): the job loop draws the sets.
  }
}

/** The safety net: one round of steps per call, then again a minute later while the set is not finished. */
registerJobHandler(SET_JOB, async (job) => {
  const groupId = (job.payload as { groupId?: unknown } | null)?.groupId;
  if (!job.businessId || typeof groupId !== "string") return;
  const outcome = await drawSet(job.businessId, groupId, { maxSteps: JOB_STEPS });
  if (outcome === "pending" || outcome === "busy") await scheduleJob({ kind: SET_JOB, runAt: new Date(Date.now() + 60_000), payload: { groupId }, businessId: job.businessId, dedupeKey: jobKey(groupId) });
});
