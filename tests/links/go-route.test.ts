import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ findUnique: vi.fn(), createClick: vi.fn(async () => ({})), rateLimit: vi.fn(async () => {}), logError: vi.fn(async () => {}) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: { trackedLink: { findUnique: h.findUnique }, trackedLinkClick: { create: h.createClick } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit, RateLimitError: class extends Error {} }));
vi.mock("@/lib/errors", () => ({ logError: h.logError }));

import { GET } from "@/app/go/[code]/route";

const link = { id: "clinkid0000000001", code: "ig-bio", channel: "instagram", destination: "/pricing", archivedAt: null };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const call = (code: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`https://bupulse.com/go/${code}`, { headers: { "user-agent": UA, "accept-language": "en", host: "bupulse.com", "x-forwarded-proto": "https", "cf-ipcountry": "RW", ...headers } }), { params: Promise.resolve({ code }) });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
  h.findUnique.mockReset().mockResolvedValue(link);
  h.createClick.mockClear();
  h.rateLimit.mockReset().mockResolvedValue(undefined);
});

describe("bupulse.com/go/<code>", () => {
  it("counts the click, remembers the link 30 days and opens the page with its tags", async () => {
    const res = await call("IG-Bio");
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://bupulse.com/pricing");
    expect(to.searchParams.get("utm_campaign")).toBe("ig-bio");
    expect(h.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "ig-bio" } }));
    expect(h.createClick).toHaveBeenCalledWith({ data: { linkId: link.id, country: expect.any(String) } });
    const cookie = res.cookies.get("bp-link");
    expect(cookie?.value).toBe(link.id);
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("an unknown code opens the home page and counts nothing", async () => {
    h.findUnique.mockResolvedValue(null);
    const res = await call("nope-nope");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    expect(h.createClick).not.toHaveBeenCalled();
  });

  it("an archived link still opens its page but counts and remembers nothing", async () => {
    h.findUnique.mockResolvedValue({ ...link, archivedAt: new Date() });
    const res = await call("ig-bio");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/pricing");
    expect(h.createClick).not.toHaveBeenCalled();
    expect(res.cookies.get("bp-link")).toBeUndefined();
  });

  it("a visitor who opted out is counted but gets no cookie; a bot is not counted", async () => {
    const res = await call("ig-bio", { "sec-gpc": "1" });
    expect(res.cookies.get("bp-link")).toBeUndefined();
    expect(h.createClick).toHaveBeenCalledTimes(1);
    h.createClick.mockClear();
    await call("ig-bio", { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    expect(h.createClick).not.toHaveBeenCalled();
  });

  it("never sends people to another site, whatever Host says", async () => {
    const res = await call("ig-bio", { host: "evil.example", "x-forwarded-host": "evil.example" });
    expect(new URL(res.headers.get("location")!).origin).toBe("https://bupulse.com");
  });
});
