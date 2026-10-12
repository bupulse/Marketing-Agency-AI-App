import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { POST } from "@/app/api/geo/country/route";
import { builtinCountryAt } from "@/lib/geo/builtin";
import { geoLookupAvailable, geoProvider } from "@/lib/geo/provider";
import { verifyGeoCookie } from "@/lib/geo-cookie";

const post = (body: unknown) => POST(new Request("http://x/api/geo/country", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify(body) }));

beforeEach(() => {
  mocks.rateLimit.mockReset().mockResolvedValue(undefined);
  mocks.set.mockReset();
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
  vi.stubEnv("GEO_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("built-in country map", () => {
  it.each([
    ["Kigali", -1.9441, 30.0619, "RW"],
    ["Nairobi", -1.2864, 36.8172, "KE"],
    ["Kampala", 0.3476, 32.5825, "UG"],
    ["Lisbon", 38.7223, -9.1393, "PT"],
    ["Dar es Salaam", -6.7924, 39.2083, "TZ"],
    ["Bujumbura", -3.3822, 29.3644, "BI"],
    ["Paris", 48.8566, 2.3522, "FR"],
    ["New York", 40.7128, -74.006, "US"],
  ])("%s is %s", (_n, lat, lng, code) => expect(builtinCountryAt(lat, lng)).toBe(code));

  it("open sea has no country", () => {
    expect(builtinCountryAt(30, -40)).toBeNull();
    expect(builtinCountryAt(-10, 70)).toBeNull();
  });

  it("border towns land on the right side", () => {
    expect(builtinCountryAt(-1.7, 29.26)).toBe("RW"); // Gisenyi (Rubavu)
    expect(builtinCountryAt(-1.68, 29.22)).toBe("CD"); // Goma, a few km away
  });

  it("rejects out-of-range input", () => {
    expect(builtinCountryAt(95, 0)).toBeNull();
    expect(builtinCountryAt(0, NaN)).toBeNull();
  });
});

describe("GEO_PROVIDER", () => {
  it("defaults to builtin, which is always available", async () => {
    expect(geoProvider()).toBe("builtin");
    expect(await geoLookupAvailable()).toBe(true);
    vi.stubEnv("GEO_PROVIDER", "nonsense");
    expect(geoProvider()).toBe("builtin");
    vi.stubEnv("GEO_PROVIDER", "Google");
    expect(geoProvider()).toBe("google");
  });

  it("the route works offline with no Google key, no fetch, and signs the cookie", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ lat: -1.9441, lng: 30.0619 });
    expect(await res.json()).toEqual({ enabled: true, country: "RW" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await verifyGeoCookie(mocks.set.mock.calls[0][1])).toBe("RW");
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("still validates, and answers 404 at sea without a cookie", async () => {
    expect((await post({ lat: 120, lng: 0 })).status).toBe(400);
    expect((await post({ lat: 30, lng: -40 })).status).toBe(404);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
