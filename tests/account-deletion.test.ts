import { beforeEach, describe, expect, it, vi } from "vitest";

const { bizFind, eventsUpdate, subFindUnique, findMany, findFirst, executeRaw, logError, list, remove, createClient } = vi.hoisted(() => ({
  bizFind: vi.fn(),
  eventsUpdate: vi.fn(),
  subFindUnique: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  executeRaw: vi.fn(),
  logError: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: bizFind }, analyticsEvent: { updateMany: eventsUpdate }, user: { findMany, findFirst }, subscription: { findUnique: subFindUnique }, $executeRaw: executeRaw } }));
vi.mock("@/lib/errors", () => ({ logError }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

import { purgeDueAccounts } from "@/lib/account-deletion";

vi.mock("@/lib/generated/prisma/client", () => ({ Prisma: { DbNull: "DbNull" } }));

const now = new Date("2026-11-01T00:00:00Z");

describe("purgeDueAccounts", () => {
  beforeEach(() => {
    bizFind.mockReset().mockResolvedValue({ id: "biz1" });
    eventsUpdate.mockReset().mockResolvedValue({ count: 3 });
    for (const m of [subFindUnique, findMany, findFirst, executeRaw, logError, list, remove, createClient]) m.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "secret";
    createClient.mockReturnValue({ storage: { from: () => ({ list, remove }) } });
    list.mockResolvedValue({ data: [], error: null });
    remove.mockResolvedValue({ error: null });
    executeRaw.mockResolvedValue(1);
    subFindUnique.mockResolvedValue(null);
    findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  });

  it("only asks for users whose date has passed and deletes each auth user", async () => {
    findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    const result = await purgeDueAccounts(now);
    expect(findMany).toHaveBeenCalledWith({ where: { deletionScheduledFor: { lte: now } }, select: { id: true } });
    // per user: redact the admin records, then delete the auth user
    expect(executeRaw).toHaveBeenCalledTimes(4);
    const sql = (n: number) => (executeRaw.mock.calls[n][0] as string[]).join("?");
    expect(sql(0)).toContain("redact_audit_for_user");
    expect(executeRaw.mock.calls[0][1]).toBe("u1");
    expect(sql(1)).toContain("DELETE FROM auth.users");
    expect(sql(2)).toContain("redact_audit_for_user");
    expect(executeRaw.mock.calls[2][1]).toBe("u2");
    expect(result).toMatchObject({ due: 2, deleted: 2, failed: 0 });
  });

  it("does nothing when no one is due", async () => {
    findMany.mockResolvedValue([]);
    expect(await purgeDueAccounts(now)).toEqual({ due: 0, deleted: 0, failed: 0, filesRemoved: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("removes files in sub-folders and counts them", async () => {
    findMany.mockResolvedValue([{ id: "u1" }]);
    list.mockImplementation(async (prefix: string) =>
      prefix === "u1"
        ? { data: [{ name: "logo", id: null }, { name: "a.png", id: "1" }], error: null }
        : prefix === "u1/logo"
          ? { data: [{ name: "b.png", id: "2" }], error: null }
          : { data: [], error: null },
    );
    const result = await purgeDueAccounts(now);
    expect(remove.mock.calls[0][0].sort()).toEqual(["u1/a.png", "u1/logo/b.png"]);
    expect(result.filesRemoved).toBe(6); // two files in each of the three buckets
  });

  it("keeps the account for a retry when its files cannot be removed", async () => {
    findMany.mockResolvedValue([{ id: "u1" }]);
    list.mockResolvedValue({ data: null, error: new Error("storage down") });
    const result = await purgeDueAccounts(now);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, failed: 1, filesRemoved: 0 });
    expect(logError).toHaveBeenCalled();
  });

  it("deletes nobody without the secret key, so the files are never orphaned", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    findMany.mockResolvedValue([{ id: "u1" }]);
    const result = await purgeDueAccounts(now);
    expect(createClient).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, failed: 1 });
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ level: "warn" }));
  });

  it("spares someone who pressed Keep my account after the list was read", async () => {
    findMany.mockResolvedValue([{ id: "u1" }]);
    findFirst.mockResolvedValue(null);
    const result = await purgeDueAccounts(now);
    expect(list).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, failed: 0 });
  });

  it("keeps going when one account fails to delete", async () => {
    findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    executeRaw.mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce(1);
    expect(await purgeDueAccounts(now)).toMatchObject({ deleted: 1, failed: 1 });
  });

  it("keeps an account whose paid plan would still charge, and alerts", async () => {
    findMany.mockResolvedValue([{ id: "u1" }]);
    subFindUnique.mockResolvedValue({ providerSubscriptionId: "sub_1", status: "ACTIVE", cancelAtPeriodEnd: false });
    const result = await purgeDueAccounts(now);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, failed: 1 });
  });

  it("erases an account whose plan is cancelled at period end", async () => {
    findMany.mockResolvedValue([{ id: "u1" }]);
    subFindUnique.mockResolvedValue({ providerSubscriptionId: "sub_1", status: "ACTIVE", cancelAtPeriodEnd: true });
    expect(await purgeDueAccounts(now)).toMatchObject({ deleted: 1 });
  });

  it("unlinks the account's analytics events (user, business, visit session, properties) before deleting", async () => {
    findMany.mockResolvedValue([{ id: "u1" }]);
    findFirst.mockResolvedValue({ id: "u1" });
    subFindUnique.mockResolvedValue(null);
    executeRaw.mockResolvedValue(1);
    list.mockResolvedValue({ data: [], error: null });
    await purgeDueAccounts(now);
    expect(eventsUpdate).toHaveBeenCalledWith({
      where: { OR: [{ userId: "u1" }, { businessId: "biz1" }] },
      data: { userId: null, businessId: null, sessionId: null, props: "DbNull" },
    });
  });
});
