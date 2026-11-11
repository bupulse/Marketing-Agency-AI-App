import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The one client sign-in and the connection flows across hosts (docs/HOSTS.md): safe `next`, the remembered return
// path, the origins we accept, and a connection that starts and finishes on bupulse.com and lands back on the
// Marketing host.

const h = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!h.headers) throw new Error("outside a request");
    return h.headers;
  },
}));

import { safeNext } from "@/lib/auth/safe-next";
import { cleanReturn, hasReturn, returnCookieOptions } from "@/lib/auth/return-path";
import { frontLinkUrl, linkSiteUrl, requestSiteUrl } from "@/lib/auth/request-site";
import { originFor } from "@/lib/auth/site-url";
import { done } from "@/lib/social/callback-response";
import { hostRoute } from "@/lib/platform/app-hosts";

const PROD = { NEXT_PUBLIC_SITE_URL: "https://bupulse.com", PUBLIC_LINK_URL: "", AUTH_EXTRA_ORIGINS: "", MARKETING_APP_URL: "https://marketing.bupulse.com", ADMIN_APP_URL: "https://admin.bupulse.com", CLIENT_COOKIE_DOMAIN: ".bupulse.com" };
const at = (host: string) => new Headers({ host, "x-forwarded-proto": "https" });

afterEach(() => {
  vi.unstubAllEnvs();
  h.headers = null;
});

describe("split off: unchanged", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
    for (const k of ["MARKETING_APP_URL", "ADMIN_APP_URL", "CLIENT_COOKIE_DOMAIN"]) vi.stubEnv(k, "");
  });
  it("same-site paths only, the dashboard by default, a host-only return cookie", () => {
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext("https://marketing.bupulse.com/posts")).toBe("/dashboard");
    expect(safeNext("//evil.test")).toBe("/dashboard");
    expect(safeNext("/dashboard/billing?x=1")).toBe("/dashboard/billing?x=1");
    expect(cleanReturn(undefined)).toBe("/dashboard");
    expect(hasReturn("/dashboard")).toBe(false);
    expect(returnCookieOptions(true)).not.toHaveProperty("domain");
    expect(originFor(at("marketing.bupulse.com"))).toBe("https://bupulse.com");
  });
});

describe("split on", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(PROD)) vi.stubEnv(k, v);
  });

  it("safe next: our client hosts' addresses become app paths; the chooser by default; anything else refused", () => {
    expect(safeNext(null)).toBe("/apps");
    expect(safeNext("https://marketing.bupulse.com/stores/shopify?shop=a&hmac=b")).toBe("/dashboard/stores/shopify?shop=a&hmac=b");
    expect(safeNext("https://admin.bupulse.com/companies")).toBe("/apps");
    expect(safeNext("https://evil.test/")).toBe("/apps");
    expect(safeNext("https://marketing.bupulse.com.evil.test/")).toBe("/apps");
    expect(safeNext("javascript:alert(1)")).toBe("/apps");
    expect(safeNext("/\\evil.test")).toBe("/apps");
    expect(safeNext("/creator")).toBe("/creator");
    // bupulse.com then sends the app path on to the Marketing host, clean.
    expect(hostRoute("GET", "/dashboard/stores/shopify", "?shop=a&hmac=b", "bupulse.com")).toEqual({ action: "redirect", url: "https://marketing.bupulse.com/stores/shopify?shop=a&hmac=b" });
  });

  it("the return path is shared with the Marketing host, where /welcome and /onboarding read it", () => {
    expect(returnCookieOptions(true)).toMatchObject({ domain: ".bupulse.com", httpOnly: true, sameSite: "lax", path: "/" });
    expect(hasReturn("/dashboard")).toBe(true); // the default is the chooser now
    expect(hasReturn("/apps")).toBe(false);
  });

  it("accepts the Marketing and admin hosts as origins of a request, never a look-alike", async () => {
    expect(originFor(at("marketing.bupulse.com"))).toBe("https://marketing.bupulse.com");
    expect(originFor(at("admin.bupulse.com"))).toBe("https://admin.bupulse.com");
    expect(originFor(at("marketing.bupulse.com.evil.test"))).toBe("https://bupulse.com");
    h.headers = at("marketing.bupulse.com");
    expect(await requestSiteUrl()).toBe("https://marketing.bupulse.com");
    expect(await linkSiteUrl()).toBe("https://marketing.bupulse.com");
    // Sign-in, invitations, the creator portal and the public API are bupulse.com's, wherever the link is made.
    expect(await frontLinkUrl()).toBe("https://bupulse.com");
    h.headers = at("admin.bupulse.com");
    expect(await frontLinkUrl()).toBe("https://bupulse.com");
    h.headers = at("bupulse.com");
    expect(await frontLinkUrl()).toBe("https://bupulse.com");
  });

  it("a social connection: started from the Marketing host, run on bupulse.com, back on the Marketing host", async () => {
    // 1. "Connect" on marketing.bupulse.com/connections goes to bupulse.com's start route.
    expect(hostRoute("GET", "/api/social/facebook/connect", "?next=%2Fdashboard%2Fconnections", "marketing.bupulse.com")).toEqual({
      action: "redirect",
      url: "https://bupulse.com/api/social/facebook/connect?next=%2Fdashboard%2Fconnections",
    });
    // 2. The network calls back on bupulse.com, which keeps it (state cookie and shared session are there).
    expect(hostRoute("GET", "/api/social/facebook/callback", "?code=c&state=s", "bupulse.com")).toEqual({ action: "pass" });
    // 3. The callback ends on bupulse.com/dashboard/connections?connected=facebook ...
    h.headers = at("bupulse.com");
    const res = await done("/dashboard/connections", { connected: "facebook" });
    const back = new URL(res.headers.get("location")!);
    expect(back.origin + back.pathname).toBe("https://bupulse.com/dashboard/connections");
    // 4. ... which bupulse.com sends to the Marketing host's clean page, keeping the outcome.
    expect(hostRoute("GET", back.pathname, back.search, "bupulse.com")).toEqual({ action: "redirect", url: "https://marketing.bupulse.com/connections?connected=facebook" });
  });
});
