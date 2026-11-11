import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_AUTH_COOKIE,
  CLIENT_AUTH_COOKIE,
  adminOrigin,
  afterSignInPath,
  appPathOn,
  appUrl,
  authCookieFor,
  authCookieFromScope,
  authScopeValue,
  browserClientCookieDomain,
  cleanPath,
  clientCookieDomain,
  hostKind,
  hostRewriteUrl,
  hostRoute,
  hostsConfig,
  hrefOn,
  isSelfFetch,
  marketingAppPath,
  requestHost,
  marketingOrigin,
  nextFromUrl,
  serviceHome,
  sessionCookieOptions,
  SERVICES,
} from "@/lib/platform/app-hosts";
import { marketingStatus, pickedServices, readPicks } from "@/lib/platform/services-shared";

// The host split (docs/HOSTS.md): bupulse.com (sign-in, chooser, connections), marketing.bupulse.com (the dashboard,
// clean paths), admin.bupulse.com (the console, its own cookie). Everything is decided from the environment passed in.

const PROD = { NEXT_PUBLIC_SITE_URL: "https://bupulse.com", MARKETING_APP_URL: "https://marketing.bupulse.com", ADMIN_APP_URL: "https://admin.bupulse.com", CLIENT_COOKIE_DOMAIN: ".bupulse.com" };
const OFF = { NEXT_PUBLIC_SITE_URL: "https://bupulse.com" };
const LOCAL = { NEXT_PUBLIC_SITE_URL: "http://bupulse.localhost:3041", MARKETING_APP_URL: "http://marketing.bupulse.localhost:3041", ADMIN_APP_URL: "http://admin.bupulse.localhost:3041", CLIENT_COOKIE_DOMAIN: ".bupulse.localhost" };

const route = (host: string, path: string, env: Record<string, string>, method = "GET", search = "") => hostRoute(method, path, search, host, env);

