// Missed posts move to the next day (docs/CONTENT.md): a post planned for a business-local day that has passed and
// was not posted belongs to today. One that waited for the owner's OK waits again today ("Needs your OK"); an approved
// one gets today's best free time. After 3 moves, the next miss makes it EXPIRED: it never publishes, and "Use again"
// brings it back for today with its count reset. Runs from the hourly daily-posts cron (lib/daily-posts/service.ts),
// so each company's first run after its local midnight moves its posts; running again finds nothing left to move.
//
// Left alone: drafts (no day yet), posts being published or posted, cancelled ones, and NEEDS_ACTION and FAILED posts:
// those wait for the owner to do something (post it by hand, reconnect, retry), and moving them would not help.
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/errors";
import { bestTimesFor, scheduleAtFreeSlot } from "@/lib/publishing/service";
import { dayKey, isValidTimeZone, parseDayKey, zonedTimeToUtc } from "@/lib/publishing/time";
import { dayDate } from "./period";

/** Moves a missed post may have; the next miss expires it. */
export const MAX_CARRY_OVERS = 3;
/** The statuses that move: waiting for the owner's OK, or approved and waiting for their time. */
export const CARRIED_STATUSES = ["PENDING_APPROVAL", "SCHEDULED"] as const;
/** Posts moved per zone in one call; any left are moved by the next hourly run (the engine holds them meanwhile). */
const BATCH = 200;

export const NO_FREE_TIME_NOTE = "It missed its day and no free time was found today. Pick a time, then approve it.";

/** Local midnight that starts `day` in the zone. */
function midnight(day: string, zone: string): Date {
  const { year, month, day: d } = parseDayKey(day);
  return zonedTimeToUtc(year, month, d, 0, 0, zone);
}

/**
 * The posts whose day is before `today` and that still wait to go out: approved or waiting posts with a time before
 * today's midnight, and posts without a time planned for (or, never moved, made on) an earlier day.
 */
export function missedWhere(today: string, zone: string): Prisma.PostWhereInput {
  const start = midnight(today, zone);
  return {
    status: { in: [...CARRIED_STATUSES] },
    OR: [{ scheduledAt: { lt: start } }, { scheduledAt: null, plannedDay: { lt: dayDate(today) } }, { scheduledAt: null, plannedDay: null, createdAt: { lt: start } }],
  };
}

type Missed = { status: string; scheduledAt: Date | null; plannedDay: Date | null; createdAt: Date };

/** The same rule for one post (the tests and the query must agree). */
export function isMissed(post: Missed, today: string, zone: string): boolean {
  if (!(CARRIED_STATUSES as readonly string[]).includes(post.status)) return false;
  const start = midnight(today, zone);
  if (post.scheduledAt) return post.scheduledAt < start;
  if (post.plannedDay) return post.plannedDay < dayDate(today);
  return post.createdAt < start;
}

/** A missed post moves once more, or expires when it already moved MAX_CARRY_OVERS times. */
export function carryStep(carryCount: number): "move" | "expire" {
  return carryCount >= MAX_CARRY_OVERS ? "expire" : "move";
}

const SELECT = { id: true, businessId: true, network: true, connectionId: true, status: true, carryCount: true, updatedAt: true } satisfies Prisma.PostSelect;
type Row = Prisma.PostGetPayload<{ select: typeof SELECT }>;

export type CarryResult = { moved: number; expired: number; toReview: number };

/** Moves (or expires) these missed posts of one zone's companies, each written only if it has not changed since it was read. */
async function carry(rows: Row[], today: string, now: Date): Promise<CarryResult> {
  const out: CarryResult = { moved: 0, expired: 0, toReview: 0 };
  const plannedDay = dayDate(today);
  const approved = new Map<string, Row[]>();
  for (const p of rows) {
    const guard = { id: p.id, businessId: p.businessId, status: p.status, updatedAt: p.updatedAt };
    if (carryStep(p.carryCount) === "expire") {
      const { count } = await prisma.post.updateMany({ where: guard, data: { status: "EXPIRED", lockedAt: null, nextAttemptAt: null } });
      out.expired += count;
    } else if (p.status === "PENDING_APPROVAL") {
      // Its old time (if any) passed: approving it today picks the best time again.
      const { count } = await prisma.post.updateMany({ where: guard, data: { scheduledAt: null, plannedDay, carryCount: p.carryCount + 1 } });
      out.moved += count;
    } else approved.set(p.businessId, [...(approved.get(p.businessId) ?? []), p]);
  }
  for (const [businessId, posts] of approved) {
    const times = await bestTimesFor(businessId, posts, now);
    for (const p of posts) {
      const at = times.get(p.id);
      const where = { status: "SCHEDULED" as const, updatedAt: p.updatedAt };
      const result = at ? await scheduleAtFreeSlot(p, at, { businessId, where, data: { plannedDay, carryCount: p.carryCount + 1, nextAttemptAt: null }, now }) : "taken";
      if (result === "ok") out.moved += 1;
      else if (result === "taken") {
        // No free time today: it waits for the owner rather than staying on a day that passed.
        const { count } = await prisma.post.updateMany({
          where: { id: p.id, businessId, ...where },
          data: { status: "PENDING_APPROVAL", scheduledAt: null, plannedDay, carryCount: p.carryCount + 1, autoScheduledAt: null, nextAttemptAt: null, reviewNote: NO_FREE_TIME_NOTE },
        });
        out.toReview += count;
      }
    }
  }
  return out;
}

/**
 * Every company's missed posts, zone by zone (each company's "today" is its own). Companies waiting to be deleted or
 * suspended are left as they are, like the publisher leaves them. Safe to run twice: a moved post belongs to today.
 */
export async function carryOverMissedPosts(now = new Date()): Promise<CarryResult> {
  const out: CarryResult = { moved: 0, expired: 0, toReview: 0 };
  const zones = await prisma.business.findMany({ distinct: ["timezone"], select: { timezone: true }, take: 500 });
  for (const { timezone } of zones) {
    // The app reads a missing or unknown zone as UTC (business.timezone || "UTC").
    const zone = timezone && isValidTimeZone(timezone) ? timezone : "UTC";
    const today = dayKey(now, zone);
    try {
      const rows = await prisma.post.findMany({
        where: { ...missedWhere(today, zone), business: { timezone, user: { deletionScheduledFor: null, suspendedAt: null } } },
        orderBy: { createdAt: "asc" },
        take: BATCH,
        select: SELECT,
      });
      const r = await carry(rows, today, now);
      out.moved += r.moved;
      out.expired += r.expired;
      out.toReview += r.toReview;
    } catch (error) {
      // One zone's trouble must not stop the others (or the daily posts after this).
      await logError(error, { source: "content.carry-over", level: "warn" });
    }
  }
  return out;
}
