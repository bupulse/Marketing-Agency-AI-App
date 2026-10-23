import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const m = vi.hoisted(() => ({ rateLimit: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/errors", () => ({ logError: m.logError }));
vi.mock("@/lib/admin/service-keys", () => ({ loadServiceKeys: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: m.rateLimit }));
vi.mock("@/lib/support/ai", () => ({ transcribeAudio: vi.fn() }));
vi.mock("@/lib/support/conversations", () => ({ ownConversation: vi.fn() }));
vi.mock("@/lib/support/storage", () => ({ signedDownloadUrls: vi.fn().mockResolvedValue(new Map()), createUploadSlot: vi.fn(), downloadObject: vi.fn(), objectInfo: vi.fn(), removeObjects: vi.fn() }));
vi.mock("@/lib/support/realtime", () => ({ broadcast: vi.fn() }));

import type { NextRequest } from "next/server";
import { RateLimitError } from "@/lib/rate-limit";
import { deviceFrom, geoFrom, geoFromNetlify, referrerHost } from "@/lib/support/client-info";
import { SupportError, limit, parse, rateLimitText, route } from "@/lib/support/http";
import { newId, randomToken, sha256Hex, topicSecret } from "@/lib/support/tokens";
import { uploadProblem } from "@/lib/support/uploads";
import { shortName } from "@/lib/support/views";

describe("tokens", () => {
  const saved = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-support-topics";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = saved;
  });

  it("hashes like Postgres' sha256 hex", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("makes base64url tokens of the asked size", () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toHaveLength(22);
    expect(randomToken()).not.toBe(t);
  });
  it("makes cuid-like ids", () => {
    const id = newId();
    expect(id).toHaveLength(25);
    expect(id).toMatch(/^c[a-z0-9]{24}$/);
    expect(newId()).not.toBe(id);
  });
  it("derives a stable 128-bit topic secret per conversation", async () => {
    const a = await topicSecret("conv-a");
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await topicSecret("conv-a")).toBe(a);
    expect(await topicSecret("conv-b")).not.toBe(a);
  });
  it("gives other topics with another key, and refuses without one", async () => {
    const a = await topicSecret("conv-a");
    process.env.ENCRYPTION_KEY = "another-key";
    expect(await topicSecret("conv-a")).not.toBe(a);
    delete process.env.ENCRYPTION_KEY;
    await expect(topicSecret("conv-a")).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});

describe("what the request tells about the visitor", () => {
  const geo = { city: "Kigali", country: { code: "RW", name: "Rwanda" }, subdivision: { code: "01", name: "Kigali City" }, timezone: "Africa/Kigali" };

  it("reads Netlify's geo header as base64 or as JSON", () => {
    const expected = { country: "RW", city: "Kigali", region: "Kigali City", timezone: "Africa/Kigali" };
    expect(geoFromNetlify(btoa(JSON.stringify(geo)))).toEqual(expected);
    expect(geoFromNetlify(JSON.stringify(geo))).toEqual(expected);
  });
  it("ignores a missing, broken or unknown geo header", () => {
    expect(geoFromNetlify(null)).toBeNull();
    expect(geoFromNetlify("%%%not-base64")).toBeNull();
    expect(geoFromNetlify("{broken")).toBeNull();
    expect(geoFromNetlify(JSON.stringify({ country: { code: "XX" } }))).toEqual({ country: null, city: null, region: null, timezone: null });
  });
  it("trusts each host's own headers only", () => {
    const h = new Headers({ "x-nf-geo": btoa(JSON.stringify(geo)), "cf-ipcountry": "KE", "cf-ipcity": "Nairobi" });
    expect(geoFrom(h, "netlify")).toMatchObject({ country: "RW", city: "Kigali" });
    expect(geoFrom(h, "cloudflare")).toMatchObject({ country: "KE", city: "Nairobi" });
    expect(geoFrom(new Headers(), "netlify")).toEqual({ country: null, city: null, region: null, timezone: null });
  });
  it("tells phones, tablets and desktops apart", () => {
    const ua = (s: string) => new Headers({ "user-agent": s });
    const iphone = deviceFrom(ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"));
    expect(iphone.device).toBe("phone");
    expect(iphone.os).toBe("iOS 17");
    expect(deviceFrom(ua("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).device).toBe("tablet");
    const mac = deviceFrom(ua("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"));
    expect(mac).toMatchObject({ device: "desktop", browser: "Chrome 130", bot: false });
  });
  it("uses the screen width when the user agent says nothing", () => {
    expect(deviceFrom(new Headers(), 390).device).toBe("phone");
    expect(deviceFrom(new Headers(), 1440).device).toBe("desktop");
    expect(deviceFrom(new Headers()).device).toBe("desktop");
  });
  it("keeps only the referrer's host, and none for BuPulse itself", () => {
    expect(referrerHost("https://www.google.com/search?q=bupulse", ["bupulse.com"])).toBe("google.com");
    expect(referrerHost("https://bupulse.com/pricing", ["bupulse.com"])).toBeNull();
    expect(referrerHost("https://test.bupulse.com/", ["bupulse.com"])).toBeNull();
    expect(referrerHost("not a url", ["bupulse.com"])).toBeNull();
    expect(referrerHost(undefined, [])).toBeNull();
  });
});

describe("upload rules", () => {
  it("allows photos, PDFs and voice notes up to 10 MB", () => {
    expect(uploadProblem("image/png", 1000)).toBeNull();
    expect(uploadProblem("application/pdf", 10 * 1024 * 1024)).toBeNull();
    expect(uploadProblem("audio/webm;codecs=opus", 500_000, 60)).toBeNull();
  });
  it("refuses other types, big files and long voice notes", () => {
    expect(uploadProblem("application/zip", 100)).toMatch(/photo/);
    expect(uploadProblem("image/svg+xml", 100)).toMatch(/photo/);
    expect(uploadProblem("image/jpeg", 10 * 1024 * 1024 + 1)).toMatch(/10 MB/);
    expect(uploadProblem("audio/ogg", 1000, 121)).toMatch(/2 minutes/);
  });
});

describe("agent names", () => {
  it("shows first name and initial", () => {
    expect(shortName("Jean Mugisha")).toBe("Jean M.");
    expect(shortName("  Aline  Marie  uwase ")).toBe("Aline U.");
    expect(shortName("Jean")).toBe("Jean");
    expect(shortName("   ")).toBe("BuPulse team");
  });
});

describe("API answers", () => {
  const req = (url = "https://bupulse.com/api/support/v1/x") => new Request(url) as unknown as NextRequest;
  beforeEach(() => {
    m.rateLimit.mockReset();
    m.logError.mockReset();
  });

  it("parse gives the first problem in plain words", () => {
    const schema = z.object({ name: z.string().min(1, "Enter a name.") });
    expect(parse(schema, { name: "Jean" })).toEqual({ name: "Jean" });
    try {
      parse(schema, { name: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SupportError);
      expect(error).toMatchObject({ status: 400, code: "invalid_request", message: "name: Enter a name." });
    }
  });
  it("route answers a SupportError as { error: { code, message } }, never cached", async () => {
    const handler = route(async () => {
      throw new SupportError(404, "not_found", "This chat was not found.");
    });
    const res = await handler(req(), {});
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "This chat was not found." } });
  });
  it("route turns a rate limit into 429 with Retry-After", async () => {
    const res = await route(async () => {
      throw new RateLimitError(90);
    })(req(), {});
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    expect((await res.json()).error.message).toBe(rateLimitText(90));
  });
  it("route logs anything else and answers a plain 500", async () => {
    const res = await route(async () => {
      throw new Error("database exploded with secret details");
    })(req(), {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("server_error");
    expect(body.error.message).not.toMatch(/database|secret/);
    expect(m.logError).toHaveBeenCalledOnce();
  });
  it("route passes a good answer through", async () => {
    const res = await route(async () => Response.json({ ok: true }))(req(), {});
    expect(await res.json()).toEqual({ ok: true });
  });
  it("limit throws a 429 SupportError over the limit", async () => {
    m.rateLimit.mockResolvedValueOnce(undefined);
    await expect(limit("k", { limit: 1, windowSeconds: 60 })).resolves.toBeUndefined();
    m.rateLimit.mockRejectedValueOnce(new RateLimitError(30));
    await expect(limit("k", { limit: 1, windowSeconds: 60 })).rejects.toMatchObject({ status: 429, code: "rate_limited", headers: { "retry-after": "30" } });
  });
  it("rate-limit text rounds up to whole minutes", () => {
    expect(rateLimitText(30)).toBe("You're sending a lot. Please wait 1 minute and try again.");
    expect(rateLimitText(150)).toBe("You're sending a lot. Please wait 3 minutes and try again.");
  });
});
