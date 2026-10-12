import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanCountry, clientIp, countryFromNetlifyGeo, trustedClientIp, visitorCountry } from "@/lib/platform/headers";
import { currentPlatform } from "@/lib/platform/detect";
import { countryFrom, clientIp as collectClientIp } from "@/lib/analytics/collect";
import { clientIpFrom } from "@/lib/request-limits";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const NF_GEO = b64({ city: "Kigali", country: { code: "RW", name: "Rwanda" }, subdivision: { code: "01", name: "Kigali" }, timezone: "Africa/Kigali", latitude: -1.9, longitude: 30.06 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Netlify's x-nf-geo header", () => {
  it("reads the country code from base64 JSON", () => {
    expect(countryFromNetlifyGeo(NF_GEO)).toBe("RW");
    expect(countryFromNetlifyGeo(b64({ country: { code: "ke" } }))).toBe("KE");
  });

  it("accepts plain JSON and base64url", () => {
    expect(countryFromNetlifyGeo('{"country":{"code":"UG"}}')).toBe("UG");
    const url = NF_GEO.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(countryFromNetlifyGeo(url)).toBe("RW");
  });

  it("keeps UTF-8 city names readable without affecting the code", () => {
    expect(countryFromNetlifyGeo(b64({ city: "Gisenyi Rubavu é", country: { code: "RW", name: "Rwanda" } }))).toBe("RW");
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["not base64", "%%%"],
    ["base64 of garbage", Buffer.from("not json").toString("base64")],
    ["no country", b64({ city: "Kigali" })],
    ["null country", b64({ country: null })],
    ["unknown country", b64({ country: { code: "XX" } })],
    ["Tor", b64({ country: { code: "T1" } })],
    ["three letters", b64({ country: { code: "RWA" } })],
    ["code not a string", b64({ country: { code: 42 } })],
    ["too long", "a".repeat(5000)],
  ])("is null when %s", (_label, value) => {
    expect(countryFromNetlifyGeo(value as string | null)).toBeNull();
  });
});

describe("visitor country per host", () => {
  const all = new Headers({ "cf-ipcountry": "UG", "x-nf-geo": NF_GEO, "x-country": "KE" });

  it("Cloudflare (and plain Node) read cf-ipcountry only", () => {
    expect(visitorCountry(all, "cloudflare")).toBe("UG");
    expect(visitorCountry(all, "node")).toBe("UG");
    expect(visitorCountry(new Headers({ "x-nf-geo": NF_GEO }), "cloudflare")).toBeNull();
  });

  it("Netlify reads x-nf-geo only: never x-country or cf-ipcountry (missing means the catch-all region)", () => {
    expect(visitorCountry(all, "netlify")).toBe("RW");
    expect(visitorCountry(new Headers({ "x-country": "ke", "cf-ipcountry": "UG" }), "netlify")).toBeNull();
    expect(visitorCountry(new Headers({ "cf-ipcountry": "UG" }), "netlify")).toBeNull();
    expect(visitorCountry(new Headers({ "x-nf-geo": "garbage", "x-country": "TZ" }), "netlify")).toBeNull();
  });

  it("cleans codes", () => {
    expect(cleanCountry(" rw ")).toBe("RW");
    expect(cleanCountry("XX")).toBeNull();
    expect(cleanCountry(undefined)).toBeNull();
  });

  it("the analytics tracker uses the same rules (request.cf as the Workers fallback)", () => {
    vi.stubEnv("PLATFORM", "netlify");
    expect(countryFrom(new Headers({ "x-nf-geo": NF_GEO }), undefined, false)).toBe("RW");
    expect(countryFrom(new Headers({ "cf-ipcountry": "UG" }), undefined, false)).toBeNull();
    vi.stubEnv("PLATFORM", "cloudflare");
    expect(countryFrom(new Headers({}), "ug", false)).toBe("UG");
  });
});

