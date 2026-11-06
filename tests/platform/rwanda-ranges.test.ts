import { describe, expect, it } from "vitest";
import { visitorCountry } from "@/lib/platform/headers";
import { RWANDA_RANGES } from "@/lib/platform/rwanda-ranges";
import { parseIp } from "@/lib/platform/cidr";

// 6 November 2026: a Liquid Telecom Rwanda home line in Kigali came through Cloudflare as UG, so /pricing showed
// East Africa prices. Addresses below are the first host of Rwandan providers' ranges, not anyone's real address.
describe("Rwandan providers' addresses count as Rwanda", () => {
  it("every range is a valid CIDR", () => {
    for (const range of RWANDA_RANGES) {
      const [base, bits] = range.split("/");
      expect(parseIp(base), range).not.toBeNull();
      expect(Number(bits), range).toBeGreaterThanOrEqual(8);
    }
  });

  it.each([
    ["Liquid Telecom Rwanda, seen by Cloudflare as Uganda", "41.186.0.1", "UG"],
    ["MTN Rwandacell with no country", "197.157.128.1", null],
    ["KT Rwanda over IPv6", "2c0f:eb68::1", "KE"],
  ])("%s", (_name, ip, cf) => {
    const h = new Headers({ "cf-connecting-ip": ip, ...(cf ? { "cf-ipcountry": cf } : {}) });
    expect(visitorCountry(h, "node")).toBe("RW");
    expect(visitorCountry(h, "cloudflare")).toBe("RW");
  });

  it("uses Netlify's own client address on Netlify, never cf-connecting-ip", () => {
    expect(visitorCountry(new Headers({ "x-nf-client-connection-ip": "41.186.0.1" }), "netlify")).toBe("RW");
    expect(visitorCountry(new Headers({ "cf-connecting-ip": "41.186.0.1" }), "netlify")).toBeNull();
  });

  it("leaves other addresses to the host's country", () => {
    expect(visitorCountry(new Headers({ "cf-connecting-ip": "8.8.8.8", "cf-ipcountry": "UG" }), "node")).toBe("UG");
    expect(visitorCountry(new Headers({ "cf-ipcountry": "KE" }), "node")).toBe("KE");
    // A chosen x-forwarded-for is never the address used.
    expect(visitorCountry(new Headers({ "x-forwarded-for": "41.186.0.1", "cf-ipcountry": "UG" }), "cloudflare")).toBe("UG");
  });
});
