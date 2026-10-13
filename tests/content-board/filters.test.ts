import { describe, expect, it } from "vitest";
import { activeFilterCount, contentQuery, contentWhere, dateWindow, EMPTY_FILTERS, LISTED_STATUSES, MAX_PAGE_SIZE, PAGE_SIZE, parseContentFilters } from "@/lib/content-board/filters";
import { kindLabel, postKind } from "@/lib/content-board/kind";

const zone = "Africa/Kigali"; // UTC+2, no daylight saving
const now = new Date("2026-10-13T10:00:00Z"); // 12:00 in Kigali

describe("parseContentFilters", () => {
  it("reads comma lists and repeated params, keeping only known values in a stable order", () => {
    const f = parseContentFilters({ app: ["tiktok,instagram", "myspace"], type: "video,Carousel,story", status: "posted,review,nope" });
    expect(f.apps).toEqual(["instagram", "tiktok"]);
    expect(f.kinds).toEqual(["carousel", "video"]);
    expect(f.statuses).toEqual(["review", "posted"]);
  });

  it("defaults to nothing filtered, created date, latest activity and one page", () => {
    expect(parseContentFilters({})).toEqual(EMPTY_FILTERS);
  });

  it("takes the date switch and ranges, and ignores malformed custom days", () => {
    expect(parseContentFilters({ date: "planned", range: "7d" })).toMatchObject({ dateField: "planned", range: "7d" });
    expect(parseContentFilters({ range: "custom", from: "2026-02-31", to: "nope" }).range).toBeUndefined();
    expect(parseContentFilters({ range: "custom", from: "2026-10-20", to: "2026-10-01" })).toMatchObject({ from: "2026-10-01", to: "2026-10-20" });
    expect(parseContentFilters({ range: "forever" }).range).toBeUndefined();
    expect(parseContentFilters({ from: "2026-10-01", range: "7d" }).from).toBeUndefined();
  });

  it("caps the page size and the search text", () => {
    expect(parseContentFilters({ limit: "100000" }).limit).toBe(MAX_PAGE_SIZE);
    expect(parseContentFilters({ limit: "-3" }).limit).toBe(PAGE_SIZE);
    expect(parseContentFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
  });

  it("works on URLSearchParams too", () => {
    expect(parseContentFilters(new URLSearchParams("app=facebook&auto=1&sort=name"))).toMatchObject({ apps: ["facebook"], auto: true, sort: "name" });
  });
});

describe("contentQuery", () => {
  it("round-trips through the parser, so a shared link shows the same view", () => {
    const f = parseContentFilters({ app: "instagram,linkedin", type: "post", status: "scheduled", date: "planned", range: "custom", from: "2026-10-01", to: "2026-10-31", auto: "1", q: "bread", sort: "review" });
    const q = contentQuery(f);
    expect(parseContentFilters(new URLSearchParams(q.slice(1)))).toEqual(f);
  });

  it("is empty for no filters and leaves the page size out unless asked", () => {
    expect(contentQuery(EMPTY_FILTERS)).toBe("");
    expect(contentQuery({ ...EMPTY_FILTERS, limit: 48 })).toBe("");
    expect(contentQuery({ ...EMPTY_FILTERS, limit: 48 }, { limit: true })).toBe("?limit=48");
  });

  it("counts active filters, not search or sort", () => {
    expect(activeFilterCount(parseContentFilters({ app: "instagram,tiktok", range: "today", q: "x", sort: "name" }))).toBe(3);
  });
});

describe("dateWindow", () => {
  it("today runs from local midnight to the next one", () => {
    expect(dateWindow({ range: "today", dateField: "created" }, zone, now)).toEqual({ gte: new Date("2026-10-12T22:00:00Z"), lt: new Date("2026-10-13T22:00:00Z") });
  });

  it("created looks back; scheduled or posted looks back and ahead", () => {
    expect(dateWindow({ range: "7d", dateField: "created" }, zone, now)).toEqual({ gte: new Date("2026-10-06T22:00:00Z"), lt: new Date("2026-10-13T22:00:00Z") });
    expect(dateWindow({ range: "7d", dateField: "planned" }, zone, now)).toEqual({ gte: new Date("2026-10-06T22:00:00Z"), lt: new Date("2026-10-19T22:00:00Z") });
  });

  it("custom days are inclusive and either end may be open", () => {
    expect(dateWindow({ range: "custom", from: "2026-10-01", to: "2026-10-02", dateField: "created" }, zone, now)).toEqual({ gte: new Date("2026-09-30T22:00:00Z"), lt: new Date("2026-10-02T22:00:00Z") });
    expect(dateWindow({ range: "custom", from: "2026-10-01", dateField: "created" }, zone, now)).toEqual({ gte: new Date("2026-09-30T22:00:00Z") });
    expect(dateWindow({ dateField: "created" }, zone, now)).toBeNull();
  });
});

describe("contentWhere", () => {
  it("is always scoped to the business and never lists cancelled posts", () => {
    const where = contentWhere("b1", EMPTY_FILTERS, { zone, now });
    expect(where.businessId).toBe("b1");
    expect(where.status).toEqual({ in: LISTED_STATUSES });
    expect(LISTED_STATUSES).not.toContain("CANCELLED");
  });

  it("maps every filter to one database query", () => {
    const f = parseContentFilters({ app: "instagram", type: "video", status: "review,failed", range: "today", auto: "1", q: "bread" });
    const where = contentWhere("b1", f, { zone, now, scope: { kind: "product", id: "p1" } });
    expect(where).toMatchObject({
      businessId: "b1",
      network: { in: ["instagram"] },
      mediaKind: { in: ["video"] },
      status: { in: ["PENDING_APPROVAL", "DRAFT", "FAILED"] },
      autoScheduledAt: { not: null },
      productId: "p1",
      createdAt: { gte: new Date("2026-10-12T22:00:00Z"), lt: new Date("2026-10-13T22:00:00Z") },
    });
    expect(where.AND).toEqual([{ OR: [{ text: { contains: "bread", mode: "insensitive" } }, { title: { contains: "bread", mode: "insensitive" } }] }]);
  });

  it("filters scheduled or posted on the publish time, else the planned time", () => {
    const where = contentWhere("b1", parseContentFilters({ date: "planned", range: "today" }), { zone, now });
    const window = { gte: new Date("2026-10-12T22:00:00Z"), lt: new Date("2026-10-13T22:00:00Z") };
    expect(where.createdAt).toBeUndefined();
    expect(where.AND).toEqual([{ OR: [{ publishedAt: window }, { publishedAt: null, scheduledAt: window }] }]);
  });

  it("General means tied to no product or campaign; the grid can ignore status and search", () => {
    const f = parseContentFilters({ status: "posted", q: "x" });
    const where = contentWhere("b1", f, { zone, now, scope: { kind: "general" }, ignore: ["statuses", "q"] });
    expect(where).toMatchObject({ productId: null, campaignId: null, status: { in: LISTED_STATUSES } });
    expect(where.AND).toBeUndefined();
  });
});

describe("postKind", () => {
  it("follows the same rule as the database trigger", () => {
    expect(postKind("ARTICLE", [])).toBe("article");
    expect(postKind("SCRIPT", [])).toBe("video");
    expect(postKind("POST", ["u/videos/a.mp4"])).toBe("video");
    expect(postKind("CAROUSEL", ["a.png", "b.png"])).toBe("carousel");
    expect(postKind("POST", ["a.png"])).toBe("post");
  });

  it("uses each app's own name for the type", () => {
    expect(kindLabel("video", "instagram")).toBe("Reel");
    expect(kindLabel("video", "youtube")).toBe("Short");
    expect(kindLabel("video", "tiktok")).toBe("Video");
    expect(kindLabel("article", "linkedin")).toBe("LinkedIn article");
  });
});
