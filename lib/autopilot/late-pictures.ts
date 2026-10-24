// Autopilot's AI pictures on hosts with a short request limit (Netlify: 60 s; docs/CONTENT_VISUALS.md "Autopilot on
// Netlify"). There the weekly run does not paint (one AI picture takes 40 to 100 s): each group's posts get the owner's
// photo, and the group's visual waits as a pending AI picture (plan.deferredFrom). This sweep finishes those visuals one
// AI step per call (renderImageStep), and a finished picture replaces only the photo it stood in for (attachToGroup with
// onlyFrom: never a picture the owner picked, never a post already out).
import "server-only";
import { prisma } from "@/lib/db";
import { readImagePlan } from "@/lib/visuals/direction";
import { renderImageStep } from "@/lib/visuals/service";

/** The time one sweep call works for: Netlify stops the route at 60 s, and a step that started may take one AI call. */
export const LATE_PICTURES_BUDGET_MS = 25_000;
/** Pending group visuals read per call: enough for a few businesses' weeks, small when there is nothing to do. */
const BATCH = 20;

const pendingWhere = { groupId: { not: null }, kind: { in: ["image", "carousel"] }, status: "pending" };

export type LatePicturesResult = { checked: number; stepped: number; ready: number; nextCursor: string | null };

/**
 * One sweep call: steps the pending Autopilot pictures (oldest first) until the budget is used. Answers at once, after one
 * small read, when none are waiting. `nextCursor` is set while some are left, so the cron runner calls again.
 */
export async function finishLatePictures(options: { now?: Date; budgetMs?: number } = {}): Promise<LatePicturesResult> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const budget = options.budgetMs ?? LATE_PICTURES_BUDGET_MS;
  const rows = await prisma.contentVisual.findMany({
    where: { ...pendingWhere, OR: [{ renderingUntil: null }, { renderingUntil: { lt: now } }] },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: { id: true, businessId: true, plan: true, business: { select: { userId: true } } },
  });
  // Only the pictures Autopilot left for later; other pending visuals are drawn when the owner opens them.
  const late = rows.filter((r) => readImagePlan(r.plan)?.deferredFrom);
  const result: LatePicturesResult = { checked: late.length, stepped: 0, ready: 0, nextCursor: null };
  for (const row of late) {
    const left = budget - (Date.now() - started);
    if (left <= 0) break;
    const step = await renderImageStep({ userId: row.business.userId, businessId: row.businessId, service: true }, row.id, { budgetMs: left });
    result.stepped += 1;
    if (step.status === "ready") result.ready += 1;
  }
  if (result.checked > result.ready) result.nextCursor = "more";
  return result;
}
