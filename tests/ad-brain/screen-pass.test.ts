import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { adBrainCompanyEmail, isLocalRequest, isScreenPassPath, readScreenPass, SCREEN_PASS_COOKIE, SCREEN_PASS_TTL_MS, screenPassAllowed, screenPassSecret, signScreenPass } from "@/lib/ad-brain/screen-pass";
import { currentCaptures, isEmptyPage, pagesToCapture, robotPath, SCREEN_PAGES, screensStale, SCREENS_FRESH_MS, shownAddress, type PageCounts } from "@/lib/ad-brain/screen-plan";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("the screen robot's pass", () => {
  it("is signed, carries the company account and expires after 5 minutes", async () => {
    const token = await signScreenPass({ userId: "u1", businessId: "b1", now: NOW }, SECRET);
    expect(await readScreenPass(token, SECRET, NOW + 1000)).toEqual({ userId: "u1", businessId: "b1", exp: NOW + SCREEN_PASS_TTL_MS });
    expect(await readScreenPass(token, SECRET, NOW + SCREEN_PASS_TTL_MS)).toBeNull();
  });

  it("refuses a forged, altered or foreign pass", async () => {
    const token = await signScreenPass({ userId: "u1", businessId: "b1", now: NOW }, SECRET);
    expect(await readScreenPass(token, "another-secret", NOW)).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = btoa(JSON.stringify({ userId: "someone-else", businessId: "b2", exp: NOW + 60_000 })).replace(/=+$/, "");
    expect(await readScreenPass(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await readScreenPass(`${payload}.${sig}x`, SECRET, NOW)).toBeNull();
    expect(await readScreenPass(`${payload}.${sig}.more`, SECRET, NOW)).toBeNull();
    expect(await readScreenPass("", SECRET, NOW)).toBeNull();
    expect(await readScreenPass(token, "", NOW)).toBeNull();
  });

  it("can never be made to last longer than 5 minutes", async () => {
    const token = await signScreenPass({ userId: "u1", businessId: "b1", now: NOW, ttlMs: 24 * 3600_000 }, SECRET);
    expect((await readScreenPass(token, SECRET, NOW))!.exp).toBe(NOW + SCREEN_PASS_TTL_MS);
    await expect(signScreenPass({ userId: "u1", businessId: "b1" }, "")).rejects.toThrow(/No secret/);
  });

  it("is accepted only from this computer, only to read, only on the dashboard and its read API", () => {
    const ok = { method: "GET", path: "/dashboard/content", host: "127.0.0.1:3002" };
    expect(screenPassAllowed(ok)).toBe(true);
    expect(screenPassAllowed({ ...ok, host: "localhost:3001", method: "HEAD" })).toBe(true);
    // Through the tunnel or any proxy: refused.
    expect(screenPassAllowed({ ...ok, host: "bupulse.com" })).toBe(false);
    expect(screenPassAllowed({ ...ok, cfConnectingIp: "1.2.3.4" })).toBe(false);
    expect(screenPassAllowed({ ...ok, forwardedFor: "1.2.3.4" })).toBe(false);
    // Writing (a server action is a POST): refused.
    expect(screenPassAllowed({ ...ok, method: "POST" })).toBe(false);
    // Admin pages, admin API, cron, auth, anything else: refused.
    for (const path of ["/admin", "/admin/ad-brain", "/api/admin/v1/x", "/api/cron/tick", "/api/auth/callback", "/account", "/login"]) expect(isScreenPassPath(path), path).toBe(false);
    expect(isScreenPassPath("/api/notifications")).toBe(true);
    expect(isLocalRequest({ host: "[::1]:3002" })).toBe(true);
  });

  it("names only the BuPulse company account, and needs a server secret", () => {
    expect(adBrainCompanyEmail({})).toBe("office@bupulse.com");
    expect(adBrainCompanyEmail({ AD_BRAIN_COMPANY_EMAIL: " Ads@BuPulse.com " })).toBe("ads@bupulse.com");
    expect(screenPassSecret({})).toBe("");
    expect(screenPassSecret({ SUPABASE_SECRET_KEY: "k" })).toBe("k");
    expect(screenPassSecret({ SUPABASE_SECRET_KEY: "k", SCREEN_PASS_SECRET: "s" })).toBe("s");
  });
});

// The proxy gate (proxy.ts) with the real pass.
const auth = vi.hoisted(() => ({ getClaims: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));
import { proxy } from "@/proxy";

describe("the proxy with a screen pass", () => {
  afterEach(() => vi.unstubAllEnvs());
  const withPass = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}, token?: string) => {
    vi.stubEnv("SCREEN_PASS_SECRET", SECRET);
    const pass = token ?? (await signScreenPass({ userId: "u1", businessId: "b1" }, SECRET));
    // A browser always sends Host; a request without one is refused (not local).
    return proxy(new NextRequest(url, { method: init.method ?? "GET", headers: { host: new URL(url).host, cookie: `${SCREEN_PASS_COOKIE}=${pass}`, ...(init.headers ?? {}) } }));
  };

  it("lets the robot read a dashboard page on this computer without a session", async () => {
    const res = await withPass("http://127.0.0.1:3002/dashboard/calendar");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("refuses a write, an admin page, a forged pass and any request from outside", async () => {
    expect((await withPass("http://127.0.0.1:3002/dashboard/content", { method: "POST" })).status).toBe(403);
    expect((await withPass("http://127.0.0.1:3002/admin/ad-brain")).status).toBe(403);
    expect((await withPass("http://127.0.0.1:3002/dashboard", {}, "forged.pass")).status).toBe(403);
    expect((await withPass("https://bupulse.com/dashboard")).status).toBe(403);
    expect((await withPass("http://127.0.0.1:3002/dashboard", { headers: { "cf-connecting-ip": "1.2.3.4" } })).status).toBe(403);
  });

  // The self-hosted PC behind the tunnel: `next start` fetches a host rewrite from localhost with the real visitor's host
  // in X-Forwarded-Host (lib/platform/app-hosts.ts isSelfFetch). Loopback host, GET, a dashboard path and even a genuine
  // pass: it is still a visitor's request, never the robot's.
  it("refuses a localhost self-fetch that carries a visitor's host, even with a genuine pass", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
    vi.stubEnv("CLIENT_COOKIE_DOMAIN", ".bupulse.com");
    vi.stubEnv("MARKETING_APP_URL", "https://marketing.bupulse.com");
    vi.stubEnv("ADMIN_APP_URL", "https://admin.bupulse.com");
    for (const host of ["marketing.bupulse.com", "admin.bupulse.com", "bupulse.com"]) {
      const res = await withPass("http://127.0.0.1:3002/dashboard/content", { headers: { "x-forwarded-host": host } });
      expect(res.status, host).toBe(403);
    }
    expect((await withPass("http://localhost:3002/dashboard", { headers: { forwarded: "host=marketing.bupulse.com;proto=https" } })).status).toBe(403);
    // A loopback X-Forwarded-Host is not a visitor's: the robot itself may still read.
    expect((await withPass("http://127.0.0.1:3002/dashboard/content")).status).toBe(200);
    expect(screenPassAllowed({ method: "GET", path: "/dashboard", host: "127.0.0.1:3002", forwardedHost: "marketing.bupulse.com" })).toBe(false);
  });

  it("never opens an admin page under any address with the host split on", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
    vi.stubEnv("CLIENT_COOKIE_DOMAIN", ".bupulse.com");
    vi.stubEnv("MARKETING_APP_URL", "https://marketing.bupulse.com");
    vi.stubEnv("ADMIN_APP_URL", "https://admin.bupulse.com");
    // Clean admin addresses (admin.bupulse.com/companies is /admin/companies) and the app paths behind them.
    for (const path of ["/companies", "/ad-brain", "/settings/ad-brain", "/admin", "/admin/companies", "/api/admin/v1/companies"]) {
      expect((await withPass(`http://127.0.0.1:3002${path}`)).status, path).toBe(403);
    }
    // Sent with the admin host's name, it is not local at all.
    expect((await withPass("http://admin.bupulse.com/companies")).status).toBe(403);
  });
});

