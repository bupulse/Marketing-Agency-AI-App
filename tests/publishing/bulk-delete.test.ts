import { beforeEach, describe, expect, it, vi } from "vitest";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  post: { findMany: vi.fn(), deleteMany: vi.fn() },
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

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => auth);
vi.mock("@/lib/rate-limit", () => limit);
vi.mock("@/lib/publishing/engine", () => ({ publishPostsNow: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { deletePostsAction } from "@/app/dashboard/calendar/actions";
import { BULK_DELETABLE, bulkDeletable, bulkDeleteMessage, bulkSkipReason, MAX_BULK_DELETE, selectAllButton } from "@/lib/publishing/bulk-delete";
import { ForbiddenError } from "@/lib/team/roles";

type Row = { id: string; status: string; lockedAt: Date | null };
let rows: Row[];

beforeEach(() => {
  vi.resetAllMocks();
  auth.requireActiveUser.mockResolvedValue({ id: "u1", actorId: "a1" });
  prisma.business.findUnique.mockResolvedValue({ id: "b1" });
  limit.rateLimit.mockResolvedValue(undefined);
  rows = [];
  // The database: only this business's rows are ever returned, and a delete removes the rows its where matches.
  prisma.post.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] }; businessId: string } }) =>
    where.businessId === "b1" ? rows.filter((r) => where.id.in.includes(r.id)) : [],
  );
  prisma.post.deleteMany.mockImplementation(async ({ where }: { where: { id: { in: string[] }; businessId: string; status: { in: string[] }; lockedAt: null } }) => {
    const gone = rows.filter((r) => where.businessId === "b1" && where.id.in.includes(r.id) && where.status.in.includes(r.status) && r.lockedAt === where.lockedAt);
    rows = rows.filter((r) => !gone.includes(r));
    return { count: gone.length };
  });
});

const post = (id: string, status: string, lockedAt: Date | null = null): Row => ({ id, status, lockedAt });

