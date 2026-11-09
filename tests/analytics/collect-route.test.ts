import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const create = vi.fn();
const exec = vi.fn();
const limit = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { pageView: { create: (...a: unknown[]) => create(...a) }, $executeRaw: (...a: unknown[]) => exec(...a) } }));
const salt = vi.fn();
vi.mock("@/lib/analytics/salt", () => ({ getDailySalt: () => salt() }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error { constructor(public retryAfterSeconds: number) { super("limit"); } }
  return { RateLimitError, rateLimit: (...a: unknown[]) => limit(...a) };
});

import { POST } from "@/app/api/collect/route";
import { RateLimitError } from "@/lib/rate-limit";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
const VIEW = "0123456789abcdef0123456789abcdef";
const body = { p: "/pricing?x=1", r: "https://www.google.com/", q: "?utm_source=News&utm_campaign=Oct", w: 1440, h: 900, l: "en", v: VIEW, s: "abcdef123456abcdef" };

function req(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/collect", {
    method: "POST",
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    headers: { "user-agent": CHROME, "accept-language": "en", "cf-connecting-ip": "203.0.113.77", "cf-ipcountry": "RW", origin: "http://localhost:3000", ...headers },
  });
}

describe("POST /api/collect", () => {
  beforeEach(() => {
    salt.mockReset().mockResolvedValue("random-salt-for-today");
    create.mockReset().mockResolvedValue({});
    exec.mockReset().mockResolvedValue(1);
    limit.mockReset().mockResolvedValue(undefined);
  });

  it("stores a view with hashed visitor, no raw IP or UA", async () => {
    const res = await POST(req(body));
    expect(res.status).toBe(204);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      path: "/pricing", source: "news", utmSource: "news", utmCampaign: "oct", device: "desktop", country: "RW", referrerHost: "google.com", sessionId: "abcdef123456abcdef",
      screenWidth: 1440, screenHeight: 900, language: "en", viewId: VIEW, countMethod: "v2",
    });
    expect(data.visitorHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain("203.0.113.77");
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain("Mozilla");
  });

  it("answers 204 and stores nothing for bots, opt-outs, private paths, bad bodies and foreign origins", async () => {
    const cases = [
      req(body, { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
      req(body, { dnt: "1" }),
      req(body, { "sec-gpc": "1" }),
      req({ ...body, p: "/dashboard" }),
      req({ ...body, d: true }),
      req("not json"),
      req({ nope: 1 }),
      req(body, { origin: "https://evil.example" }),
      req(body, { origin: "", referer: "" }),
    ];
    for (const c of cases) expect((await POST(c)).status).toBe(204);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts a Referer from our own site when there is no Origin", async () => {
    await POST(req(body, { origin: "", referer: "http://localhost:3000/pricing" }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rate-limits on the IP alone, so changing the user agent does not reset it", async () => {
    await POST(req(body));
    await POST(req(body, { "user-agent": CHROME.replace("130", "131") }));
    const keys = limit.mock.calls.map((c) => c[0] as string);
    const perMinute = keys.filter((k) => k.startsWith("collect:"));
    expect(new Set(perMinute).size).toBe(1);
    expect(keys.some((k) => k.startsWith("collect-day:"))).toBe(true);
    expect(keys.join()).not.toContain("203.0.113.77");
  });

  it("stores nothing when the daily salt is unavailable (no fallback key)", async () => {
    salt.mockResolvedValue(null);
    expect((await POST(req(body))).status).toBe(204);
    expect(create).not.toHaveBeenCalled();
  });

  it("drops views over the rate limit", async () => {
    limit.mockRejectedValue(new RateLimitError(30));
    expect((await POST(req(body))).status).toBe(204);
    expect(create).not.toHaveBeenCalled();
  });

  it("still answers 204 when the database fails", async () => {
    create.mockRejectedValue(new Error("down"));
    expect((await POST(req(body))).status).toBe(204);
  });

  it("counts one visitor for two browsers on one device, and two for two devices behind one address", async () => {
    await POST(req(body));
    await POST(req(body, { "user-agent": FIREFOX }));
    await POST(req({ ...body, w: 390, h: 844 }, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }));
    const [chrome, firefox, phone] = create.mock.calls.map((c) => c[0].data.visitorHash as string);
    expect(firefox).toBe(chrome);
    expect(phone).not.toBe(chrome);
  });

  it("falls back to Accept-Language when an old cached tracker sends no language", async () => {
    await POST(req({ ...body, l: undefined }, { "accept-language": "rw-RW,rw;q=0.9" }));
    expect(create.mock.calls[0][0].data.language).toBe("rw");
  });

  it("stores the city from cf-ipcity, and none for a Rwandan address the host placed in another country", async () => {
    await POST(req(body, { "cf-ipcity": "Kigali" }));
    expect(create.mock.calls[0][0].data.city).toBe("Kigali");
    await POST(req(body, { "cf-connecting-ip": "41.186.10.20", "cf-ipcountry": "UG", "cf-ipcity": "Kampala" }));
    expect(create.mock.calls[1][0].data).toMatchObject({ country: "RW", city: null });
  });

  describe("time-on-page beacon", () => {
    const time = (payload: unknown, headers: Record<string, string> = {}) => req(payload, headers);

    it("updates the view's time only (never inserts), capped and only for recent views", async () => {
      expect((await POST(time({ v: VIEW, e: 42_000 }))).status).toBe(204);
      expect(create).not.toHaveBeenCalled();
      expect(exec).toHaveBeenCalledTimes(1);
      const [sql, ...values] = exec.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(sql.join("?")).toMatch(/^\s*UPDATE "PageView" SET "durationMs"/);
      expect(sql.join("?")).toContain('"createdAt" >=');
      expect(values.slice(0, 3)).toEqual([30 * 60 * 1000, 42_000, VIEW]);
      const since = values.find((v) => v instanceof Date) as Date;
      expect(Date.now() - since.getTime()).toBeGreaterThan(115 * 60_000);
      expect(Date.now() - since.getTime()).toBeLessThan(125 * 60_000);
      await POST(time({ v: VIEW, e: 9 * 60 * 60 * 1000 }));
      expect(exec.mock.calls[1].slice(1, 4)).toEqual([30 * 60 * 1000, 30 * 60 * 1000, VIEW]);
    });

    it("ignores bad ids, empty times, bots, opt-outs and foreign origins", async () => {
      const cases = [
        time({ v: "not-an-id", e: 1000 }),
        time({ v: VIEW, e: 0 }),
        time({ v: VIEW, e: -1 }),
        time({ v: VIEW, e: "1000" }),
        time({ v: VIEW, e: 1000, d: true }),
        time({ v: VIEW, e: 1000 }, { "user-agent": "curl/8.4.0 (x86_64-pc-linux-gnu) libcurl/8.4.0" }),
        time({ v: VIEW, e: 1000 }, { dnt: "1" }),
        time({ v: VIEW, e: 1000 }, { origin: "https://evil.example" }),
      ];
      for (const c of cases) expect((await POST(c)).status).toBe(204);
      expect(exec).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("is rate-limited on its own buckets of the same size, keyed on the hashed IP", async () => {
      await POST(time({ v: VIEW, e: 5000 }));
      const keys = limit.mock.calls.map((c) => c[0] as string);
      expect(keys.some((k) => k.startsWith("collect-time:"))).toBe(true);
      expect(keys.some((k) => k.startsWith("collect-time-day:"))).toBe(true);
      expect(keys.join()).not.toContain("203.0.113.77");
      limit.mockRejectedValue(new RateLimitError(30));
      await POST(time({ v: VIEW, e: 5000 }));
      expect(exec).toHaveBeenCalledTimes(1);
    });
  });
});