describe("what the robot captures and what ads may use", () => {
  const counts = (over: Partial<PageCounts> = {}): PageCounts => ({ home: 1, posts: 12, calendar: 5, autopilot: 1, designs: 3, photos: 40, leads: 0, ...over });

  it("never opens Leads when there are none, and marks empty pages", () => {
    expect(pagesToCapture(counts()).map((p) => p.id)).toEqual(["home", "posts", "calendar", "autopilot", "designs", "photos"]);
    expect(pagesToCapture(counts({ leads: 4 })).map((p) => p.id)).toContain("leads");
    expect(isEmptyPage("calendar", counts({ calendar: 0 }))).toBe(true);
    expect(isEmptyPage("home", counts())).toBe(false);
  });

  it("lists pages by their clean Marketing address, opens their app path on loopback, shows the real address", () => {
    expect(SCREEN_PAGES.find((p) => p.id === "posts")?.path).toBe("/content");
    // Every page the robot opens is a dashboard app path the pass allows.
    for (const p of SCREEN_PAGES) expect(isScreenPassPath(robotPath(p.path)), p.path).toBe(true);
    expect(robotPath("/")).toBe("/dashboard");
    expect(robotPath("/autopilot")).toBe("/dashboard/autopilot");
    const split = { NEXT_PUBLIC_SITE_URL: "https://bupulse.com", CLIENT_COOKIE_DOMAIN: ".bupulse.com", MARKETING_APP_URL: "https://marketing.bupulse.com", ADMIN_APP_URL: "https://admin.bupulse.com" };
    expect(shownAddress("/content", split)).toBe("marketing.bupulse.com/content");
    expect(shownAddress("/", split)).toBe("marketing.bupulse.com");
    // Before the split (or locally): the front host and the app path.
    expect(shownAddress("/calendar", { NEXT_PUBLIC_SITE_URL: "https://bupulse.com" })).toBe("bupulse.com/dashboard/calendar");
  });

  it("captures again when the newest is a day old", () => {
    const now = new Date(NOW);
    expect(screensStale(null, now)).toBe(true);
    expect(screensStale(new Date(NOW - SCREENS_FRESH_MS + 60_000), now)).toBe(false);
    expect(screensStale(new Date(NOW - SCREENS_FRESH_MS), now)).toBe(true);
  });

  it("uses the newest robot capture of each page and size, never an empty page, and the prototype only in tests and dev", () => {
    const row = (id: string, page: string, viewport: string, minutes: number, provider = "robot", empty = false) => ({ id, key: `${page}-${viewport}`, page, viewport, capturedAt: "", empty, createdAt: new Date(NOW + minutes * 60_000), provider });
    const rows = [row("old", "posts", "phone", 0), row("new", "posts", "phone", 10), row("d", "posts", "desktop", 10), row("cal", "calendar", "phone", 10, "robot", true), row("fx", "Posts", "desktop", -100, "upload")];
    expect(currentCaptures(rows, true).map((r) => r.id).sort()).toEqual(["d", "new"]);
    expect(currentCaptures([rows[4]], true).map((r) => r.id)).toEqual(["fx"]);
    expect(currentCaptures([rows[4]], false)).toEqual([]);
  });
});
