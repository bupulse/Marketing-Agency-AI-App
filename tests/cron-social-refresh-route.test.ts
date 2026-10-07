import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refreshConnectionById: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/social/connections", () => ({ refreshConnectionById: mocks.refreshConnectionById }));
vi.mock("@/lib/db", () => ({ prisma: { connection: { findMany: mocks.findMany } } }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no"); } }));

import { POST } from "@/app/api/cron/social-refresh/route";

const call = (authorization?: string) =>
  POST(new NextRequest("https://bupulse.test/api/cron/social-refresh", { method: "POST", headers: authorization ? { authorization } : {} }));

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRON_SECRET = "s3cret";
  mocks.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
  mocks.refreshConnectionById.mockImplementation(async (id: string) => id !== "b");
});

describe("social-refresh cron route", () => {
  it("needs CRON_SECRET and the right bearer token", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer s3cret")).status).toBe(500);
    process.env.CRON_SECRET = "s3cret";
    for (const header of [undefined, "Bearer wrong", "s3cret"]) expect((await call(header)).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("refreshes connections expiring within seven days and counts failures", async () => {
    const response = await call("Bearer s3cret");
    expect(await response.json()).toEqual({ due: 3, refreshed: 2, failed: 1 });
    const where = mocks.findMany.mock.calls[0][0].where;
    const horizon = where.expiresAt.lt.getTime() - Date.now();
    expect(horizon).toBeGreaterThan(6.9 * 86_400_000);
    expect(horizon).toBeLessThanOrEqual(7 * 86_400_000);
    expect(where).toMatchObject({ kind: "SOCIAL", postingMode: "AUTO" });
  });
});
