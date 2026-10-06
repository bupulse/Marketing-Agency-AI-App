import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));
vi.mock("@/lib/account", () => ({ ensureAccount: vi.fn() }));

import { GET } from "@/app/auth/callback/route";

async function callback(query: string) {
  const response = await GET(new NextRequest(`https://bupulse.test/auth/callback${query}`));
  return response.headers.get("location");
}

describe("auth callback redirect", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("goes to the dashboard by default", async () => {
    expect(await callback("?code=abc")).toBe("https://bupulse.test/dashboard");
  });

  it("follows a same-site next path", async () => {
    expect(await callback("?code=abc&next=/dashboard/settings")).toBe(
      "https://bupulse.test/dashboard/settings",
    );
  });

  it.each(["//evil.com", "https://evil.com", "evil.com/path"])("ignores the external target %s", async (next) => {
    expect(await callback(`?code=abc&next=${encodeURIComponent(next)}`)).toBe(
      "https://bupulse.test/dashboard",
    );
  });

  it("returns to login without a code", async () => {
    expect(await callback("")).toBe("https://bupulse.test/login?error=callback");
  });

  it("returns to login when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: new Error("bad code") });
    expect(await callback("?code=bad")).toBe("https://bupulse.test/login?error=callback");
  });
});
