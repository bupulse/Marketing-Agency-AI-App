import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// proxy.ts with the host split on (docs/HOSTS.md) and off: redirects, rewrites, the sign-in gate, the session cookie
// each host uses, and the small cookie that tells the browser which one.

const auth = vi.hoisted(() => ({ signedIn: false, options: [] as unknown[] }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: unknown) => {
    auth.options.push(options);
    return { auth: { getClaims: async () => ({ data: auth.signedIn ? { claims: { sub: "u1" } } : null, error: null }), getUser: async () => ({ data: { user: null } }) } };
  },
}));

import { proxy } from "@/proxy";

const PROD = { NEXT_PUBLIC_SITE_URL: "https://bupulse.com", MARKETING_APP_URL: "https://marketing.bupulse.com", ADMIN_APP_URL: "https://admin.bupulse.com", CLIENT_COOKIE_DOMAIN: ".bupulse.com" };
const on = () => Object.entries(PROD).forEach(([k, v]) => vi.stubEnv(k, v));
const req = (url: string, init: { method?: string; cookie?: string } = {}) => {
  const u = new URL(url);
  return new NextRequest(url, { method: init.method ?? "GET", headers: { host: u.host, ...(init.cookie ? { cookie: init.cookie } : {}) } });
};
const lastCookieOptions = () => (auth.options.at(-1) as { cookieOptions?: Record<string, unknown> } | undefined)?.cookieOptions;

