import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findMany: vi.fn(), findUnique: vi.fn() },
  post: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
}));
const publishing = vi.hoisted(() => ({ bestTimesFor: vi.fn(), scheduleAtFreeSlot: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
// The real service (for "Use again"), with the best-time picker and the slot claim stubbed.
vi.mock("@/lib/publishing/service", async () => ({ ...(await vi.importActual<object>("@/lib/publishing/service")), ...publishing }));

import { carryOverMissedPosts, carryStep, isMissed, MAX_CARRY_OVERS, missedWhere, NO_FREE_TIME_NOTE } from "@/lib/content-board/carry-over";
import { PublishingError, reusePost } from "@/lib/publishing/service";

// 00:20 on Saturday 31 October 2026 in Kigali (UTC+2): Friday has just ended there.
const now = new Date("2026-10-30T22:20:00Z");
const midnight = new Date("2026-10-30T22:00:00Z");
const today = new Date("2026-10-31T00:00:00Z"); // Post.plannedDay (a DATE)
const read = new Date("2026-10-30T21:00:00Z"); // updatedAt when the run read the post
const KIGALI = "Africa/Kigali";

type Row = { id: string; businessId: string; network: string; connectionId: string | null; status: string; carryCount: number; updatedAt: Date };
const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, businessId: "b1", network: "facebook", connectionId: `c-${id}`, status: "PENDING_APPROVAL", carryCount: 0, updatedAt: read, ...extra });

let missed: Row[] = [];
const updates = () => prisma.post.updateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> });

beforeEach(() => {
  vi.clearAllMocks();
  missed = [];
  prisma.business.findMany.mockResolvedValue([{ timezone: KIGALI }]);
  prisma.post.findMany.mockImplementation(async () => missed);
  prisma.post.updateMany.mockResolvedValue({ count: 1 });
  publishing.bestTimesFor.mockImplementation(async (_b: string, posts: Row[]) => new Map(posts.map((p) => [p.id, new Date("2026-10-31T16:00:00Z")])));
  publishing.scheduleAtFreeSlot.mockResolvedValue("ok");
});

describe("which posts missed their day", () => {
  const post = (extra: Partial<{ status: string; scheduledAt: Date | null; plannedDay: Date | null; createdAt: Date }> = {}) => ({
    status: "PENDING_APPROVAL",
    scheduledAt: null,
    plannedDay: null,
    createdAt: new Date("2026-10-30T08:00:00Z"),
    ...extra,
  });

  it("an approved post whose time was before today's local midnight, and a waiting one made on an earlier day", () => {
    expect(isMissed(post({ status: "SCHEDULED", scheduledAt: new Date("2026-10-30T21:59:00Z") }), "2026-10-31", KIGALI)).toBe(true);
    expect(isMissed(post({ status: "SCHEDULED", scheduledAt: midnight }), "2026-10-31", KIGALI)).toBe(false);
    expect(isMissed(post(), "2026-10-31", KIGALI)).toBe(true);
    // Made at 00:10 Kigali time on Saturday: today's.
    expect(isMissed(post({ createdAt: new Date("2026-10-30T22:10:00Z") }), "2026-10-31", KIGALI)).toBe(false);
  });

  it("a post a missed day already moved belongs to its planned day, not the day it was made", () => {
    expect(isMissed(post({ plannedDay: today, createdAt: new Date("2026-10-28T08:00:00Z") }), "2026-10-31", KIGALI)).toBe(false);
    expect(isMissed(post({ plannedDay: new Date("2026-10-30T00:00:00Z") }), "2026-10-31", KIGALI)).toBe(true);
  });

  it("leaves drafts, posts going out or gone out, cancelled, expired, NEEDS_ACTION and FAILED posts alone", () => {
    for (const status of ["DRAFT", "PUBLISHING", "PUBLISHED", "CANCELLED", "EXPIRED", "NEEDS_ACTION", "FAILED"]) {
      expect(isMissed(post({ status, scheduledAt: new Date("2026-10-29T08:00:00Z") }), "2026-10-31", KIGALI)).toBe(false);
    }
  });

  it("the database query says the same", () => {
    expect(missedWhere("2026-10-31", KIGALI)).toEqual({
      status: { in: ["PENDING_APPROVAL", "SCHEDULED"] },
      OR: [{ scheduledAt: { lt: midnight } }, { scheduledAt: null, plannedDay: { lt: today } }, { scheduledAt: null, plannedDay: null, createdAt: { lt: midnight } }],
    });
  });

  it("moves 3 times, then the 4th miss expires it", () => {
    expect(MAX_CARRY_OVERS).toBe(3);
    expect([0, 1, 2, 3, 4].map(carryStep)).toEqual(["move", "move", "move", "expire", "expire"]);
  });
});

