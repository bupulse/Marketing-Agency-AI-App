import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const create = vi.fn();
const limit = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { pageView: { create: (...a: unknown[]) => create(...a) } } }));
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
const body = { p: "/pricing?x=1", r: "https://www.google.com/", q: "?utm_source=News&utm_campaign=Oct", w: 1440, s: "abcdef123456abcdef" };

function req(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/collect", {
    method: "POST",
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    headers: { "user-agent": CHROME, "accept-language": "en", "cf-connecting-ip": "203.0.113.77", "cf-ipcountry": "RW", origin: "http://localhost:3000", ...headers },
  });
}

describe("POST /api/collect", () => {
  beforeEach(() => { salt.mockReset().mockResolvedValue("random-salt-for-today"); create.mockReset().mockResolvedValue({}); limit.mockReset().mockResolvedValue(undefined); });

  it("stores a view with hashed visitor, no raw IP or UA", async () => {
    const res = await POST(req(body));
    expect(res.status).toBe(204);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ path: "/pricing", source: "news", utmSource: "news", utmCampaign: "oct", device: "desktop", country: "RW", referrerHost: "google.com", sessionId: "abcdef123456abcdef" });
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
});
