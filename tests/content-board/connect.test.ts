import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  autopilotSettings: { findUnique: vi.fn() },
  post: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  connection: { findMany: vi.fn() },
  contentVisual: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));
vi.mock("@/lib/autopilot/results", () => ({ loadPostResults: vi.fn(async () => []) }));

import { connectByHandPosts, NO_FREE_TIME } from "@/lib/content-board/connect";

const owner = { businessId: "b1", userId: "u1" };
const now = new Date("2026-10-13T08:00:00Z"); // Tuesday 10:00 in Kigali
const read = new Date("2026-10-13T07:00:00Z");
const fb = { id: "c-fb", provider: "facebook", status: "ACTIVE", postingMode: "AUTO", kind: "SOCIAL" };
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, network: "facebook", format: "POST", text: "Fresh bread", hashtags: [], mediaPaths: ["u1/designs/a.png"], scheduledAt: null, status: "PENDING_APPROVAL", connectionId: "c-fb", contentId: null, groupId: null, reviewNote: null, updatedAt: read, remindOnly: false, connection: { status: "ACTIVE", postingMode: "AUTO" }, ...extra });

let found: Record<string, unknown>[] = [];
let checked: Record<string, unknown>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  prisma.business.findUnique.mockResolvedValue({ timezone: "Africa/Kigali" });
  prisma.autopilotSettings.findUnique.mockResolvedValue(null);
  prisma.connection.findMany.mockResolvedValue([fb]);
  prisma.contentVisual.findMany.mockResolvedValue([]);
  prisma.post.updateMany.mockResolvedValue({ count: 1 });
  prisma.post.findFirst.mockResolvedValue(null);
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  prisma.post.findMany.mockImplementation(async (args: { where: { remindOnly?: boolean; status?: unknown } }) =>
    args.where.remindOnly ? found : args.where.status === "PENDING_APPROVAL" ? checked : [],
  );
});

const calls = () => prisma.post.updateMany.mock.calls.map((c) => c[0]);

describe("connectByHandPosts (Publish automatically)", () => {
  it("switches a waiting post to the connected account, and leaves apps still not connected alone", async () => {
    found = [{ id: "a", network: "facebook", status: "PENDING_APPROVAL", scheduledAt: null }, { id: "t", network: "tiktok", status: "PENDING_APPROVAL", scheduledAt: null }];
    expect(await connectByHandPosts(owner, ["a", "t"], now)).toEqual({ switched: 1, rescheduled: 0, toReview: 0 });
    expect(calls()).toEqual([{ where: { id: "a", businessId: "b1", remindOnly: true, connectionId: null, status: "PENDING_APPROVAL", lockedAt: null }, data: { connectionId: "c-fb", remindOnly: false } }]);
  });

  it("takes a scheduled post out of the queue, then gives a stale one a new best time on a free slot", async () => {
    found = [{ id: "s", network: "facebook", status: "SCHEDULED", scheduledAt: new Date("2026-10-12T16:00:00Z") }];
    checked = [row("s", { scheduledAt: new Date("2026-10-12T16:00:00Z") })];
    expect(await connectByHandPosts(owner, ["s"], now)).toEqual({ switched: 1, rescheduled: 1, toReview: 0 });
    expect(calls()[0].data).toEqual({ connectionId: "c-fb", remindOnly: false, status: "PENDING_APPROVAL" });
    const written = calls()[1];
    expect(written.where).toMatchObject({ id: "s", status: "PENDING_APPROVAL", updatedAt: read });
    expect((written.data.scheduledAt as Date).getTime()).toBeGreaterThan(now.getTime());
    expect(written.data).toMatchObject({ status: "SCHEDULED", reviewNote: null });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("keeps a time still ahead and free", async () => {
    const ahead = new Date("2026-10-15T16:00:00Z");
    found = [{ id: "s", network: "facebook", status: "SCHEDULED", scheduledAt: ahead }];
    checked = [row("s", { scheduledAt: ahead })];
    await connectByHandPosts(owner, ["s"], now);
    expect(calls()[1].data.scheduledAt).toEqual(ahead);
  });

  it("leaves it in review with the reason when it cannot go safely, or when no free time is found", async () => {
    found = [{ id: "s", network: "facebook", status: "SCHEDULED", scheduledAt: null }];
    checked = [row("s", { mediaPaths: [], network: "instagram" })];
    prisma.connection.findMany.mockResolvedValue([{ ...fb, provider: "instagram" }]);
    found = [{ id: "s", network: "instagram", status: "SCHEDULED", scheduledAt: null }];
    expect((await connectByHandPosts(owner, ["s"], now)).toReview).toBe(1);
    expect(calls().at(-1)!.data.reviewNote).toMatch(/needs a picture/);

    vi.clearAllMocks();
    prisma.connection.findMany.mockResolvedValue([fb]);
    prisma.post.updateMany.mockResolvedValue({ count: 1 });
    prisma.post.findFirst.mockResolvedValue({ id: "clash" });
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
    found = [{ id: "s", network: "facebook", status: "SCHEDULED", scheduledAt: null }];
    checked = [row("s")];
    expect(await connectByHandPosts(owner, ["s"], now)).toEqual({ switched: 1, rescheduled: 0, toReview: 1 });
    expect(calls().at(-1)!.data).toEqual({ reviewNote: NO_FREE_TIME });
  });
});
