import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/admin/console", () => ({ adminAction: vi.fn(async () => ({ id: "admin-1" })), actionMessage: vi.fn(), finish: vi.fn(), userIdOf: vi.fn() }));

import { setDisplayCurrencyAction } from "@/app/admin/(console)/actions";

describe("admin display currency", () => {
  beforeEach(() => set.mockClear());

  it("keeps the choice for the whole admin host, so admin.bupulse.com's clean paths send it back", async () => {
    expect(await setDisplayCurrencyAction("RWF")).toEqual({ ok: true });
    expect(set).toHaveBeenCalledTimes(1);
    const [, value, options] = set.mock.calls[0];
    expect(value).toBe("RWF");
    expect(options.path).toBe("/");
  });

  it("refuses an unknown currency", async () => {
    expect(await setDisplayCurrencyAction("XYZ")).toEqual({ ok: false });
    expect(set).not.toHaveBeenCalled();
  });
});