describe("configuration", () => {
  it("is off when nothing is set: every host is the front host, nothing moves", () => {
    expect(marketingOrigin(OFF)).toBeNull();
    expect(adminOrigin(OFF)).toBeNull();
    expect(clientCookieDomain(OFF)).toBeNull();
    for (const host of ["bupulse.com", "marketing.bupulse.com", "admin.bupulse.com", "localhost:3000", "test.bupulse.com"]) expect(hostKind(host, OFF)).toBe("front");
    for (const path of ["/dashboard", "/dashboard/posts", "/admin", "/login", "/api/social/facebook/callback", "/api/admin/google-calendar/callback"]) {
      expect(route("bupulse.com", path, OFF)).toEqual({ action: "pass" });
      expect(route("marketing.bupulse.com", path, OFF)).toEqual({ action: "pass" });
    }
    expect(afterSignInPath(OFF)).toBe("/dashboard");
    expect(serviceHome("marketing", OFF)).toBe("/dashboard");
  });

  it("needs CLIENT_COOKIE_DOMAIN for the Marketing host (one sign-in on bupulse.com must reach it)", () => {
    expect(marketingOrigin({ ...PROD, CLIENT_COOKIE_DOMAIN: "" })).toBeNull();
    expect(marketingOrigin({ ...PROD, CLIENT_COOKIE_DOMAIN: ".example.com" })).toBeNull(); // the front host is not inside it
    expect(marketingOrigin({ ...PROD, MARKETING_APP_URL: "https://marketing.example.com" })).toBeNull(); // nor the Marketing host
    expect(marketingOrigin(PROD)).toBe("https://marketing.bupulse.com");
    // The admin host has its own host-only cookie, so it works without the client cookie domain.
    expect(adminOrigin({ ...PROD, CLIENT_COOKIE_DOMAIN: "" })).toBe("https://admin.bupulse.com");
  });

  it("ignores addresses that are not bare http(s) origins, or that repeat another host", () => {
    for (const bad of ["javascript:alert(1)", "https://marketing.bupulse.com/x", "https://marketing.bupulse.com?x=1", "https://u:p@marketing.bupulse.com", "marketing.bupulse.com", "ftp://marketing.bupulse.com", "https://bupulse.com"]) {
      expect(marketingOrigin({ ...PROD, MARKETING_APP_URL: bad })).toBeNull();
    }
    expect(adminOrigin({ ...PROD, ADMIN_APP_URL: PROD.MARKETING_APP_URL })).toBeNull();
    expect(marketingOrigin({ ...PROD, MARKETING_APP_URL: "https://marketing.bupulse.com/" })).toBe("https://marketing.bupulse.com");
    expect(clientCookieDomain({ ...PROD, CLIENT_COOKIE_DOMAIN: ".bu pulse.com" })).toBeNull();
  });

  it("knows each host, with or without the default port, and never a look-alike", () => {
    expect(hostKind("marketing.bupulse.com", PROD)).toBe("marketing");
    expect(hostKind("MARKETING.bupulse.com:443", PROD)).toBe("marketing");
    expect(hostKind("admin.bupulse.com", PROD)).toBe("admin");
    expect(hostKind("support.bupulse.com", PROD)).toBe("support");
    expect(hostKind("bupulse.com", PROD)).toBe("front");
    expect(hostKind("marketing.bupulse.com.evil.test", PROD)).toBe("front");
    expect(hostKind("evilmarketing.bupulse.com", PROD)).toBe("front");
    expect(hostKind(null, PROD)).toBe("front");
    expect(hostKind("marketing.bupulse.localhost:3041", LOCAL)).toBe("marketing");
    expect(hostKind("admin.bupulse.localhost:3041", LOCAL)).toBe("admin");
    expect(hostKind("marketing.bupulse.localhost:3042", LOCAL)).toBe("front");
  });

  it("works with marketing.localhost and admin.localhost for routing (cookie sharing needs a shared parent like bupulse.localhost)", () => {
    const env = { NEXT_PUBLIC_SITE_URL: "http://localhost:3041", MARKETING_APP_URL: "http://marketing.localhost:3041", ADMIN_APP_URL: "http://admin.localhost:3041", CLIENT_COOKIE_DOMAIN: "localhost" };
    expect(hostKind("marketing.localhost:3041", env)).toBe("marketing");
    expect(hostKind("admin.localhost:3041", env)).toBe("admin");
    expect(route("localhost:3041", "/dashboard/posts", env)).toEqual({ action: "redirect", url: "http://marketing.localhost:3041/posts" });
  });
});

describe("paths", () => {
  it("maps app paths to clean paths and back", () => {
    expect(cleanPath("/dashboard")).toBe("/");
    expect(cleanPath("/dashboard/posts")).toBe("/posts");
    expect(cleanPath("/admin/companies/abc")).toBe("/companies/abc");
    expect(cleanPath("/dashboards")).toBe("/dashboards");
    expect(marketingAppPath("/")).toBe("/dashboard");
    expect(marketingAppPath("/posts")).toBe("/dashboard/posts");
    expect(marketingAppPath("/welcome")).toBe("/welcome");
    expect(marketingAppPath("/start-trial")).toBe("/start-trial");
    expect(appPathOn("admin", "/")).toBe("/admin");
    expect(appPathOn("admin", "/industries")).toBe("/admin/industries");
    expect(appPathOn("front", "/pricing")).toBe("/pricing");
  });

  it("never names a dashboard page like a front page the Marketing host sends away", () => {
    const dirs = readdirSync(join(process.cwd(), "app/dashboard")).filter((d) => statSync(join(process.cwd(), "app/dashboard", d)).isDirectory() && !d.startsWith("(") && !d.startsWith("["));
    expect(dirs.length).toBeGreaterThan(10);
    for (const d of dirs) expect(route("marketing.bupulse.com", `/${d}`, PROD), d).toEqual({ action: "rewrite", path: `/dashboard/${d}` });
  });

  it("serves every admin console page on the admin host, /industries and /login included", () => {
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const d of readdirSync(dir)) {
        const full = join(dir, d);
        if (!statSync(full).isDirectory()) continue;
        if (d.startsWith("(")) walk(full);
        else pages.push(d);
      }
    };
    walk(join(process.cwd(), "app/admin"));
    expect(pages).toContain("industries");
    expect(pages).toContain("login");
    for (const p of pages.filter((p) => !p.startsWith("["))) expect(route("admin.bupulse.com", `/${p}`, PROD), p).toEqual({ action: "rewrite", path: `/admin/${p}` });
  });
});

