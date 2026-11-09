import { describe, expect, it } from "vitest";
import {
  MAX_DURATION_MS, classifySource, cleanSessionId, cleanViewId, countryFrom, deviceFromUserAgent, deviceSignature, durationBeacon, isBot, normalizePath, parseUtm, primaryLanguage,
  referrerHost, utcDay, visitorHash,
} from "@/lib/analytics/collect";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("isBot", () => {
  it("lets real browsers through", () => {
    expect(isBot(CHROME, { acceptLanguage: "en-US" })).toBe(false);
    expect(isBot(IPHONE)).toBe(false);
  });
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
    "curl/8.4.0 (x86_64-pc-linux-gnu) libcurl/8.4.0",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "python-requests/2.31.0 something long enough",
  ])("blocks %s", (ua) => expect(isBot(ua)).toBe(true));
  it("blocks missing, tiny, webdriver and no-language clients", () => {
    expect(isBot(null)).toBe(true);
    expect(isBot("x")).toBe(true);
    expect(isBot(CHROME, { webdriver: true })).toBe(true);
    expect(isBot(CHROME, { acceptLanguage: "" })).toBe(true);
  });
});

describe("deviceFromUserAgent", () => {
  it("tells phones, tablets and desktops apart", () => {
    expect(deviceFromUserAgent(IPHONE)).toBe("mobile");
    expect(deviceFromUserAgent(IPAD)).toBe("tablet");
    expect(deviceFromUserAgent(CHROME)).toBe("desktop");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/130 Safari/537.36")).toBe("tablet");
  });
  it("falls back to the screen width", () => expect(deviceFromUserAgent(CHROME, 390)).toBe("mobile"));
});

describe("UTM and sources", () => {
  it("parses and lowercases utm parameters", () => {
    expect(parseUtm("?utm_source=Facebook&utm_medium=CPC&utm_campaign=Spring_Sale&x=1")).toEqual({ source: "facebook", medium: "cpc", campaign: "spring_sale" });
    expect(parseUtm("")).toEqual({ source: null, medium: null, campaign: null });
    expect(parseUtm("utm_source=%00%20")).toEqual({ source: null, medium: null, campaign: null });
  });
  it("caps long values", () => expect(parseUtm(`?utm_campaign=${"a".repeat(500)}`).campaign).toHaveLength(100));
  it("classifies referrers", () => {
    expect(classifySource(null, referrerHost("https://www.google.com/search?q=x", "bupulse.com"))).toBe("google");
    expect(classifySource(null, referrerHost("https://l.facebook.com/l.php", "bupulse.com"))).toBe("facebook");
    expect(classifySource(null, referrerHost("https://bupulse.com/pricing", "bupulse.com"))).toBe("direct");
    expect(classifySource(null, referrerHost("https://blog.example.org/post", "bupulse.com"))).toBe("blog.example.org");
    expect(classifySource("newsletter", "google.com")).toBe("newsletter");
    expect(referrerHost("not a url", "bupulse.com")).toBeNull();
  });
});

describe("normalizePath / session id / country", () => {
  it("keeps marketing paths, strips query and trailing slash", () => {
    expect(normalizePath("/pricing/?a=1#x")).toBe("/pricing");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/industries/phone-stores")).toBe("/industries/phone-stores");
  });
  it("rejects private and malformed paths", () => {
    for (const p of ["/dashboard", "/dashboard/x", "/admin", "/api/collect", "/widget/abc", "//evil.com", "pricing", 5]) expect(normalizePath(p)).toBeNull();
  });
  it("validates session ids", () => {
    expect(cleanSessionId("a1b2c3d4e5f6a1b2c3d4e5f6")).toBe("a1b2c3d4e5f6a1b2c3d4e5f6");
    expect(cleanSessionId("short")).toBeNull();
    expect(cleanSessionId("has space in it here!")).toBeNull();
  });
  it("reads the Cloudflare country, with a dev fallback", () => {
    expect(countryFrom(new Headers({ "cf-ipcountry": "rw" }), undefined, false)).toBe("RW");
    expect(countryFrom(new Headers(), "KE", false)).toBe("KE");
    expect(countryFrom(new Headers({ "cf-ipcountry": "XX" }), undefined, false)).toBeNull();
    expect(countryFrom(new Headers(), undefined, true)).toBe("ZZ");
  });
});

