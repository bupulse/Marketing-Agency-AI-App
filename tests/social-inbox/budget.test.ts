import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn(), adminSetting: { findUnique: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { composioCallsThisMonth, countComposioCalls, pollLimit, replyReserve, reserveComposioCalls, usageKey } from "@/lib/social/inbox/budget";
import { cleanInboxSetting, DEFAULT_INBOX_SETTINGS } from "@/lib/social/inbox/settings";

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

beforeEach(() => vi.clearAllMocks());

describe("monthly Composio budget", () => {
  it("defaults to 18,000 calls, with checks stopping 500 calls earlier", () => {
    expect(DEFAULT_INBOX_SETTINGS.monthlyCap).toBe(18_000);
    expect(replyReserve(18_000)).toBe(500);
    expect(pollLimit(18_000)).toBe(17_500);
    expect(pollLimit(0)).toBe(0);
  });

  it("never lets an admin set more than Composio's 20,000 free Meta calls", () => {
    expect(cleanInboxSetting.monthlyCap("19,000")).toBe(19_000);
    expect(() => cleanInboxSetting.monthlyCap(25_000)).toThrow(/0 to 20,000/);
    expect(() => cleanInboxSetting.monthlyCap(-1)).toThrow();
    expect(() => cleanInboxSetting.transport("smoke-signals")).toThrow();
  });

  it("reserves atomically: the database refuses a reservation that would pass the limit", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ used: 17_500 }]);
    expect(await reserveComposioCalls(1, 17_500)).toBe(true);
    const sql = sqlOf(mocks.prisma.$queryRaw.mock.calls[0]);
    expect(sql).toMatch(/ON CONFLICT \("key"\) DO UPDATE/);
    expect(sql).toMatch(/WHERE \("AdminSetting"\."value" #>> '\{\}'\)::int \+ \?::int <= \?::int/);

    mocks.prisma.$queryRaw.mockResolvedValueOnce([]);
    expect(await reserveComposioCalls(1, 17_500)).toBe(false);
  });

  it("refuses without asking when the request alone is over the limit, and when the count cannot be read", async () => {
    expect(await reserveComposioCalls(3, 2)).toBe(false);
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
    mocks.prisma.$queryRaw.mockRejectedValueOnce(new Error("db down"));
    expect(await reserveComposioCalls(1, 100)).toBe(false);
  });

  it("counts posting calls without ever throwing, one row per month", async () => {
    mocks.prisma.$executeRaw.mockRejectedValueOnce(new Error("db down"));
    await expect(countComposioCalls(1)).resolves.toBeUndefined();
    expect(usageKey(new Date("2026-10-31T23:59:00Z"))).toBe("composio.calls.2026-10");
    expect(usageKey(new Date("2026-11-01T00:00:00Z"))).toBe("composio.calls.2026-11");
    mocks.prisma.adminSetting.findUnique.mockResolvedValueOnce({ key: "composio.calls.2026-10", value: 1234 });
    expect(await composioCallsThisMonth()).toBe(1234);
  });
});
