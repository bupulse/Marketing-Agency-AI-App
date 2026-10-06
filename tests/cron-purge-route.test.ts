import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { purgeDueAccounts } = vi.hoisted(() => ({ purgeDueAccounts: vi.fn() }));
vi.mock("@/lib/account-deletion", () => ({ purgeDueAccounts }));

import { POST } from "@/app/api/cron/purge-accounts/route";

function call(authorization?: string) {
  return POST(
    new NextRequest("https://bupulse.test/api/cron/purge-accounts", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );
}

describe("purge-accounts cron route", () => {
  beforeEach(() => {
    purgeDueAccounts.mockReset();
    purgeDueAccounts.mockResolvedValue({ due: 1, deleted: 1, failed: 0, filesRemoved: 3 });
    process.env.CRON_SECRET = "s3cret";
  });

  it("returns 500 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer s3cret")).status).toBe(500);
    expect(purgeDueAccounts).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong", "s3cret", "Bearer s3cret2"])("returns 401 for %s", async (header) => {
    expect((await call(header)).status).toBe(401);
    expect(purgeDueAccounts).not.toHaveBeenCalled();
  });

  it("runs the purge with the right secret", async () => {
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ due: 1, deleted: 1, failed: 0, filesRemoved: 3 });
  });
});
