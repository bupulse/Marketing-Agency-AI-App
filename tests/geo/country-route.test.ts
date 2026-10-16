import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { POST } from "@/app/api/geo/country/route";
import { RateLimitError } from "@/lib/rate-limit";
import { verifyGeoCookie } from "@/lib/geo-cookie";
import { geocodingAvailable, resetGeocodingAvailability } from "@/lib/geo-availability";

const ok = { status: "OK", results: [{ address_components: [{ short_name: "RW", types: ["country"] }] }] };

const post = (body: unknown, headers: Record<string, string> = { "cf-connecting-ip": "1.2.3.4" }) =>
  POST(new Request("http://x/api/geo/country", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
/** Warms the availability probe so later fetch counts are the request's own. */
async function warm() {
  const f = google(ok);
  vi.stubGlobal("fetch", f);
  await geocodingAvailable();
  f.mockClear();
  return f;
}
const google = (data: unknown, ok = true) => vi.fn(async () => new Response(JSON.stringify(data), { status: ok ? 200 : 500 }));

beforeEach(() => {
  mocks.rateLimit.mockReset().mockResolvedValue(undefined);
  mocks.set.mockReset();
  resetGeocodingAvailability();
  vi.stubEnv("GEO_PROVIDER", "google"); // these tests cover the Google provider; tests/geo/builtin.test.ts the default
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "k-secret");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("geocoding availability", () => {
  it("is off without a key and on when Google answers", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    expect(await geocodingAvailable()).toBeNull();
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
    vi.stubGlobal("fetch", google(ok));
    expect(await geocodingAvailable()).toBe("k");
  });

  it("REQUEST_DENIED hides the feature, is cached, and the route answers enabled:false without a cookie", async () => {
    const fetchMock = google({ status: "REQUEST_DENIED", error_message: "You must enable Billing" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await geocodingAvailable()).toBeNull();
    expect(await geocodingAvailable()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const res = await post({ lat: 1, lng: 30 });
    expect(await res.json()).toEqual({ enabled: false });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-checks after 10 minutes", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = google({ status: "REQUEST_DENIED" });
      vi.stubGlobal("fetch", fetchMock);
      await geocodingAvailable();
      vi.advanceTimersByTime(11 * 60 * 1000);
      vi.stubGlobal("fetch", google(ok));
      expect(await geocodingAvailable()).toBe("k-secret");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a denial seen while serving a request hides it too, and a network error is not a denial", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(ok))).mockResolvedValueOnce(new Response(JSON.stringify({ status: "REQUEST_DENIED" }))));
    expect((await post({ lat: 1, lng: 30 })).status).toBe(200);
    resetGeocodingAvailability();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await geocodingAvailable()).toBe("k-secret");
  });
});

describe("POST /api/geo/country", () => {
  it("answers { enabled: false } without a key and calls nothing", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const fetchMock = google({});
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ lat: 1, lng: 30 });
    expect(await res.json()).toEqual({ enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects bad coordinates before the rate limit or Google", async () => {
    const fetchMock = await warm();
    for (const body of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: "1", lng: 2 }, { lat: null, lng: 2 }, {}, "not json"]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate-limits per IP", async () => {
    mocks.rateLimit.mockRejectedValueOnce(new RateLimitError(120));
    const fetchMock = await warm();
    const res = await post({ lat: 1, lng: 30 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(mocks.rateLimit.mock.calls[0][0]).toBe("geo:country:1.2.3.4");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reverse-geocodes server-side, returns only the code and sets a signed httpOnly cookie", async () => {
    const fetchMock = google(ok);
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ lat: -1.95, lng: 30.06 });
    expect(await res.json()).toEqual({ enabled: true, country: "RW" });
    const url = String((fetchMock.mock.calls.at(-1) as unknown[])[0]);
    expect(url).toContain("maps.googleapis.com/maps/api/geocode/json");
    expect(url).toContain("result_type=country");
    expect(url).toContain("key=k-secret");
    const [name, value, opts] = mocks.set.mock.calls[0];
    expect(name).toBe("bp-geo");
    expect(opts).toMatchObject({ httpOnly: true, maxAge: 86400, path: "/" });
    expect(await verifyGeoCookie(value)).toBe("RW");
    expect(value).not.toContain("30.06");
  });

  it("answers 404 for open sea and 502 when Google fails, setting no cookie", async () => {
    vi.stubGlobal("fetch", google({ status: "ZERO_RESULTS", results: [] }));
    expect((await post({ lat: 0, lng: 0 })).status).toBe(404);
    vi.stubGlobal("fetch", google({ status: "UNKNOWN_ERROR" }));
    const res = await post({ lat: 1, lng: 30 });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("k-secret");
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
