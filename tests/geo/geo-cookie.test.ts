import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signGeoCookie, verifyGeoCookie } from "@/lib/geo-cookie";

const KEY = Buffer.alloc(32, 7).toString("base64");
beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", KEY));
afterEach(() => vi.unstubAllEnvs());

describe("bp-geo cookie", () => {
  it("round-trips a country", async () => {
    const v = await signGeoCookie("rw");
    expect(v).toMatch(/^RW\.\d+\./);
    expect(await verifyGeoCookie(v)).toBe("RW");
  });

  it("rejects a changed country, time or signature", async () => {
    const [cc, ts, sig] = (await signGeoCookie("FR"))!.split(".");
    expect(await verifyGeoCookie(`RW.${ts}.${sig}`)).toBeNull();
    expect(await verifyGeoCookie(`${cc}.${Number(ts) + 1}.${sig}`)).toBeNull();
    expect(await verifyGeoCookie(`${cc}.${ts}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(await verifyGeoCookie("garbage")).toBeNull();
    expect(await verifyGeoCookie(null)).toBeNull();
  });

  it("expires after 24 hours and rejects a cookie from the future", async () => {
    const now = Date.now();
    const v = await signGeoCookie("RW", now);
    expect(await verifyGeoCookie(v, now + 23 * 3600_000)).toBe("RW");
    expect(await verifyGeoCookie(v, now + 25 * 3600_000)).toBeNull();
    expect(await verifyGeoCookie(v, now - 3600_000)).toBeNull();
  });

  it("is not valid under another key, and nothing works without one", async () => {
    const v = await signGeoCookie("RW");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(await verifyGeoCookie(v)).toBeNull();
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(await signGeoCookie("RW")).toBeNull();
    expect(await verifyGeoCookie(v)).toBeNull();
  });

  it("refuses a malformed country", async () => {
    expect(await signGeoCookie("Rwanda")).toBeNull();
  });
});
