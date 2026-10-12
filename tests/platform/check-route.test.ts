import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/platform/check/route";

const geo = Buffer.from(JSON.stringify({ country: { code: "RW" } })).toString("base64");
const call = (headers: Record<string, string>) => GET(new Request("https://bupulse.test/api/platform/check", { headers }));

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/platform/check", () => {
  it("is off unless PLATFORM_CHECK=1", async () => {
    expect((await call({})).status).toBe(404);
  });

  it("answers what the app reads on Netlify, ignoring headers a visitor chose", async () => {
    vi.stubEnv("PLATFORM_CHECK", "1");
    vi.stubEnv("PLATFORM", "netlify");
    const res = await call({ "x-nf-geo": geo, "x-nf-client-connection-ip": "198.51.100.7", "x-country": "US", "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8", "cf-ipcountry": "US" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ platform: "netlify", country: "RW", ip: "198.51.100.7" });
    expect(await (await call({ "x-country": "US", "x-forwarded-for": "1.2.3.4" })).json()).toEqual({ platform: "netlify", country: null, ip: null });
  });
});
