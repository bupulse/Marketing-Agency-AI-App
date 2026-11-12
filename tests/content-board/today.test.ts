import { describe, expect, it } from "vitest";
import { todayBySubject, todayWhere, todayWindow } from "@/lib/content-board/today";
import { LISTED_STATUSES } from "@/lib/content-board/filters";

describe("todayWindow", () => {
  it("is the business's local day, not the server's UTC day (Kigali, UTC+2, just after local midnight)", () => {
    // 22:30 UTC on 12 Nov is 00:30 on 13 Nov in Kigali: today there is the 13th.
    const now = new Date("2026-11-12T22:30:00Z");
    const { since, until } = todayWindow("Africa/Kigali", now);
    expect(since.toISOString()).toBe("2026-11-12T22:00:00.000Z");
    expect(until.toISOString()).toBe("2026-11-13T22:00:00.000Z");
    // A post made at 23:59 local on the 12th is yesterday's; one at 00:00 local on the 13th is today's.
    const madeAt = (iso: string) => new Date(iso) >= since && new Date(iso) < until;
    expect(madeAt("2026-11-12T21:59:59Z")).toBe(false);
    expect(madeAt("2026-11-12T22:00:00Z")).toBe(true);
    expect(madeAt("2026-11-13T21:59:59Z")).toBe(true);
    expect(madeAt("2026-11-13T22:00:00Z")).toBe(false);
  });

  it("just before local midnight it is still the earlier day (a zone behind UTC)", () => {
    // 03:30 UTC on 13 Nov is 22:30 on 12 Nov in New York (UTC-5).
    const { since, until } = todayWindow("America/New_York", new Date("2026-11-13T03:30:00Z"));
    expect(since.toISOString()).toBe("2026-11-12T05:00:00.000Z");
    expect(until.toISOString()).toBe("2026-11-13T05:00:00.000Z");
  });

  it("keeps a 25-hour day whole when the clocks go back", () => {
    // New York leaves daylight saving on 1 Nov 2026: that local day is 25 hours long.
    const { since, until } = todayWindow("America/New_York", new Date("2026-11-01T15:00:00Z"));
    expect(since.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(until.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("falls back to UTC days for a UTC business", () => {
    const { since, until } = todayWindow("UTC", new Date("2026-11-12T23:59:59Z"));
    expect(since.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(until.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });
});

describe("todayWhere", () => {
  it("counts only this business's posts made today, never cancelled ones", () => {
    const where = todayWhere("b1", "Africa/Kigali", new Date("2026-11-12T22:30:00Z"));
    expect(where.businessId).toBe("b1");
    expect(where.createdAt).toEqual({ gte: new Date("2026-11-12T22:00:00Z"), lt: new Date("2026-11-13T22:00:00Z") });
    const statuses = (where.status as { in: string[] }).in;
    expect(statuses).toEqual([...LISTED_STATUSES]);
    expect(statuses).not.toContain("CANCELLED");
  });
});

describe("todayBySubject", () => {
  it("adds counts per card key: product, campaign, or General for posts without one", () => {
    const map = todayBySubject([
      { productId: "p1", campaignId: null, count: 3 },
      { productId: "p1", campaignId: null, count: 1 },
      { productId: null, campaignId: "c1", count: 2 },
      { productId: null, campaignId: null, count: 4 },
      { productId: "p2", campaignId: null, count: 0 },
    ]);
    expect(Object.fromEntries(map)).toEqual({ "product:p1": 4, "campaign:c1": 2, general: 4 });
    expect(map.has("product:p2")).toBe(false);
  });

  it("files a post with both a product and a campaign under the product, like the grid's counts", () => {
    expect(Object.fromEntries(todayBySubject([{ productId: "p1", campaignId: "c1", count: 1 }]))).toEqual({ "product:p1": 1 });
  });
});