beforeEach(() => {
  auth.signedIn = false;
  auth.options = [];
  vi.stubEnv("MARKETING_APP_URL", "");
  vi.stubEnv("ADMIN_APP_URL", "");
  vi.stubEnv("CLIENT_COOKIE_DOMAIN", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("with the split off (nothing set): exactly as before", () => {
  it("serves the dashboard and admin on one host, gates the dashboard, and uses Supabase's default cookie", async () => {
    const dash = await proxy(req("https://bupulse.com/dashboard/posts?x=1"));
    expect(dash.status).toBe(307);
    expect(new URL(dash.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(dash.headers.get("location")!).searchParams.get("next")).toBe("/dashboard/posts?x=1");
    expect(lastCookieOptions()).toBeUndefined();

    auth.signedIn = true;
    const inside = await proxy(req("https://bupulse.com/dashboard/posts"));
    expect(inside.headers.get("location")).toBeNull();
    expect(inside.headers.get("x-middleware-rewrite")).toBeNull();
    const admin = await proxy(req("https://bupulse.com/admin/companies"));
    expect(admin.headers.get("location")).toBeNull();
    expect(admin.headers.get("set-cookie") ?? "").not.toContain("bp-auth-scope");
  });

  it("a request to marketing.bupulse.com is the main site (nothing routes there)", async () => {
    auth.signedIn = true;
    const res = await proxy(req("https://marketing.bupulse.com/posts"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("removes a stale browser hint left from when the split was on", async () => {
    const res = await proxy(req("https://bupulse.com/pricing", { cookie: "bp-auth-scope=client%3A.bupulse.com" }));
    expect(res.headers.get("set-cookie")).toMatch(/bp-auth-scope=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });
});

describe("with the split on", () => {
  beforeEach(on);

  it("sends bupulse.com's dashboard and set-up pages to the Marketing host, 307, keeping the query", async () => {
    const res = await proxy(req("https://bupulse.com/dashboard/stores/shopify?shop=a.myshopify.com&hmac=h"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://marketing.bupulse.com/stores/shopify?shop=a.myshopify.com&hmac=h");
    const welcome = await proxy(req("https://bupulse.com/welcome"));
    expect(welcome.headers.get("location")).toBe("https://marketing.bupulse.com/welcome");
  });

  it("sends bupulse.com/admin to the admin host and bounces the Google Calendar callback there", async () => {
    expect((await proxy(req("https://bupulse.com/admin/companies?q=a"))).headers.get("location")).toBe("https://admin.bupulse.com/companies?q=a");
    expect((await proxy(req("https://bupulse.com/api/admin/google-calendar/callback?code=c&state=s"))).headers.get("location")).toBe("https://admin.bupulse.com/api/admin/google-calendar/callback?code=c&state=s");
  });

  it("keeps sign-in, the chooser, connections and the public site on bupulse.com, with the shared client cookie", async () => {
    for (const path of ["/login", "/signup", "/auth/callback?code=x", "/auth/google?code=x", "/pricing", "/api/social/facebook/callback?code=x"]) {
      const res = await proxy(req(`https://bupulse.com${path}`));
      expect(res.headers.get("location"), path).toBeNull();
    }
    expect(lastCookieOptions()).toEqual({ name: "bp-client-auth", domain: ".bupulse.com", path: "/", sameSite: "lax", secure: true });
  });

  it("gates the chooser on bupulse.com", async () => {
    const res = await proxy(req("https://bupulse.com/apps"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("serves the Marketing host's clean paths from /dashboard when signed in, noindex", async () => {
    auth.signedIn = true;
    const res = await proxy(req("https://marketing.bupulse.com/posts?tab=week"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://marketing.bupulse.com/dashboard/posts?tab=week");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(lastCookieOptions()).toEqual({ name: "bp-client-auth", domain: ".bupulse.com", path: "/", sameSite: "lax", secure: true });
    expect(res.headers.get("set-cookie")).toContain("bp-auth-scope=client%3A.bupulse.com");
    const home = await proxy(req("https://marketing.bupulse.com/"));
    expect(home.headers.get("x-middleware-rewrite")).toBe("https://marketing.bupulse.com/dashboard");
  });

  it("cleans /dashboard addresses on the Marketing host (soft navigations land on the clean URL)", async () => {
    auth.signedIn = true;
    const res = await proxy(req("https://marketing.bupulse.com/dashboard/posts?x=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://marketing.bupulse.com/posts?x=1");
  });

  it("signed out on the Marketing host: the one sign-in on bupulse.com, back to the clean address", async () => {
    const res = await proxy(req("https://marketing.bupulse.com/stores/shopify?shop=a&hmac=b"));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://bupulse.com");
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("https://marketing.bupulse.com/stores/shopify?shop=a&hmac=b");
    const setup = await proxy(req("https://marketing.bupulse.com/start-trial"));
    expect(new URL(setup.headers.get("location")!).searchParams.get("next")).toBe("https://marketing.bupulse.com/start-trial");
  });

  it("never gates assets, APIs or auth routes on the Marketing host", async () => {
    for (const path of ["/api/contacts", "/auth/signout", "/_next/static/x.js"]) {
      const res = await proxy(req(`https://marketing.bupulse.com${path}`, { method: path === "/auth/signout" ? "POST" : "GET" }));
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("sends a connection start reached on the Marketing host to bupulse.com, where its callback is", async () => {
    auth.signedIn = true;
    const res = await proxy(req("https://marketing.bupulse.com/api/social/linkedin/connect?next=%2Fdashboard%2Fconnections"));
    expect(res.headers.get("location")).toBe("https://bupulse.com/api/social/linkedin/connect?next=%2Fdashboard%2Fconnections");
  });

  it("the admin host: clean paths, its own host-only cookie, no client gate, noindex", async () => {
    const res = await proxy(req("https://admin.bupulse.com/companies"));
    expect(res.headers.get("location")).toBeNull(); // requireAdmin decides, as before
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://admin.bupulse.com/admin/companies");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(lastCookieOptions()).toEqual({ name: "bp-admin-auth", path: "/", sameSite: "lax", secure: true });
    expect(res.headers.get("set-cookie")).toContain("bp-auth-scope=admin");
    const login = await proxy(req("https://admin.bupulse.com/login"));
    expect(login.headers.get("x-middleware-rewrite")).toBe("https://admin.bupulse.com/admin/login");
    const old = await proxy(req("https://admin.bupulse.com/admin/verify"));
    expect(old.headers.get("location")).toBe("https://admin.bupulse.com/verify");
  });

  it("the support host is untouched: its rewrite, the default cookie, no hint", async () => {
    const res = await proxy(req("https://support.bupulse.com/visitors"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://support.bupulse.com/support/visitors");
    expect(lastCookieOptions()).toBeUndefined();
    expect(res.headers.get("set-cookie") ?? "").not.toContain("bp-auth-scope");
  });

  it("never redirects a POST between hosts (WooCommerce's server callback, forms, server actions)", async () => {
    const woo = await proxy(req("https://bupulse.com/api/stores/woocommerce/callback", { method: "POST" }));
    expect(woo.headers.get("location")).toBeNull();
    auth.signedIn = true;
    const action = await proxy(req("https://marketing.bupulse.com/posts", { method: "POST" }));
    expect(action.headers.get("location")).toBeNull();
    expect(action.headers.get("x-middleware-rewrite")).toBe("https://marketing.bupulse.com/dashboard/posts");
  });

  it("Next.js's own fetch of an action's redirect target: the visitor's host and cookie, and no cross-host redirect", async () => {
    auth.signedIn = true;
    const self = (path: string) => new NextRequest(`http://localhost:3002${path}`, { headers: { host: "localhost:3002", "x-forwarded-host": "marketing.bupulse.com" } });
    const page = await proxy(self("/settings"));
    expect(page.headers.get("x-middleware-rewrite")).toBe("http://localhost:3002/dashboard/settings");
    expect(lastCookieOptions()).toMatchObject({ name: "bp-client-auth", domain: ".bupulse.com" });
    // A redirect is left to the browser (an empty non-RSC answer), never followed by the server without cookies.
    const old = await proxy(self("/dashboard/settings"));
    expect(old.status).toBe(204);
    expect(old.headers.get("location")).toBeNull();
    auth.signedIn = false;
    const gate = await proxy(self("/settings"));
    expect(gate.status).toBe(204);
  });

  it("a forged Host header is just the front host: no redirect anywhere else", async () => {
    const res = await proxy(new NextRequest("https://bupulse.com/dashboard", { headers: { host: "evil.test" } }));
    expect(new URL(res.headers.get("location")!).origin).toBe("https://marketing.bupulse.com");
  });
});
