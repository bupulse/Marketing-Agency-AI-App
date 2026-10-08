import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.fn();
const find = vi.fn();
const del = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { $executeRaw: (...a: unknown[]) => exec(...a), analyticsSalt: { findUnique: (...a: unknown[]) => find(...a), deleteMany: (...a: unknown[]) => del(...a) } } }));

import { getDailySalt, purgeOldSalts } from "@/lib/analytics/salt";

describe("daily salt", () => {
  beforeEach(() => {
    exec.mockReset().mockResolvedValue(1);
    find.mockReset();
    del.mockReset().mockResolvedValue({ count: 2 });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("creates the day's salt once, reads it back and caches it", async () => {
    find.mockResolvedValue({ salt: "abc" });
    const day = new Date("2026-12-01T10:00:00Z");
    expect(await getDailySalt(day)).toBe("abc");
    expect(await getDailySalt(new Date("2026-12-01T23:00:00Z"))).toBe("abc");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh salt on the next day", async () => {
    find.mockResolvedValueOnce({ salt: "d1" }).mockResolvedValueOnce({ salt: "d2" });
    expect(await getDailySalt(new Date("2026-12-02T10:00:00Z"))).toBe("d1");
    expect(await getDailySalt(new Date("2026-12-03T10:00:00Z"))).toBe("d2");
  });

  it("returns null instead of throwing when the database fails", async () => {
    exec.mockRejectedValue(new Error("down"));
    expect(await getDailySalt(new Date("2026-12-04T10:00:00Z"))).toBeNull();
  });

  it("purges only salts of days that have ended", async () => {
    expect(await purgeOldSalts(new Date("2026-12-05T01:00:00Z"))).toBe(2);
    expect(del).toHaveBeenCalledWith({ where: { day: { lt: "2026-12-05" } } });
  });
});
