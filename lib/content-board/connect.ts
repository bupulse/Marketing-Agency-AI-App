// "Publish automatically" (docs/CONTENT.md): posts made for an app that was not connected become normal posts of the
// account now connected for it. A scheduled one is never left to go out at a time that passed or that clashes, and is
// checked by the safety rules first: it is taken back to review while it is re-checked, then scheduled again (its own
// time when still ahead and free, else the best time), or left in review with the reason.
import "server-only";
import { prisma } from "@/lib/db";
import { accountUsable, bestTimesFor, scheduleAtFreeSlot, type Owner } from "@/lib/publishing/service";
import { LEAD_MINUTES } from "@/lib/publishing/best-time";
import { SAFETY_SELECT, safetyReasons } from "./auto";

export const NO_FREE_TIME = "No free time was found for this post on the account. Pick a time and approve it.";

export async function connectByHandPosts(owner: Owner, postIds: string[], now = new Date()): Promise<{ switched: number; rescheduled: number; toReview: number }> {
  const out = { switched: 0, rescheduled: 0, toReview: 0 };
  const ids = [...new Set(postIds)].slice(0, 200);
  if (ids.length === 0) return out;
  const [posts, connections] = await Promise.all([
    prisma.post.findMany({ where: { id: { in: ids }, businessId: owner.businessId, remindOnly: true, connectionId: null, status: { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED"] }, lockedAt: null }, select: { id: true, network: true, status: true, scheduledAt: true } }),
    prisma.connection.findMany({ where: { businessId: owner.businessId, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } }),
  ]);
  const toCheck: { id: string; scheduledAt: Date | null }[] = [];
  for (const post of posts) {
    const account = connections.find((c) => c.provider === post.network && accountUsable(c) && c.postingMode === "AUTO") ?? connections.find((c) => c.provider === post.network && accountUsable(c));
    if (!account) continue;
    const scheduled = post.status === "SCHEDULED";
    // A scheduled post leaves the publisher's queue while it is re-checked, so it can never go out stale meanwhile.
    const { count } = await prisma.post.updateMany({
      where: { id: post.id, businessId: owner.businessId, remindOnly: true, connectionId: null, status: post.status, lockedAt: null },
      data: { connectionId: account.id, remindOnly: false, ...(scheduled ? { status: "PENDING_APPROVAL" as const } : {}) },
    });
    if (count === 0) continue;
    out.switched += 1;
    if (scheduled) toCheck.push({ id: post.id, scheduledAt: post.scheduledAt });
  }
  if (toCheck.length === 0) return out;

  const rows = await prisma.post.findMany({ where: { id: { in: toCheck.map((p) => p.id) }, businessId: owner.businessId, status: "PENDING_APPROVAL" }, select: SAFETY_SELECT });
  const reasons = await safetyReasons(owner.businessId, rows);
  const earliest = now.getTime() + LEAD_MINUTES * 60_000;
  const stale = rows.filter((r) => !reasons.get(r.id) && (!r.scheduledAt || r.scheduledAt.getTime() < earliest));
  const best = await bestTimesFor(owner.businessId, stale, now);
  for (const row of rows) {
    const where = { status: "PENDING_APPROVAL" as const, updatedAt: row.updatedAt };
    const reason = reasons.get(row.id);
    if (reason) {
      await prisma.post.updateMany({ where: { id: row.id, businessId: owner.businessId, ...where }, data: { reviewNote: reason } });
      out.toReview += 1;
      continue;
    }
    const at = best.get(row.id) ?? row.scheduledAt;
    const outcome = at ? await scheduleAtFreeSlot(row, at, { businessId: owner.businessId, where, data: { status: "SCHEDULED", reviewNote: null }, now }) : "taken";
    if (outcome === "ok") out.rescheduled += 1;
    else {
      if (outcome === "taken") await prisma.post.updateMany({ where: { id: row.id, businessId: owner.businessId, ...where }, data: { reviewNote: NO_FREE_TIME } });
      out.toReview += 1;
    }
  }
  return out;
}
