import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  autopilotSettings: { findUnique: vi.fn() },
  post: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  contentVisual: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));
vi.mock("@/lib/autopilot/results", () => ({ loadPostResults: vi.fn(async () => []) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { autoSchedule, retryAutoSchedule } from "@/lib/content-board/auto";
import { REVIEW_REASONS } from "@/lib/content-board/rules";
import { approvePosts } from "@/lib/publishing/service";
import { missing, state } from "@/tests/stubs/entitlements";

// Tuesday 13 October 2026, 10:00 in Kigali.
const now = new Date("2026-10-13T08:00:00Z");
const read = new Date("2026-10-13T07:59:00Z"); // updatedAt as the safety checks read it
const active = { status: "ACTIVE", postingMode: "AUTO" };

type Row = Record<string, unknown>;
function post(id: string, extra: Row = {}): Row {
  return { id, network: "facebook", format: "POST", text: "Fresh bread today", hashtags: ["#bread"], mediaPaths: ["u1/designs/a.png"], scheduledAt: null, connectionId: `c-${id}`, contentId: "content-1", groupId: null, reviewNote: null, updatedAt: read, connection: active, ...extra };
}

let pending: Row[] = [];
const settings = (requireApproval: Record<string, boolean>) => prisma.business.findUnique.mockResolvedValue({ contentSettings: { requireApproval }, timezone: "Africa/Kigali" });

beforeEach(() => {
  vi.clearAllMocks();
  missing.clear();
  state.block = null;
  pending = [];
  settings({ facebook: false, instagram: false, tiktok: false });
  prisma.autopilotSettings.findUnique.mockResolvedValue(null);
  prisma.contentVisual.findMany.mockResolvedValue([]);
  prisma.post.updateMany.mockResolvedValue({ count: 1 });
  prisma.post.findFirst.mockResolvedValue(null);
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  // First call: the posts to decide on; later calls: queued posts (none taken).
  prisma.post.findMany.mockImplementation(async (args: { where: { status?: unknown } }) => (args.where.status === "PENDING_APPROVAL" ? pending : []));
});

const scheduledCalls = () => prisma.post.updateMany.mock.calls.map((c) => c[0]).filter((c) => c.data.status === "SCHEDULED");
const noteCalls = () => prisma.post.updateMany.mock.calls.map((c) => c[0]).filter((c) => "reviewNote" in c.data && !c.data.status);

describe("autoSchedule", () => {
  it("schedules posts of apps that need no approval at the best time, and marks them auto-scheduled", async () => {
    pending = [post("a")];
    expect(await autoSchedule("b1", ["a"], now)).toEqual({ scheduled: 1, waiting: 0 });
    const [call] = scheduledCalls();
    expect(call.where).toEqual({ id: "a", businessId: "b1", status: "PENDING_APPROVAL", updatedAt: read });
    // Facebook defaults: 13:00 and 18:00 on Tuesday to Thursday and Saturday; the posting times are 09:00 and 18:00.
    expect(call.data).toEqual({ status: "SCHEDULED", scheduledAt: new Date("2026-10-13T16:00:00Z"), autoScheduledAt: now, reviewNote: null });
  });

  it("never schedules a contest on its own, confirmed or not", async () => {
    pending = [post("c1", { contest: {}, text: "Win [PRIZE]" }), post("c2", { contest: { confirmedAt: "2026-10-12T08:00:00Z" }, text: "Win 50,000 RWF" })];
    expect(await autoSchedule("b1", ["c1", "c2"], now)).toEqual({ scheduled: 0, waiting: 2 });
    expect(scheduledCalls()).toEqual([]);
  });

  it("the safety rules (Schedule all, the connect switch) refuse an unconfirmed contest with its reason", async () => {
    const { safetyReasons } = await import("@/lib/content-board/auto");
    const reasons = await safetyReasons("b1", [post("c1", { contest: {}, text: "Win 50,000 RWF" }) as never]);
    expect(reasons.get("c1")).toBe("Needs your confirmation: prize & rules");
  });

  it("only reads this business's posts that still wait for review", async () => {
    await autoSchedule("b1", ["a", "a", "b"], now);
    expect(prisma.post.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["a", "b"] }, businessId: "b1", status: "PENDING_APPROVAL" });
  });

  it("decides per app: apps that need approval are left alone", async () => {
    settings({ facebook: false });
    pending = [post("fb"), post("ig", { network: "instagram" })];
    expect(await autoSchedule("b1", ["fb", "ig"], now)).toEqual({ scheduled: 1, waiting: 1 });
    expect(scheduledCalls().map((c) => c.where.id)).toEqual(["fb"]);
    expect(noteCalls()).toEqual([]);
  });

  it("does nothing at all when every app needs approval (the default)", async () => {
    prisma.business.findUnique.mockResolvedValue({ contentSettings: null });
    pending = [post("a")];
    expect(await autoSchedule("b1", ["a"], now)).toEqual({ scheduled: 0, waiting: 1 });
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a video idea in review with a reason until the video is rendered", async () => {
    pending = [post("t", { network: "tiktok", format: "SCRIPT", mediaPaths: [] })];
    prisma.contentVisual.findMany.mockResolvedValue([{ kind: "video", contentId: "content-1", groupId: null }]);
    expect(await autoSchedule("b1", ["t"], now)).toEqual({ scheduled: 0, waiting: 1 });
    expect(noteCalls()[0]).toEqual({ where: { id: "t", businessId: "b1", status: "PENDING_APPROVAL", updatedAt: read }, data: { reviewNote: REVIEW_REASONS.video } });
  });

  it("waits while the picture is drawn, and for an account that must be reconnected", async () => {
    pending = [post("ig", { network: "instagram", mediaPaths: [] }), post("fb", { connection: { status: "EXPIRED", postingMode: "AUTO" } })];
    prisma.contentVisual.findMany.mockResolvedValue([{ kind: "image", contentId: "content-1", groupId: null }]);
    await autoSchedule("b1", ["ig", "fb"], now);
    expect(noteCalls().map((c) => c.data.reviewNote)).toEqual([REVIEW_REASONS.picture, "Facebook needs to be reconnected first. Open Channels to fix it."]);
    expect(scheduledCalls()).toEqual([]);
  });

  it("respects the plan: no scheduling feature, or a read-only account, keeps posts in review", async () => {
    missing.add("calendar");
    pending = [post("a")];
    expect(await autoSchedule("b1", ["a"], now)).toEqual({ scheduled: 0, waiting: 1 });
    expect(noteCalls()[0].data.reviewNote).toBe(REVIEW_REASONS.plan);
    missing.clear();
    state.block = "trial_expired";
    vi.clearAllMocks();
    prisma.post.findMany.mockImplementation(async (args: { where: { status?: unknown } }) => (args.where.status === "PENDING_APPROVAL" ? pending : []));
    prisma.post.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
    expect((await autoSchedule("b1", ["a"], now)).scheduled).toBe(0);
  });

  it("keeps an Autopilot post's planned time when it is still ahead", async () => {
    const planned = new Date("2026-10-15T10:00:00Z");
    pending = [post("ap", { scheduledAt: planned, contentId: null, groupId: "g1" })];
    await autoSchedule("b1", ["ap"], now);
    expect(scheduledCalls()[0].data.scheduledAt).toEqual(planned);
  });

  it("spaces two posts for the same account 2.5 hours apart", async () => {
    pending = [post("a", { connectionId: "c1" }), post("b", { connectionId: "c1" })];
    await autoSchedule("b1", ["a", "b"], now);
    const [first, second] = scheduledCalls().map((c) => c.data.scheduledAt as Date);
    expect(Math.abs(second.getTime() - first.getTime())).toBeGreaterThanOrEqual(150 * 60_000);
  });

  it("does not schedule a post the owner changed after the safety checks read it", async () => {
    pending = [post("a")];
    prisma.post.updateMany.mockResolvedValue({ count: 0 }); // updatedAt no longer matches
    expect(await autoSchedule("b1", ["a"], now)).toEqual({ scheduled: 0, waiting: 1 });
    expect(scheduledCalls()[0].where.updatedAt).toEqual(read);
  });

  it("picks another time when the slot was taken on the account meanwhile, checked under a lock", async () => {
    pending = [post("a", { connectionId: "c1" })];
    prisma.post.findFirst.mockResolvedValueOnce({ id: "other" }).mockResolvedValue(null);
    let queued = 0;
    prisma.post.findMany.mockImplementation(async (args: { where: { status?: unknown } }) =>
      args.where.status === "PENDING_APPROVAL" ? pending : queued++ === 0 ? [] : [{ connectionId: "c1", scheduledAt: new Date("2026-10-13T16:00:00Z") }],
    );
    expect((await autoSchedule("b1", ["a"], now)).scheduled).toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    const at = scheduledCalls()[0].data.scheduledAt as Date;
    expect(Math.abs(at.getTime() - new Date("2026-10-13T16:00:00Z").getTime())).toBeGreaterThanOrEqual(150 * 60_000);
  });

  it("clears a note once the post can go", async () => {
    pending = [post("a", { reviewNote: REVIEW_REASONS.picture })];
    await autoSchedule("b1", ["a"], now);
    expect(scheduledCalls()[0].data.reviewNote).toBeNull();
  });
});

describe("retryAutoSchedule", () => {
  it("retries only posts that waited for a reason, for that content", async () => {
    prisma.post.findMany.mockResolvedValueOnce([{ id: "a" }]).mockImplementation(async (args: { where: { status?: unknown } }) => (args.where.status === "PENDING_APPROVAL" ? [post("a", { reviewNote: REVIEW_REASONS.picture })] : []));
    await retryAutoSchedule("b1", { contentId: "content-1" }, now);
    expect(prisma.post.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", contentId: "content-1", status: "PENDING_APPROVAL", reviewNote: { not: null } });
    expect(scheduledCalls()).toHaveLength(1);
  });
});

describe("approvePosts (Approve and Approve all)", () => {
  it("schedules a post without a time at the best time for its app, and clears its note", async () => {
    prisma.post.findMany.mockImplementation(async (args: { where: { status?: unknown } }) =>
      args.where.status === "PENDING_APPROVAL" ? [{ id: "ig", network: "instagram", connectionId: "c-ig", scheduledAt: null }, { id: "li", network: "linkedin", connectionId: "c-li", scheduledAt: null }] : [],
    );
    expect(await approvePosts("b1", ["ig", "li"], now)).toEqual({ approved: 2, skipped: 0 });
    const calls = prisma.post.updateMany.mock.calls.map((c) => c[0]);
    // Instagram prefers Wednesday evening; LinkedIn mornings, Tuesday to Thursday: today's 18:00 is the only time left today.
    expect(calls[0].data).toEqual({ status: "SCHEDULED", reviewNote: null, scheduledAt: new Date("2026-10-14T16:00:00Z") });
    expect(calls[1].data).toEqual({ status: "SCHEDULED", reviewNote: null, scheduledAt: new Date("2026-10-13T16:00:00Z") });
  });
});
