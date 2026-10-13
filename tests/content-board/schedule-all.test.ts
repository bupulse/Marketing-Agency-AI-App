import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  autopilotSettings: { findUnique: vi.fn() },
  post: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
  connection: { findMany: vi.fn() },
  contentVisual: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));
vi.mock("@/lib/autopilot/results", () => ({ loadPostResults: vi.fn(async () => []) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { approvedMessage, unpostedReason } from "@/lib/content-board/labels";
import { missingApps } from "@/lib/content-board/queries";
import { scheduleAll, SKIP_REASONS } from "@/lib/content-board/schedule-all";
import { REVIEW_REASONS } from "@/lib/content-board/rules";

const now = new Date("2026-10-13T08:00:00Z"); // Tuesday 10:00 in Kigali
const read = new Date("2026-10-13T07:00:00Z");
const active = { status: "ACTIVE", postingMode: "AUTO" };
type Row = Record<string, unknown>;
const post = (id: string, extra: Row = {}): Row => ({ id, network: "facebook", format: "POST", text: "Fresh bread", hashtags: [], mediaPaths: ["u1/designs/a.png"], scheduledAt: null, status: "PENDING_APPROVAL", connectionId: `c-${id}`, contentId: null, groupId: null, reviewNote: null, updatedAt: read, remindOnly: false, connection: active, ...extra });

let rows: Row[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  prisma.business.findUnique.mockResolvedValue({ timezone: "Africa/Kigali" });
  prisma.autopilotSettings.findUnique.mockResolvedValue(null);
  prisma.contentVisual.findMany.mockResolvedValue([]);
  prisma.post.updateMany.mockResolvedValue({ count: 1 });
  prisma.post.findFirst.mockResolvedValue(null);
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  prisma.post.findMany.mockImplementation(async (args: { where: { status?: { in?: string[] } } }) => (args.where.status?.in?.includes("DRAFT") ? rows : []));
});

const writes = () => prisma.post.updateMany.mock.calls.map((c) => c[0]);

describe("scheduleAll (Schedule all my posts)", () => {
  it("schedules drafts and posts waiting for review at the best time, guarded by what was read", async () => {
    rows = [post("a"), post("d", { status: "DRAFT" })];
    const result = await scheduleAll("b1", [{ id: "a" }, { id: "d" }], now);
    expect(result.skipped).toEqual([]);
    expect(result.scheduled.map((s) => s.id)).toEqual(["a", "d"]);
    expect(writes()[0].where).toEqual({ id: "a", businessId: "b1", status: "PENDING_APPROVAL", updatedAt: read });
    expect(writes()[1].where).toMatchObject({ id: "d", status: "DRAFT" });
    expect(writes()[0].data).toMatchObject({ status: "SCHEDULED", reviewNote: null });
    expect(prisma.post.findMany.mock.calls[0][0].where).toMatchObject({ businessId: "b1", status: { in: ["DRAFT", "PENDING_APPROVAL"] } });
  });

  it("uses the owner's own times, and refuses past times and taken slots with a reason", async () => {
    rows = [post("a"), post("b"), post("c")];
    prisma.post.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "other" });
    const at = new Date("2026-10-15T10:00:00Z");
    const result = await scheduleAll("b1", [{ id: "a", at }, { id: "b", at }, { id: "c", at: new Date("2026-10-01T10:00:00Z") }], now);
    expect(result.scheduled).toEqual([{ id: "a", at: at.toISOString() }]);
    expect(result.skipped).toEqual([
      { id: "b", reason: SKIP_REASONS.taken },
      { id: "c", reason: SKIP_REASONS.past },
    ]);
  });

  it("refuses hand-picked times more than 90 days ahead", async () => {
    rows = [post("a")];
    const result = await scheduleAll("b1", [{ id: "a", at: new Date("2027-02-01T10:00:00Z") }], now);
    expect(result.skipped).toEqual([{ id: "a", reason: SKIP_REASONS.tooFar }]);
  });

  it("tells a post that changed meanwhile apart from one with no free time", async () => {
    rows = [post("a"), post("b")];
    prisma.post.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.post.findFirst.mockImplementation(async (args: { where: { connectionId?: string } }) => (args.where.connectionId === "c-b" ? { id: "clash" } : null));
    const result = await scheduleAll("b1", [{ id: "a" }, { id: "b" }], now);
    expect(result.skipped).toEqual([
      { id: "a", reason: SKIP_REASONS.changed },
      { id: "b", reason: SKIP_REASONS.noTime },
    ]);
  });

  it("skips posts that cannot go yet, and posts that are not this business's or already scheduled", async () => {
    rows = [post("v", { network: "tiktok", format: "SCRIPT", mediaPaths: [], contentId: "k1" })];
    prisma.contentVisual.findMany.mockResolvedValue([{ kind: "video", contentId: "k1", groupId: null }]);
    const result = await scheduleAll("b1", [{ id: "v" }, { id: "someone-elses" }], now);
    expect(result.scheduled).toEqual([]);
    expect(result.skipped).toEqual([
      { id: "someone-elses", reason: SKIP_REASONS.changed },
      { id: "v", reason: REVIEW_REASONS.video },
    ]);
  });

  it("schedules reminder posts for apps that are not connected", async () => {
    rows = [post("r", { connectionId: null, connection: null, remindOnly: true })];
    expect((await scheduleAll("b1", [{ id: "r" }], now)).scheduled).toHaveLength(1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("missingApps", () => {
  it("lists apps posts are made for that have no usable account", async () => {
    prisma.post.groupBy.mockResolvedValue([{ network: "instagram" }, { network: "facebook" }]);
    prisma.connection.findMany.mockResolvedValue([{ provider: "facebook", status: "ACTIVE", postingMode: "AUTO" }, { provider: "instagram", status: "EXPIRED", postingMode: "AUTO" }]);
    prisma.autopilotSettings.findUnique.mockResolvedValue({ enabled: true, connectionIds: ["network:tiktok", "c1"] });
    expect(await missingApps("b1")).toEqual(["instagram", "tiktok"]);
    expect(prisma.post.groupBy.mock.calls[0][0].where).toMatchObject({ businessId: "b1", remindOnly: true, connectionId: null });
  });
});

describe("card and toast wording", () => {
  it("says which posts could not be approved", () => {
    expect(approvedMessage({ approved: 4, skipped: 1 }, 5).text).toBe("Approved 4 of 5. 1 could not find a free time: open it and pick a time.");
    expect(approvedMessage({ approved: 1, skipped: 0 }, 1)).toEqual({ text: "Approved. It goes out at the best time.", tone: "success" });
  });

  it("explains why a post is not posted yet", () => {
    const when = () => "Wed 6:00 PM";
    expect(unpostedReason({ status: "PENDING_APPROVAL", remindOnly: true, network: "instagram" }, when, null)).toBe("Instagram not connected");
    expect(unpostedReason({ status: "PENDING_APPROVAL", reviewNote: REVIEW_REASONS.video, network: "tiktok" }, when, null)).toBe(REVIEW_REASONS.video);
    expect(unpostedReason({ status: "SCHEDULED", network: "facebook" }, when, "2026-10-14T16:00:00Z")).toBe("Goes out Wed 6:00 PM");
    expect(unpostedReason({ status: "NEEDS_ACTION", network: "facebook" }, when, null)).toBe("Waiting for you to post it");
  });
});
