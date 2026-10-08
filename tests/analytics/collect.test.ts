import { describe, expect, it } from "vitest";
import {
  classifySource, cleanSessionId, countryFrom, deviceFromUserAgent, isBot, normalizePath, parseUtm, referrerHost, utcDay, visitorHash,
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
  it("is a 64-char hex SHA-256 that does not contain the IP or UA", async () => {
    const h = await visitorHash("203.0.113.9", CHROME, day, "secret");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("203");
  });
  it("is stable within a day and changes the next day, IP, UA or secret", async () => {
    const a = await visitorHash("203.0.113.9", CHROME, day, "secret");
    expect(await visitorHash("203.0.113.9", CHROME, new Date("2026-10-08T23:59:00Z"), "secret")).toBe(a);
    expect(await visitorHash("203.0.113.9", CHROME, new Date("2026-10-09T00:01:00Z"), "secret")).not.toBe(a);
    expect(await visitorHash("203.0.113.10", CHROME, day, "secret")).not.toBe(a);
    expect(await visitorHash("203.0.113.9", IPHONE, day, "secret")).not.toBe(a);
    expect(await visitorHash("203.0.113.9", CHROME, day, "other")).not.toBe(a);
  });
  it("utcDay is UTC", () => expect(utcDay(new Date("2026-10-08T23:30:00-05:00"))).toBe("2026-10-09"));
});