describe("the path table", () => {
  const table: [host: string, path: string, method: string, expected: ReturnType<typeof hostRoute>][] = [
    // bupulse.com: the front page, the one sign-in, the chooser, connections; the Marketing and admin pages move away.
    ["bupulse.com", "/", "GET", { action: "pass" }],
    ["bupulse.com", "/pricing", "GET", { action: "pass" }],
    ["bupulse.com", "/login", "GET", { action: "pass" }],
    ["bupulse.com", "/signup", "GET", { action: "pass" }],
    ["bupulse.com", "/auth/callback", "GET", { action: "pass" }],
    ["bupulse.com", "/auth/google", "GET", { action: "pass" }],
    ["bupulse.com", "/apps", "GET", { action: "pass" }],
    ["bupulse.com", "/creator", "GET", { action: "pass" }],
    ["bupulse.com", "/account/deletion", "GET", { action: "pass" }],
    ["bupulse.com", "/invite/abc", "GET", { action: "pass" }],
    ["bupulse.com", "/api/social/facebook/connect", "GET", { action: "pass" }],
    ["bupulse.com", "/api/social/facebook/callback", "GET", { action: "pass" }],
    ["bupulse.com", "/api/canva/return", "GET", { action: "pass" }],
    ["bupulse.com", "/dashboard", "GET", { action: "redirect", url: "https://marketing.bupulse.com/" }],
    ["bupulse.com", "/dashboard/posts", "GET", { action: "redirect", url: "https://marketing.bupulse.com/posts" }],
    ["bupulse.com", "/welcome", "GET", { action: "redirect", url: "https://marketing.bupulse.com/welcome" }],
    ["bupulse.com", "/start-trial", "HEAD", { action: "redirect", url: "https://marketing.bupulse.com/start-trial" }],
    ["bupulse.com", "/admin", "GET", { action: "redirect", url: "https://admin.bupulse.com/" }],
    ["bupulse.com", "/admin/companies", "GET", { action: "redirect", url: "https://admin.bupulse.com/companies" }],
    ["bupulse.com", "/api/admin/google-calendar/callback", "GET", { action: "redirect", url: "https://admin.bupulse.com/api/admin/google-calendar/callback" }],
    // A POST is never bounced: WooCommerce's server-to-server callback, a stale tab's server action.
    ["bupulse.com", "/api/stores/woocommerce/callback", "POST", { action: "pass" }],
    ["bupulse.com", "/dashboard/posts", "POST", { action: "pass" }],
    ["bupulse.com", "/api/admin/google-calendar/callback", "POST", { action: "pass" }],
    // marketing.bupulse.com: clean paths for the dashboard; sign-in, chooser and public pages go back to bupulse.com.
    ["marketing.bupulse.com", "/", "GET", { action: "rewrite", path: "/dashboard" }],
    ["marketing.bupulse.com", "/posts", "GET", { action: "rewrite", path: "/dashboard/posts" }],
    ["marketing.bupulse.com", "/creators", "GET", { action: "rewrite", path: "/dashboard/creators" }],
    ["marketing.bupulse.com", "/stores/shopify", "GET", { action: "rewrite", path: "/dashboard/stores/shopify" }],
    ["marketing.bupulse.com", "/posts", "POST", { action: "rewrite", path: "/dashboard/posts" }], // a server action
    ["marketing.bupulse.com", "/dashboard/posts", "GET", { action: "redirect", url: "https://marketing.bupulse.com/posts" }],
    ["marketing.bupulse.com", "/dashboard", "GET", { action: "redirect", url: "https://marketing.bupulse.com/" }],
    ["marketing.bupulse.com", "/welcome", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/onboarding", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/start-trial", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/book-demo", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/custom-plan/call", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/login", "GET", { action: "redirect", url: "https://bupulse.com/login" }],
    ["marketing.bupulse.com", "/apps", "GET", { action: "redirect", url: "https://bupulse.com/apps" }],
    ["marketing.bupulse.com", "/suspended", "GET", { action: "redirect", url: "https://bupulse.com/suspended" }],
    ["marketing.bupulse.com", "/account/deletion", "GET", { action: "redirect", url: "https://bupulse.com/account/deletion" }],
    ["marketing.bupulse.com", "/creator", "GET", { action: "redirect", url: "https://bupulse.com/creator" }],
    ["marketing.bupulse.com", "/pricing", "GET", { action: "redirect", url: "https://bupulse.com/pricing" }],
    ["marketing.bupulse.com", "/terms", "GET", { action: "redirect", url: "https://bupulse.com/terms" }],
    ["marketing.bupulse.com", "/admin/companies", "GET", { action: "redirect", url: "https://admin.bupulse.com/companies" }],
    ["marketing.bupulse.com", "/api/social/facebook/connect", "GET", { action: "redirect", url: "https://bupulse.com/api/social/facebook/connect" }],
    ["marketing.bupulse.com", "/api/canva/connect", "GET", { action: "redirect", url: "https://bupulse.com/api/canva/connect" }],
    ["marketing.bupulse.com", "/api/stores/shopify/connect", "GET", { action: "redirect", url: "https://bupulse.com/api/stores/shopify/connect" }],
    ["marketing.bupulse.com", "/api/creator/instagram/connect", "GET", { action: "redirect", url: "https://bupulse.com/api/creator/instagram/connect" }],
    ["marketing.bupulse.com", "/api/generate", "POST", { action: "pass" }], // the dashboard's own API calls
    ["marketing.bupulse.com", "/api/contacts", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/auth/signout", "POST", { action: "pass" }],
    ["marketing.bupulse.com", "/_next/static/chunks/x.js", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/sw.js", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/manifest.webmanifest", "GET", { action: "pass" }],
    ["marketing.bupulse.com", "/icons/icon-192.png", "GET", { action: "pass" }],
    // admin.bupulse.com: the console with clean paths, its own sign-in; never a front page.
    ["admin.bupulse.com", "/", "GET", { action: "rewrite", path: "/admin" }],
    ["admin.bupulse.com", "/companies", "GET", { action: "rewrite", path: "/admin/companies" }],
    ["admin.bupulse.com", "/login", "GET", { action: "rewrite", path: "/admin/login" }],
    ["admin.bupulse.com", "/verify", "GET", { action: "rewrite", path: "/admin/verify" }],
    ["admin.bupulse.com", "/industries", "GET", { action: "rewrite", path: "/admin/industries" }],
    ["admin.bupulse.com", "/pricing", "GET", { action: "rewrite", path: "/admin/pricing" }], // not found there
    ["admin.bupulse.com", "/admin/companies", "GET", { action: "redirect", url: "https://admin.bupulse.com/companies" }],
    ["admin.bupulse.com", "/admin/login", "GET", { action: "redirect", url: "https://admin.bupulse.com/login" }],
    ["admin.bupulse.com", "/dashboard", "GET", { action: "redirect", url: "https://marketing.bupulse.com/" }],
    ["admin.bupulse.com", "/auth/signout", "POST", { action: "pass" }],
    ["admin.bupulse.com", "/api/admin/google-calendar/connect", "GET", { action: "pass" }],
    ["admin.bupulse.com", "/api/admin/google-calendar/callback", "GET", { action: "pass" }],
    ["admin.bupulse.com", "/login", "POST", { action: "rewrite", path: "/admin/login" }], // the sign-in server action
  ];
  it.each(table)("%s %s (%s)", (host, path, method, expected) => {
    expect(route(host, path, PROD, method)).toEqual(expected);
  });

  it("keeps the query on every redirect (a Shopify install link survives)", () => {
    const q = "?shop=x.myshopify.com&hmac=abc&host=h&timestamp=1";
    expect(route("bupulse.com", "/dashboard/stores/shopify", PROD, "GET", q)).toEqual({ action: "redirect", url: `https://marketing.bupulse.com/stores/shopify${q}` });
    expect(route("bupulse.com", "/api/admin/google-calendar/callback", PROD, "GET", "?code=c&state=s")).toEqual({ action: "redirect", url: "https://admin.bupulse.com/api/admin/google-calendar/callback?code=c&state=s" });
  });

  it("only ever redirects to a configured origin, whatever the path or Host header", () => {
    const origins = new Set([PROD.NEXT_PUBLIC_SITE_URL, PROD.MARKETING_APP_URL, PROD.ADMIN_APP_URL]);
    const hosts = ["bupulse.com", "marketing.bupulse.com", "admin.bupulse.com", "evil.test", "marketing.bupulse.com.evil.test"];
    const paths = ["//evil.test/x", "/dashboard//evil.test", "/admin/..//evil.test", "/\\evil.test", "/login", "/dashboard/x", "/api/social/x/connect"];
    for (const h of hosts)
      for (const p of paths) {
        const r = route(h, p, PROD, "GET", "?next=https://evil.test");
        if (r.action === "redirect") expect(origins.has(new URL(r.url).origin), `${h} ${p} -> ${r.url}`).toBe(true);
      }
  });

  it("rewrites to http for a request served locally (the PC behind the tunnel), like supportRewriteUrl", () => {
    expect(hostRewriteUrl("/dashboard/posts", "?x=1", "https://localhost:3002/posts?x=1").toString()).toBe("http://localhost:3002/dashboard/posts?x=1");
    expect(hostRewriteUrl("/dashboard", "", "http://marketing.bupulse.localhost:3041/").toString()).toBe("http://marketing.bupulse.localhost:3041/dashboard");
    expect(hostRewriteUrl("/dashboard", "", "https://marketing.bupulse.com/").toString()).toBe("https://marketing.bupulse.com/dashboard");
  });
});

describe("absolute links", () => {
  it("send app paths to their host, clean, and fall back to the given base when off", () => {
    expect(appUrl("/dashboard/billing", "https://bupulse.com", PROD)).toBe("https://marketing.bupulse.com/billing");
    expect(appUrl("/dashboard/leads?lead=1#x", "https://bupulse.com", PROD)).toBe("https://marketing.bupulse.com/leads?lead=1#x");
    expect(appUrl("/dashboard", "https://bupulse.com", PROD)).toBe("https://marketing.bupulse.com/");
    expect(appUrl("/custom-plan/call", "https://bupulse.com", PROD)).toBe("https://marketing.bupulse.com/custom-plan/call");
    expect(appUrl("/admin/quotes", "https://bupulse.com", PROD)).toBe("https://admin.bupulse.com/quotes");
    expect(appUrl("/auth/confirm?type=recovery", "https://bupulse.com", PROD)).toBe("https://bupulse.com/auth/confirm?type=recovery");
    expect(appUrl("/dashboard/billing", "https://test.bupulse.com/", OFF)).toBe("https://test.bupulse.com/dashboard/billing");
    expect(appUrl("/admin/quotes", "http://localhost:3000", OFF)).toBe("http://localhost:3000/admin/quotes");
  });

  it("builds hrefs from the host the visitor is on", () => {
    const hosts = hostsConfig(PROD);
    expect(hrefOn("marketing", "/dashboard/posts", hosts)).toBe("/posts");
    expect(hrefOn("marketing", "/dashboard", hosts)).toBe("/");
    expect(hrefOn("marketing", "/apps", hosts)).toBe("https://bupulse.com/apps");
    expect(hrefOn("marketing", "/api/social/facebook/connect?next=x", hosts)).toBe("https://bupulse.com/api/social/facebook/connect?next=x");
    expect(hrefOn("admin", "/admin/companies", hosts)).toBe("/companies");
    expect(hrefOn("admin", "/dashboard", hosts)).toBe("https://marketing.bupulse.com/");
    expect(hrefOn("front", "/dashboard/content", hosts)).toBe("https://marketing.bupulse.com/content");
    expect(hrefOn("front", "/pricing", hosts)).toBe("/pricing");
    const off = hostsConfig(OFF);
    for (const p of ["/dashboard/posts", "/admin/companies", "/apps"]) expect(hrefOn("front", p, off)).toBe(p);
  });
});

describe("safe next", () => {
  it("turns an absolute address on our client hosts into the app path, and refuses everything else", () => {
    expect(nextFromUrl("https://marketing.bupulse.com/posts?x=1", PROD)).toBe("/dashboard/posts?x=1");
    expect(nextFromUrl("https://marketing.bupulse.com/", PROD)).toBe("/dashboard");
    expect(nextFromUrl("https://marketing.bupulse.com/start-trial", PROD)).toBe("/start-trial");
    expect(nextFromUrl("https://bupulse.com/creator", PROD)).toBe("/creator");
    for (const bad of ["https://admin.bupulse.com/companies", "https://evil.test/", "https://marketing.bupulse.com@evil.test/", "https://user:pw@marketing.bupulse.com/", "javascript:alert(1)", "//marketing.bupulse.com/x", "https://marketing.bupulse.com.evil.test/", "http://marketing.bupulse.com/x"]) {
      expect(nextFromUrl(bad, PROD), bad).toBeNull();
    }
    expect(nextFromUrl("https://marketing.bupulse.com/posts", OFF)).toBeNull();
    expect(nextFromUrl("https://bupulse.com/creator", OFF)).toBeNull();
  });

  it("sends a sign-in to the chooser once the Marketing host is on", () => {
    expect(afterSignInPath(PROD)).toBe("/apps");
    expect(serviceHome("marketing", PROD)).toBe("https://marketing.bupulse.com/");
    expect(serviceHome("agency", PROD)).toBeNull();
    expect(SERVICES.find((s) => s.id === "agency")?.ready).toBe(false);
  });
});

describe("session cookies", () => {
  it("one shared client cookie for bupulse.com and the Marketing host, the admin host's own, the default elsewhere", () => {
    expect(authCookieFor("bupulse.com", PROD)).toEqual({ name: CLIENT_AUTH_COOKIE, domain: ".bupulse.com" });
    expect(authCookieFor("www.bupulse.com", PROD)).toEqual({ name: CLIENT_AUTH_COOKIE, domain: ".bupulse.com" });
    expect(authCookieFor("marketing.bupulse.com", PROD)).toEqual({ name: CLIENT_AUTH_COOKIE, domain: ".bupulse.com" });
    expect(authCookieFor("admin.bupulse.com", PROD)).toEqual({ name: ADMIN_AUTH_COOKIE });
    expect(authCookieFor("support.bupulse.com", PROD)).toBeNull();
    expect(authCookieFor("localhost:3002", PROD)).toBeNull(); // not inside the cookie domain
    expect(authCookieFor("evil.test", PROD)).toBeNull();
    for (const h of ["bupulse.com", "marketing.bupulse.com", "admin.bupulse.com", "support.bupulse.com"]) expect(authCookieFor(h, OFF)).toBeNull();
  });

  it("gives Supabase the same options on every client host (secure on https), none when off", () => {
    expect(sessionCookieOptions("marketing.bupulse.com", PROD)).toEqual({ name: CLIENT_AUTH_COOKIE, domain: ".bupulse.com", path: "/", sameSite: "lax", secure: true });
    expect(sessionCookieOptions("bupulse.com", PROD)).toEqual(sessionCookieOptions("marketing.bupulse.com", PROD));
    expect(sessionCookieOptions("admin.bupulse.com", PROD)).toEqual({ name: ADMIN_AUTH_COOKIE, path: "/", sameSite: "lax", secure: true });
    expect(sessionCookieOptions("marketing.bupulse.localhost:3041", LOCAL)).toEqual({ name: CLIENT_AUTH_COOKIE, domain: ".bupulse.localhost", path: "/", sameSite: "lax", secure: false });
    expect(sessionCookieOptions("support.bupulse.com", PROD)).toBeUndefined();
    expect(sessionCookieOptions("bupulse.com", OFF)).toBeUndefined();
  });

  it("tells the browser which cookie to use, and reads only what it expects back", () => {
    expect(authScopeValue(authCookieFor("marketing.bupulse.com", PROD))).toBe("client:.bupulse.com");
    expect(authScopeValue(authCookieFor("admin.bupulse.com", PROD))).toBe("admin");
    expect(authScopeValue(null)).toBeNull();
    expect(authCookieFromScope("client:.bupulse.com")).toEqual({ name: CLIENT_AUTH_COOKIE, domain: ".bupulse.com" });
    expect(authCookieFromScope("admin")).toEqual({ name: ADMIN_AUTH_COOKIE });
    for (const bad of [null, "", "client:", "client:bupulse.com", "client:.bu;pulse.com", "other"]) expect(authCookieFromScope(bad)).toBeNull();
    expect(browserClientCookieDomain("a=1; bp-auth-scope=client%3A.bupulse.com; b=2")).toBe(".bupulse.com");
    expect(browserClientCookieDomain("bp-auth-scope=admin")).toBeNull();
    expect(browserClientCookieDomain("")).toBeNull();
  });
});

describe("services", () => {
  it("reads the picks from user metadata, known services only", () => {
    expect(pickedServices({ services_picked: ["agency", "marketing", "x", 3] })).toEqual(["marketing", "agency"]);
    expect(pickedServices({})).toEqual([]);
    expect(pickedServices(null)).toEqual([]);
    expect(readPicks(["agency", "evil", "marketing", "agency"])).toEqual(["marketing", "agency"]);
    expect(readPicks([])).toEqual([]);
  });

  it("writes a short status line for the Marketing card", () => {
    const now = Date.parse("2026-11-11T10:00:00Z");
    expect(marketingStatus({ plan: "TRIAL", status: "PENDING_DEMO", trialEndsAt: null }, "Trial", now)).toBe("Ready to start your free trial");
    expect(marketingStatus({ plan: "TRIAL", status: "TRIALING", trialEndsAt: new Date(now + 9 * 86_400_000) }, "Trial", now)).toBe("Free trial, 9 days left");
    expect(marketingStatus({ plan: "TRIAL", status: "TRIALING", trialEndsAt: new Date(now + 3_600_000) }, "Trial", now)).toBe("Free trial, 1 day left");
    expect(marketingStatus({ plan: "TRIAL", status: "TRIALING", trialEndsAt: new Date(now - 1000) }, "Trial", now)).toBe("Free trial ended");
    expect(marketingStatus({ plan: "STANDARD", status: "ACTIVE", trialEndsAt: null }, "Standard", now)).toBe("Standard plan");
    expect(marketingStatus({ plan: "STANDARD", status: "EXPIRED", trialEndsAt: null }, "Standard", now)).toBe("Plan ended");
    expect(marketingStatus(null, null, now)).toBeNull();
  });
});

describe("Next.js's own fetch of a server action's redirect target", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("uses X-Forwarded-Host only when the Host is the server's own loopback address", () => {
    expect(requestHost(h({ host: "localhost:3002", "x-forwarded-host": "marketing.bupulse.com" }))).toBe("marketing.bupulse.com");
    expect(isSelfFetch(h({ host: "localhost:3002", "x-forwarded-host": "marketing.bupulse.com" }))).toBe(true);
    expect(requestHost(h({ host: "127.0.0.1:3041", "x-forwarded-host": "bupulse.localhost:3041" }))).toBe("bupulse.localhost:3041");
    // A request from outside: its own Host, whatever X-Forwarded-Host says.
    expect(requestHost(h({ host: "bupulse.com", "x-forwarded-host": "admin.bupulse.com" }))).toBe("bupulse.com");
    expect(isSelfFetch(h({ host: "bupulse.com", "x-forwarded-host": "admin.bupulse.com" }))).toBe(false);
    // Local development: the browser itself on localhost.
    expect(requestHost(h({ host: "localhost:3000", "x-forwarded-host": "localhost:3000" }))).toBe("localhost:3000");
    expect(requestHost(h({ host: "localhost:3000" }))).toBe("localhost:3000");
    expect(isSelfFetch(h({ host: "localhost:3000" }))).toBe(false);
  });
});
