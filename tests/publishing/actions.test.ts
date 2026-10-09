import { beforeEach, describe, expect, it, vi } from "vitest";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn(), update: vi.fn() },
  autopilotSettings: { findUnique: vi.fn() },
  connection: { findMany: vi.fn() },
  project: { findFirst: vi.fn() },
  generatedContent: { findFirst: vi.fn() },
  design: { findMany: vi.fn() },
  post: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
const auth = vi.hoisted(() => ({ requireActiveUser: vi.fn() }));
const limit = vi.hoisted(() => {
  class RateLimitError extends Error {
    constructor(public retryAfterSeconds: number) {
      super("Too many requests");
    }
  }
  return { rateLimit: vi.fn(), RateLimitError, rateLimitMessage: () => "Slow down." };
});
const engine = vi.hoisted(() => ({ publishPostsNow: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => auth);
vi.mock("@/lib/rate-limit", () => limit);
vi.mock("@/lib/publishing/engine", () => engine);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import {
  approvePostsAction,
  createPostsAction,
  deletePostAction,
  duplicatePostAction,
  markPostedAction,
  reschedulePostAction,
  retryPostAction,
  setTimezoneAction,
  updatePostAction,
} from "@/app/dashboard/calendar/actions";

beforeEach(() => {
  vi.resetAllMocks();
  auth.requireActiveUser.mockResolvedValue({ id: "u1" });
  prisma.business.findUnique.mockResolvedValue({ id: "b1", timezone: "UTC" });
  limit.rateLimit.mockResolvedValue(undefined);
  prisma.post.findFirst.mockResolvedValue(null);
  prisma.post.findMany.mockResolvedValue([]);
  prisma.post.updateMany.mockResolvedValue({ count: 0 });
  prisma.autopilotSettings.findUnique.mockResolvedValue(null);
});

const edit = { text: "x", hashtags: [], mediaPaths: [], when: { mode: "keep" as const } };

describe("calendar actions", () => {
  it("resolve the business from the signed-in user, never from the input, so another business's post is not found", async () => {
    const results = await Promise.all([
      updatePostAction("p-other", edit),
      reschedulePostAction("p-other", "2099-01-01T10:00:00Z"),
      duplicatePostAction("p-other"),
      deletePostAction("p-other"),
      retryPostAction("p-other"),
      markPostedAction("p-other"),
    ]);
    for (const result of results) expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(prisma.business.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" } }));
    for (const call of prisma.post.findFirst.mock.calls) expect(call[0].where.businessId).toBe("b1");
    expect(prisma.post.deleteMany).not.toHaveBeenCalled();
    expect(prisma.post.create).not.toHaveBeenCalled();
    expect(engine.publishPostsNow).not.toHaveBeenCalled();
  });

  it("approve is scoped to the user's business", async () => {
    const result = await approvePostsAction(["p-other"]);
    expect(result).toEqual({ ok: true, approved: 0 });
    expect(prisma.post.findMany.mock.calls[0][0].where).toMatchObject({ businessId: "b1", status: "PENDING_APPROVAL" });
  });

  it("creating with another business's account fails before anything is saved or sent", async () => {
    prisma.connection.findMany.mockResolvedValue([]);
    const result = await createPostsAction({ connectionIds: ["theirs"], text: "hi", hashtags: [], overrides: {}, mediaPaths: [], when: { mode: "now" } });
    expect(result).toMatchObject({ ok: false });
    expect(prisma.connection.findMany.mock.calls[0][0].where).toMatchObject({ businessId: "b1" });
    expect(engine.publishPostsNow).not.toHaveBeenCalled();
  });

  it("Post now sends only the posts it just created, for this business, and reports how they ended", async () => {
    prisma.connection.findMany.mockResolvedValue([{ id: "c-fb", provider: "facebook", displayName: "Page", status: "ACTIVE", postingMode: "AUTO" }]);
    prisma.post.create.mockResolvedValue({ id: "new1" });
    prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
    prisma.post.findMany.mockResolvedValue([{ id: "new1", network: "facebook", status: "PUBLISHED", lastError: null }]);
    const result = await createPostsAction({ connectionIds: ["c-fb"], text: "hi", hashtags: [], overrides: {}, mediaPaths: [], when: { mode: "now" } });
    expect(engine.publishPostsNow).toHaveBeenCalledWith("b1", ["new1"]);
    expect(result).toMatchObject({ ok: true, outcomes: [{ id: "new1", status: "PUBLISHED" }] });
  });

  it("a blocked user gets a friendly message and nothing runs", async () => {
    limit.rateLimit.mockRejectedValue(new limit.RateLimitError(120));
    const result = await deletePostAction("p1");
    expect(result).toEqual({ ok: false, error: "Slow down." });
    expect(prisma.post.findFirst).not.toHaveBeenCalled();
  });

  it("limits Post now more tightly than ordinary edits", async () => {
    await retryPostAction("p1");
    await deletePostAction("p1");
    const keys = limit.rateLimit.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(["publishing:publishNow:u1", "publishing:compose:u1"]);
    const [, publishNowRule] = limit.rateLimit.mock.calls[0];
    const [, composeRule] = limit.rateLimit.mock.calls[1];
    expect(publishNowRule.limit).toBeLessThan(composeRule.limit);
  });

  it("a user without a business is told to set one up", async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    expect(await deletePostAction("p1")).toEqual({ ok: false, error: "Set up your business first." });
  });

  it("saves the business time zone only for a real IANA zone", async () => {
    expect(await setTimezoneAction("Mars/Olympus")).toMatchObject({ ok: false });
    expect(prisma.business.update).not.toHaveBeenCalled();
    expect(await setTimezoneAction("Africa/Kigali")).toEqual({ ok: true });
    expect(prisma.business.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { timezone: "Africa/Kigali" } });
  });
});
