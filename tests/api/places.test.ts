import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkActiveUser: vi.fn(),
  rateLimit: vi.fn(),
  logError: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", () => ({ checkActiveUser: mocks.checkActiveUser }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));

import { GET as autocomplete } from "@/app/api/places/autocomplete/route";
import { GET as details } from "@/app/api/places/details/route";
import { RateLimitError } from "@/lib/rate-limit";

const KEY = "AIzaSy-test-secret-key";
const SESSION = "0123456789abcdef0123456789abcdef";
const USER = { id: "owner-1", actorId: "owner-1", role: "OWNER", businessId: "b1" };
const req = (path: string) => new Request(`http://127.0.0.1:3000${path}`);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GOOGLE_MAPS_API_KEY = KEY;
  mocks.checkActiveUser.mockResolvedValue({ status: "ok", user: USER });
  mocks.findUnique.mockResolvedValue({ country: "Rwanda" });
  mocks.rateLimit.mockResolvedValue(undefined);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_MAPS_API_KEY;
});

describe("/api/places/autocomplete", () => {
  it("needs a signed-in user allowed to edit the brand", async () => {
    mocks.checkActiveUser.mockResolvedValue({ status: "signed_out" });
    expect((await autocomplete(req(`/api/places/autocomplete?q=Kigali&session=${SESSION}`))).status).toBe(401);
    mocks.checkActiveUser.mockResolvedValue({ status: "suspended" });
    expect((await autocomplete(req(`/api/places/autocomplete?q=Kigali&session=${SESSION}`))).status).toBe(403);
    mocks.checkActiveUser.mockResolvedValue({ status: "ok", user: { ...USER, role: "MEMBER" } });
    expect((await autocomplete(req(`/api/places/autocomplete?q=Kigali&session=${SESSION}`))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers enabled: false without a key, so the box stays a plain input", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const res = await autocomplete(req(`/api/places/autocomplete?q=Kigali&session=${SESSION}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("is rate limited per company", async () => {
    mocks.rateLimit.mockRejectedValue(new RateLimitError(120));
    const res = await autocomplete(req(`/api/places/autocomplete?q=Kigali&session=${SESSION}`));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(mocks.rateLimit.mock.calls[0][0]).toBe("places:autocomplete:owner-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects bad input", async () => {
    expect((await autocomplete(req(`/api/places/autocomplete?q=K&session=${SESSION}`))).status).toBe(400);
    expect((await autocomplete(req(`/api/places/autocomplete?q=Kigali&session=short`))).status).toBe(400);
  });

  it("calls Places (New) with the key in a header, the session token and the business region", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        suggestions: [
          { placePrediction: { placeId: "ChIJ_kigali_heights", text: { text: "Kigali Heights, KG 7 Ave, Kigali, Rwanda" }, structuredFormat: { mainText: { text: "Kigali Heights" }, secondaryText: { text: "KG 7 Ave, Kigali, Rwanda" } } } },
          { placePrediction: { placeId: "bad id!", text: { text: "x" } } },
          { queryPrediction: { text: { text: "query only" } } },
        ],
      }),
    );
    const res = await autocomplete(req(`/api/places/autocomplete?q=Kigali%20Heights&session=${SESSION}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      suggestions: [{ placeId: "ChIJ_kigali_heights", main: "Kigali Heights", secondary: "KG 7 Ave, Kigali, Rwanda", text: "Kigali Heights, KG 7 Ave, Kigali, Rwanda" }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(url).not.toContain(KEY);
    expect(init.headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(init.headers["X-Goog-FieldMask"]).toContain("placePrediction.placeId");
    expect(JSON.parse(init.body)).toMatchObject({ input: "Kigali Heights", sessionToken: SESSION, regionCode: "rw" });
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("hides Google's errors and never leaks the key", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: `API key ${KEY} not valid` } }), { status: 403 }));
    const res = await autocomplete(req(`/api/places/autocomplete?q=Kigali&session=${SESSION}`));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).toContain("Type the address instead");
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(KEY);
  });

  it("survives a timeout or network error", async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed for key=${KEY}`));
    const res = await autocomplete(req(`/api/places/autocomplete?q=Kigali&session=${SESSION}`));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(KEY);
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(KEY);
  });
});

describe("/api/places/details", () => {
  it("returns the address and coordinates, asking only for Essentials fields", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "ChIJ_kigali_heights", formattedAddress: "KG 7 Ave, Kigali, Rwanda", location: { latitude: -1.9536, longitude: 30.0928 } }));
    const res = await details(req(`/api/places/details?id=ChIJ_kigali_heights&session=${SESSION}`));
    expect(await res.json()).toEqual({ enabled: true, place: { placeId: "ChIJ_kigali_heights", address: "KG 7 Ave, Kigali, Rwanda", lat: -1.9536, lng: 30.0928 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/places\.googleapis\.com\/v1\/places\/ChIJ_kigali_heights\?/);
    expect(url).toContain(`sessionToken=${SESSION}`);
    expect(url).toContain("regionCode=rw");
    expect(url).not.toContain(KEY);
    expect(init.headers["X-Goog-FieldMask"]).toBe("id,formattedAddress,location");
    expect(mocks.rateLimit.mock.calls[0][0]).toBe("places:details:owner-1");
  });

  it("rejects malformed place ids before calling Google", async () => {
    expect((await details(req(`/api/places/details?id=../../etc&session=${SESSION}`))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs auth and degrades without a key", async () => {
    mocks.checkActiveUser.mockResolvedValue({ status: "signed_out" });
    expect((await details(req(`/api/places/details?id=ChIJ_kigali_heights`))).status).toBe(401);
    mocks.checkActiveUser.mockResolvedValue({ status: "ok", user: USER });
    delete process.env.GOOGLE_MAPS_API_KEY;
    expect(await (await details(req(`/api/places/details?id=ChIJ_kigali_heights`))).json()).toEqual({ enabled: false });
  });
});