describe("deletePostsAction", () => {
  it("deletes the waiting posts (drafts, waiting for OK, expired) of the signed-in user's business", async () => {
    rows = [post("d1", "DRAFT"), post("p1", "PENDING_APPROVAL"), post("e1", "EXPIRED")];
    const res = await deletePostsAction(["d1", "p1", "e1"]);
    expect(res).toEqual({ ok: true, deleted: 3, skipped: [] });
    expect(rows).toEqual([]);
    // The business comes from the session, never from the input.
    expect(prisma.business.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" } }));
    expect(prisma.post.findMany.mock.calls[0][0].where.businessId).toBe("b1");
    const del = prisma.post.deleteMany.mock.calls[0][0].where;
    expect(del).toMatchObject({ businessId: "b1", lockedAt: null });
    expect(del.status.in.sort()).toEqual([...BULK_DELETABLE].sort());
  });

  it("never deletes another business's post: it is reported as not found and nothing is deleted", async () => {
    const res = await deletePostsAction(["someone-elses"]);
    expect(res).toEqual({ ok: true, deleted: 0, skipped: [{ id: "someone-elses", reason: "not_found" }] });
    expect(prisma.post.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps posted, going-out, held, scheduled and failed posts, each with why, and deletes the rest", async () => {
    rows = [
      post("ok", "PENDING_APPROVAL"),
      post("live", "PUBLISHED"),
      post("going", "PUBLISHING"),
      post("held", "PENDING_APPROVAL", new Date()),
      post("sched", "SCHEDULED"),
      post("remind", "NEEDS_ACTION"),
      post("failed", "FAILED"),
      post("cancelled", "CANCELLED"),
    ];
    const res = await deletePostsAction(rows.map((r) => r.id));
    expect(res).toMatchObject({ ok: true, deleted: 1 });
    if (!res.ok) throw new Error("expected ok");
    expect(Object.fromEntries(res.skipped.map((s) => [s.id, s.reason]))).toEqual({
      live: "posted",
      going: "publishing",
      held: "publishing",
      sched: "not_waiting",
      remind: "not_waiting",
      failed: "not_waiting",
      cancelled: "not_waiting",
    });
    expect(rows.map((r) => r.id)).not.toContain("ok");
    expect(rows).toHaveLength(7);
    // Only the deletable id reaches the delete.
    expect(prisma.post.deleteMany.mock.calls[0][0].where.id.in).toEqual(["ok"]);
  });

  it("a post that started going out between the read and the delete stays, reported as changed", async () => {
    rows = [post("a", "PENDING_APPROVAL"), post("b", "DRAFT")];
    prisma.post.deleteMany.mockImplementationOnce(async () => {
      // The publisher claimed "b" a moment before the delete ran: the delete's own status/lock check keeps it.
      rows = rows.filter((r) => r.id !== "a");
      return { count: 1 };
    });
    const res = await deletePostsAction(["a", "b"]);
    expect(res).toEqual({ ok: true, deleted: 1, skipped: [{ id: "b", reason: "changed" }] });
  });

  it("counts a repeated id once", async () => {
    rows = [post("a", "DRAFT")];
    expect(await deletePostsAction(["a", "a", "a"])).toEqual({ ok: true, deleted: 1, skipped: [] });
    expect(prisma.post.findMany.mock.calls[0][0].where.id.in).toEqual(["a"]);
  });

  it(`takes at most ${MAX_BULK_DELETE} posts, at least one, and only id strings, before touching the database`, async () => {
    const tooMany = Array.from({ length: MAX_BULK_DELETE + 1 }, (_, i) => `p${i}`);
    expect(await deletePostsAction(tooMany)).toEqual({ ok: false, error: `Pick ${MAX_BULK_DELETE} posts or fewer at a time.` });
    expect(await deletePostsAction([])).toEqual({ ok: false, error: "Pick at least one post." });
    expect(await deletePostsAction("p1" as unknown as string[])).toEqual({ ok: false, error: "Pick at least one post." });
    expect(await deletePostsAction([{ id: "x" }] as unknown as string[])).toMatchObject({ ok: false });
    expect(await deletePostsAction(["x".repeat(65)])).toMatchObject({ ok: false });
    expect(await deletePostsAction([""])).toMatchObject({ ok: false });
    expect(auth.requireActiveUser).not.toHaveBeenCalled();
    expect(prisma.post.findMany).not.toHaveBeenCalled();
    expect(prisma.post.deleteMany).not.toHaveBeenCalled();
  });

  it(`deletes exactly ${MAX_BULK_DELETE} in one go`, async () => {
    rows = Array.from({ length: MAX_BULK_DELETE }, (_, i) => post(`p${i}`, "PENDING_APPROVAL"));
    expect(await deletePostsAction(rows.map((r) => r.id))).toEqual({ ok: true, deleted: MAX_BULK_DELETE, skipped: [] });
  });

  it("checks the content permission on the server, and a refused role deletes nothing", async () => {
    rows = [post("a", "DRAFT")];
    await deletePostsAction(["a"]);
    expect(auth.requireActiveUser).toHaveBeenCalledWith("content", "throw");

    auth.requireActiveUser.mockRejectedValue(new ForbiddenError("content"));
    rows = [post("b", "DRAFT")];
    const res = await deletePostsAction(["b"]);
    expect(res).toEqual({ ok: false, error: "Ask your company owner or an admin to do this." });
    expect(rows).toHaveLength(1);
  });

  it("a rate-limited user gets a friendly message and nothing is read or deleted", async () => {
    limit.rateLimit.mockRejectedValue(new limit.RateLimitError(60));
    expect(await deletePostsAction(["a"])).toEqual({ ok: false, error: "Slow down." });
    expect(limit.rateLimit.mock.calls[0][0]).toBe("publishing:compose:u1");
    expect(prisma.post.findMany).not.toHaveBeenCalled();
  });

  it("a user without a business is told to set one up", async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    expect(await deletePostsAction(["a"])).toEqual({ ok: false, error: "Set up your business first." });
    expect(prisma.post.deleteMany).not.toHaveBeenCalled();
  });
});

describe("bulk delete rules", () => {
  it("only waiting, never-posted posts can be picked", () => {
    expect(["DRAFT", "PENDING_APPROVAL", "EXPIRED"].every(bulkDeletable)).toBe(true);
    expect(["SCHEDULED", "PUBLISHING", "PUBLISHED", "NEEDS_ACTION", "FAILED", "CANCELLED"].some(bulkDeletable)).toBe(false);
    expect(bulkSkipReason({ status: "DRAFT", lockedAt: null })).toBeNull();
    expect(bulkSkipReason({ status: "DRAFT", lockedAt: new Date() })).toBe("publishing");
    expect(bulkSkipReason(undefined)).toBe("not_found");
  });

  it("says how many went and why the others stayed", () => {
    expect(bulkDeleteMessage({ deleted: 1, skipped: [] })).toEqual({ text: "1 post deleted.", tone: "success" });
    expect(bulkDeleteMessage({ deleted: 4, skipped: [] }).text).toBe("4 posts deleted.");
    expect(
      bulkDeleteMessage({
        deleted: 2,
        skipped: [
          { id: "a", reason: "posted" },
          { id: "b", reason: "posted" },
          { id: "c", reason: "publishing" },
        ],
      }),
    ).toEqual({ text: "2 posts deleted. 3 posts were kept: 2 are already posted, 1 is going out right now.", tone: "success" });
    expect(bulkDeleteMessage({ deleted: 0, skipped: [{ id: "a", reason: "not_found" }] })).toEqual({ text: "1 post was kept: 1 could not be found.", tone: "error" });
  });
});

describe("select all button", () => {
  it("offers all when there are few, 100 when there are more, and Clear all once the cap is picked", () => {
    expect(selectAllButton(12, 0)).toEqual({ all: false, label: "Select all 12" });
    expect(selectAllButton(12, 12)).toEqual({ all: true, label: "Clear all" });
    expect(selectAllButton(140, 0)).toEqual({ all: false, label: `Select ${MAX_BULK_DELETE}` });
    expect(selectAllButton(140, MAX_BULK_DELETE)).toEqual({ all: true, label: "Clear all" });
    expect(selectAllButton(0, 0).all).toBe(false);
  });
});