describe("carryOverMissedPosts", () => {
  it("looks up each zone's missed posts with its own today, skipping accounts being deleted or suspended", async () => {
    prisma.business.findMany.mockResolvedValue([{ timezone: KIGALI }, { timezone: "not/a-zone" }]);
    await carryOverMissedPosts(now);
    const wheres = prisma.post.findMany.mock.calls.map((c) => c[0].where);
    expect(wheres[0]).toEqual({ ...missedWhere("2026-10-31", KIGALI), business: { timezone: KIGALI, user: { deletionScheduledFor: null, suspendedAt: null } } });
    // An unknown zone counts as UTC, where it is still Friday 30 October.
    expect(wheres[1]).toEqual({ ...missedWhere("2026-10-30", "UTC"), business: { timezone: "not/a-zone", user: { deletionScheduledFor: null, suspendedAt: null } } });
  });

  it("a post that waited for the owner's OK waits again today, with no old time and one more move", async () => {
    missed = [row("p", { carryCount: 1 })];
    expect(await carryOverMissedPosts(now)).toEqual({ moved: 1, expired: 0, toReview: 0 });
    expect(updates()).toEqual([
      { where: { id: "p", businessId: "b1", status: "PENDING_APPROVAL", updatedAt: read }, data: { scheduledAt: null, plannedDay: today, carryCount: 2 } },
    ]);
    expect(publishing.bestTimesFor).not.toHaveBeenCalled();
  });

  it("an approved post gets today's best free time, written only if it did not change since it was read", async () => {
    missed = [row("s", { status: "SCHEDULED" })];
    expect(await carryOverMissedPosts(now)).toEqual({ moved: 1, expired: 0, toReview: 0 });
    expect(publishing.bestTimesFor).toHaveBeenCalledWith("b1", missed, now);
    expect(publishing.scheduleAtFreeSlot).toHaveBeenCalledWith(missed[0], new Date("2026-10-31T16:00:00Z"), {
      businessId: "b1",
      where: { status: "SCHEDULED", updatedAt: read },
      data: { plannedDay: today, carryCount: 1, nextAttemptAt: null },
      now,
    });
  });

  it("an approved post with no free time today waits for the owner instead of staying on a day that passed", async () => {
    missed = [row("s", { status: "SCHEDULED", carryCount: 2 })];
    publishing.scheduleAtFreeSlot.mockResolvedValue("taken");
    expect(await carryOverMissedPosts(now)).toEqual({ moved: 0, expired: 0, toReview: 1 });
    expect(updates()[0]).toEqual({
      where: { id: "s", businessId: "b1", status: "SCHEDULED", updatedAt: read },
      data: { status: "PENDING_APPROVAL", scheduledAt: null, plannedDay: today, carryCount: 3, autoScheduledAt: null, nextAttemptAt: null, reviewNote: NO_FREE_TIME_NOTE },
    });
  });

  it("after 3 moves the next miss expires it, waiting or approved, and nothing is scheduled for it", async () => {
    missed = [row("w", { carryCount: 3 }), row("a", { status: "SCHEDULED", carryCount: 3 })];
    expect(await carryOverMissedPosts(now)).toEqual({ moved: 0, expired: 2, toReview: 0 });
    expect(updates()).toEqual([
      { where: { id: "w", businessId: "b1", status: "PENDING_APPROVAL", updatedAt: read }, data: { status: "EXPIRED", lockedAt: null, nextAttemptAt: null } },
      { where: { id: "a", businessId: "b1", status: "SCHEDULED", updatedAt: read }, data: { status: "EXPIRED", lockedAt: null, nextAttemptAt: null } },
    ]);
    expect(publishing.scheduleAtFreeSlot).not.toHaveBeenCalled();
  });

  it("is safe to run twice: a second run racing the first changes nothing (the updatedAt guard), and a later one finds nothing", async () => {
    missed = [row("p"), row("s", { status: "SCHEDULED" })];
    prisma.post.updateMany.mockResolvedValue({ count: 0 });
    publishing.scheduleAtFreeSlot.mockResolvedValue("changed");
    expect(await carryOverMissedPosts(now)).toEqual({ moved: 0, expired: 0, toReview: 0 });
    // The moved posts now belong to today, so the query (missedWhere) no longer finds them.
    expect(isMissed({ status: "PENDING_APPROVAL", scheduledAt: null, plannedDay: today, createdAt: new Date("2026-10-29T08:00:00Z") }, "2026-10-31", KIGALI)).toBe(false);
    expect(isMissed({ status: "SCHEDULED", scheduledAt: new Date("2026-10-31T16:00:00Z"), plannedDay: today, createdAt: new Date("2026-10-29T08:00:00Z") }, "2026-10-31", KIGALI)).toBe(false);
    missed = [];
    vi.clearAllMocks();
    expect(await carryOverMissedPosts(now)).toEqual({ moved: 0, expired: 0, toReview: 0 });
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it("one zone's error does not stop the others", async () => {
    prisma.business.findMany.mockResolvedValue([{ timezone: "UTC" }, { timezone: KIGALI }]);
    prisma.post.findMany.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce([row("p")]);
    expect(await carryOverMissedPosts(now)).toEqual({ moved: 1, expired: 0, toReview: 0 });
  });
});

describe("Use again", () => {
  const owner = { businessId: "b1", userId: "u1", actorId: "u1" };

  it("brings an expired post back to 'Needs your OK' for today, its count reset and no old time", async () => {
    prisma.business.findUnique.mockResolvedValue({ timezone: KIGALI });
    await reusePost(owner, "e1", now);
    expect(updates()[0]).toEqual({
      where: { id: "e1", businessId: "b1", status: "EXPIRED" },
      data: { status: "PENDING_APPROVAL", scheduledAt: null, plannedDay: today, carryCount: 0, autoScheduledAt: null, attempts: 0, nextAttemptAt: null, lockedAt: null, lastError: null, reviewNote: null, ownerEditedAt: now },
    });
  });

  it("only works on this business's expired posts", async () => {
    prisma.business.findUnique.mockResolvedValue({ timezone: KIGALI });
    prisma.post.updateMany.mockResolvedValue({ count: 0 });
    prisma.post.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "SCHEDULED" });
    await expect(reusePost(owner, "other", now)).rejects.toMatchObject({ code: "not_found" });
    await expect(reusePost(owner, "live", now)).rejects.toBeInstanceOf(PublishingError);
  });
});
