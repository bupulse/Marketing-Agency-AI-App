import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ storage: { from: () => ({ createSignedUrl: storage.createSignedUrl }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { signedLogoUrl } from "@/lib/storage";

beforeEach(() => {
  let n = 0;
  storage.createSignedUrl.mockReset().mockImplementation(async () => ({ data: { signedUrl: `https://cdn.example.test/logo?token=${++n}` }, error: null }));
});

describe("the company logo's link on every dashboard page", () => {
  it("is made once and reused for 50 minutes, then made again", async () => {
    const t0 = Date.UTC(2026, 9, 23, 8);
    const first = await signedLogoUrl("u1/logo.png", t0);
    expect(await signedLogoUrl("u1/logo.png", t0 + 49 * 60_000)).toBe(first);
    expect(storage.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(storage.createSignedUrl).toHaveBeenCalledWith("u1/logo.png", 3600);
    expect(await signedLogoUrl("u1/logo.png", t0 + 51 * 60_000)).not.toBe(first);
    expect(storage.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps one link per logo, and a failure is not remembered", async () => {
    const t0 = Date.UTC(2026, 9, 23, 9);
    expect(await signedLogoUrl("u2/logo.png", t0)).not.toBe(await signedLogoUrl("u3/logo.png", t0));
    storage.createSignedUrl.mockResolvedValueOnce({ data: null, error: new Error("Object not found") });
    await expect(signedLogoUrl("u4/logo.png", t0)).rejects.toThrow("Object not found");
    expect(await signedLogoUrl("u4/logo.png", t0)).toMatch(/token=/);
  });
});