describe("client IP per host", () => {
  const h = new Headers({ "cf-connecting-ip": " 203.0.113.1 ", "x-nf-client-connection-ip": "198.51.100.7", "x-forwarded-for": "192.0.2.9, 10.0.0.1" });

  it("Cloudflare and Node: cf-connecting-ip, then the first x-forwarded-for hop", () => {
    expect(clientIp(h, "cloudflare")).toBe("203.0.113.1");
    expect(clientIp(h, "node")).toBe("203.0.113.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "192.0.2.9, 10.0.0.1" }), "node")).toBe("192.0.2.9");
  });

  it("Netlify: x-nf-client-connection-ip, never a visitor's cf-connecting-ip or x-forwarded-for", () => {
    expect(clientIp(h, "netlify")).toBe("198.51.100.7");
    expect(clientIp(new Headers({ "cf-connecting-ip": "203.0.113.1", "x-forwarded-for": "192.0.2.9" }), "netlify")).toBeNull();
    expect(clientIp(new Headers({}), "netlify")).toBeNull();
  });

  it("Cloudflare never falls back to x-forwarded-for either (null: the shared rate-limit bucket)", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "192.0.2.9" }), "cloudflare")).toBeNull();
  });

  it("the trusted address never falls back to x-forwarded-for (IP allow-lists)", () => {
    expect(trustedClientIp(h, "netlify")).toBe("198.51.100.7");
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "192.0.2.9" }), "netlify")).toBeNull();
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "192.0.2.9", "x-nf-client-connection-ip": "198.51.100.7" }), "cloudflare")).toBeNull();
  });

  it("the app's helpers follow the detected host", () => {
    vi.stubEnv("PLATFORM", "netlify");
    expect(clientIpFrom(h)).toBe("198.51.100.7");
    expect(collectClientIp(new Headers({ "x-real-ip": "192.0.2.50", "x-forwarded-for": "192.0.2.51" }))).toBe("0.0.0.0");
    vi.stubEnv("PLATFORM", "");
    expect(collectClientIp(new Headers({ "x-real-ip": "192.0.2.50" }))).toBe("192.0.2.50");
    expect(clientIpFrom(h)).toBe("203.0.113.1");
  });
});

describe("host detection", () => {
  it("is plain Node in tests", () => {
    expect(currentPlatform()).toBe("node");
  });

  it("PLATFORM wins, in any case", () => {
    vi.stubEnv("PLATFORM", "Netlify");
    expect(currentPlatform()).toBe("netlify");
    vi.stubEnv("PLATFORM", "cloudflare");
    expect(currentPlatform()).toBe("cloudflare");
  });

  it("ignores unknown PLATFORM values and falls back to the build-time value", () => {
    vi.stubEnv("PLATFORM", "vercel");
    expect(currentPlatform()).toBe("node");
    vi.stubEnv("BUPULSE_BUILD_PLATFORM", "netlify");
    expect(currentPlatform()).toBe("netlify");
  });

  it("in production, plain Node with Netlify's or Lambda's environment is Netlify; otherwise it logs an error once", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NETLIFY", "true");
    expect(currentPlatform()).toBe("netlify");
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("LAMBDA_TASK_ROOT", "/var/task");
    expect(currentPlatform()).toBe("netlify");
    vi.stubEnv("LAMBDA_TASK_ROOT", "");
    expect(currentPlatform()).toBe("node");
    expect(currentPlatform()).toBe("node");
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("production resolved to plain Node");
    error.mockRestore();
  });

  it("outside production NETLIFY alone does not change plain Node", () => {
    vi.stubEnv("NETLIFY", "true");
    expect(currentPlatform()).toBe("node");
  });

  it("detects Netlify Functions by the Netlify global", () => {
    vi.stubGlobal("Netlify", { env: {}, context: null });
    expect(currentPlatform()).toBe("netlify");
  });

  it("detects Cloudflare Workers by the user agent or OpenNext's context", () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(currentPlatform()).toBe("cloudflare");
    vi.unstubAllGlobals();
    const key = Symbol.for("__cloudflare-context__");
    (globalThis as Record<symbol, unknown>)[key] = { env: {}, ctx: {} };
    try {
      expect(currentPlatform()).toBe("cloudflare");
    } finally {
      delete (globalThis as Record<symbol, unknown>)[key];
    }
  });
});
