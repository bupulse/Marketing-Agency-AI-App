import { afterEach, describe, expect, it, vi } from "vitest";
import { devCountry, ipCountryFromHeaders, regionOverrideEnabled, resolveDisplayRegionKey } from "@/lib/region";
import { REGION_SEEDS } from "@/lib/region-format";

afterEach(() => vi.unstubAllEnvs());

describe("visitor country", () => {
  it("reads Cloudflare's header and ignores unknown values", () => {
    expect(ipCountryFromHeaders(new Headers({ "cf-ipcountry": "rw" }))).toBe("RW");
    expect(ipCountryFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(ipCountryFromHeaders(new Headers({ "cf-ipcountry": "T1" }))).toBeNull();
    expect(ipCountryFromHeaders(new Headers())).toBeNull();
  });

  it("uses ANALYTICS_DEV_COUNTRY outside production only", () => {
    vi.stubEnv("ANALYTICS_DEV_COUNTRY", "ke");
    vi.stubEnv("NODE_ENV", "development");
    expect(devCountry()).toBe("KE");
    vi.stubEnv("NODE_ENV", "production");
    expect(devCountry()).toBeNull();
  });
});

describe("region resolution order", () => {
  const key = (input: Parameters<typeof resolveDisplayRegionKey>[0]) => resolveDisplayRegionKey(input, REGION_SEEDS);

  it("IP country wins over the dev country (a Cloudflare tunnel shows real detection)", () => {
    expect(key({ ip: "FR", dev: "RW" })).toBe("GLOBAL");
    expect(key({ dev: "RW" })).toBe("RW");
  });

  it("a verified location beats the IP country, for VPN users", () => {
    expect(key({ geo: "RW", ip: "FR" })).toBe("RW");
    expect(key({ geo: "KE", ip: "RW", dev: "FR" })).toBe("EAC");
  });

  it("no location changes nothing, and nothing at all is the catch-all", () => {
    expect(key({ geo: null, ip: "RW" })).toBe("RW");
    expect(key({})).toBe("GLOBAL");
  });
});

describe("REGION_OVERRIDE", () => {
  it("is off unless exactly 1", () => {
    expect(regionOverrideEnabled()).toBe(false);
    vi.stubEnv("REGION_OVERRIDE", "true");
    expect(regionOverrideEnabled()).toBe(false);
    vi.stubEnv("REGION_OVERRIDE", "1");
    expect(regionOverrideEnabled()).toBe(true);
  });

  it("the override key beats everything when passed, and an inactive or unknown key is ignored", () => {
    expect(resolveDisplayRegionKey({ query: "EAC", geo: "RW", ip: "RW" }, REGION_SEEDS)).toBe("EAC");
    expect(resolveDisplayRegionKey({ cookie: "nope", ip: "RW" }, REGION_SEEDS)).toBe("RW");
    expect(resolveDisplayRegionKey({ query: "EAC", ip: "RW" }, REGION_SEEDS.map((r) => (r.key === "EAC" ? { ...r, active: false } : r)))).toBe("RW");
  });
});