describe("visitorHash", () => {
  const day = new Date("2026-10-08T10:00:00Z");
  const sig = deviceSignature({ device: "desktop", width: 1440, height: 900, language: "en-US" });
  it("is a 64-char hex SHA-256 that does not contain the IP or the device", async () => {
    const h = await visitorHash("203.0.113.9", sig, day, "secret");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("203");
    expect(h).not.toContain("1440");
  });
  it("is stable within a day and changes the next day, IP, device or secret", async () => {
    const a = await visitorHash("203.0.113.9", sig, day, "secret");
    expect(await visitorHash("203.0.113.9", sig, new Date("2026-10-08T23:59:00Z"), "secret")).toBe(a);
    expect(await visitorHash("203.0.113.9", sig, new Date("2026-10-09T00:01:00Z"), "secret")).not.toBe(a);
    expect(await visitorHash("203.0.113.10", sig, day, "secret")).not.toBe(a);
    expect(await visitorHash("203.0.113.9", deviceSignature({ device: "mobile", width: 390, height: 844, language: "en" }), day, "secret")).not.toBe(a);
    expect(await visitorHash("203.0.113.9", sig, day, "other")).not.toBe(a);
  });
  it("utcDay is UTC", () => expect(utcDay(new Date("2026-10-08T23:30:00-05:00"))).toBe("2026-10-09"));
});

describe("deviceSignature (one visitor per device, whatever the browser)", () => {
  const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
  const EDGE = `${CHROME} Edg/130.0.0.0`;
  const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36";
  const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
  const sigOf = (ua: string, width: number, height: number, language: string) => deviceSignature({ device: deviceFromUserAgent(ua, width), width, height, language });

  it("ignores the browser: Chrome, Firefox and Edge on one computer give one signature (and so one hash)", async () => {
    const a = sigOf(CHROME, 1920, 1080, "en-US");
    expect(sigOf(FIREFOX, 1920, 1080, "en")).toBe(a);
    expect(sigOf(EDGE, 1920, 1080, "en-GB")).toBe(a);
    const day = new Date("2026-11-09T09:00:00Z");
    expect(await visitorHash("41.186.1.2", sigOf(FIREFOX, 1920, 1080, "en"), day, "s")).toBe(await visitorHash("41.186.1.2", a, day, "s"));
    expect(sigOf(SAMSUNG, 384, 832, "rw-RW")).toBe(sigOf(ANDROID_CHROME, 384, 832, "rw"));
  });

  it("separates devices behind one address: phone vs computer, other screen sizes, other languages", () => {
    const phone = sigOf(IPHONE, 390, 844, "en");
    expect(phone).not.toBe(sigOf(CHROME, 1440, 900, "en"));
    expect(phone).not.toBe(sigOf(IPHONE, 430, 932, "en"));
    expect(phone).not.toBe(sigOf(IPHONE, 390, 844, "fr"));
    expect(sigOf(IPAD, 820, 1180, "en")).not.toBe(sigOf(IPHONE, 820, 1180, "en"));
  });

  it("does not change when a phone is turned or a browser rounds the size a little", () => {
    expect(sigOf(ANDROID_CHROME, 832, 384, "en")).toBe(sigOf(ANDROID_CHROME, 384, 832, "en"));
    expect(sigOf(CHROME, 1442, 901, "en")).toBe(sigOf(CHROME, 1440, 900, "en"));
  });

  it("reads the primary language only, and copes with missing values", () => {
    expect(primaryLanguage("rw-RW")).toBe("rw");
    expect(primaryLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(primaryLanguage("<script>")).toBe("");
    expect(primaryLanguage(undefined)).toBe("");
    expect(deviceSignature({ device: "desktop" })).toBe("desktop|0x0|");
    expect(deviceSignature({ device: "mobile", width: 390 })).toBe("mobile|384x384|");
  });
});

describe("time-on-page beacon", () => {
  const id = "0123456789abcdef0123456789abcdef";
  it("accepts a view id and visible milliseconds, rounded", () => expect(durationBeacon(id, 12_345.6)).toEqual({ viewId: id, ms: 12_346 }));
  it("caps the time at 30 minutes", () => expect(durationBeacon(id, 5 * 60 * 60 * 1000)).toEqual({ viewId: id, ms: MAX_DURATION_MS }));
  it("ignores bad ids and bad or empty times", () => {
    for (const bad of ["", "short", id.toUpperCase(), `${id}00`, "0123456789abcdef0123456789abcdeg", 42, null]) expect(durationBeacon(bad, 1000)).toBeNull();
    for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "1000", null]) expect(durationBeacon(id, ms)).toBeNull();
    expect(cleanViewId(id)).toBe(id);
    expect(cleanViewId(undefined)).toBeNull();
  });
});
