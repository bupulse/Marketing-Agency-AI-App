import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The proxy's dashboard gate reads the signed session token locally (getClaims) instead of asking Supabase Auth on
// every request (getUser). Pages keep the full check (lib/supabase/server.ts getCurrentUser).
const auth = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));

import { proxy } from "@/proxy";

beforeEach(() => {
  auth.getClaims.mockReset();
  auth.getUser.mockReset().mockRejectedValue(new Error("the proxy must not call getUser"));
});

describe("the proxy's sign-in gate", () => {
  it("lets a signed-in person into the dashboard from the token, with no round trip to Supabase Auth", async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", exp: 9_999_999_999 } }, error: null });
    const res = await proxy(new NextRequest("https://app.bupulse.test/dashboard/content"));
    expect(res.headers.get("location")).toBeNull();
    expect(auth.getClaims).toHaveBeenCalledTimes(1);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("sends a visitor without a valid token to sign in, keeping where they were going", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: new Error("Invalid JWT signature") });
    const res = await proxy(new NextRequest("https://app.bupulse.test/dashboard/billing?tab=plans"));
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/dashboard/billing?tab=plans");
  });

  it("leaves public pages open to signed-out visitors", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    const res = await proxy(new NextRequest("https://app.bupulse.test/pricing"));
    expect(res.headers.get("location")).toBeNull();
  });
});
