import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, parseContentFilters } from "@/lib/content-board/filters";
import { buildSubjectCards, countBySubject, subjectHref, type CountRow, type SubjectRow } from "@/lib/content-board/grouping";

const day = (d: number) => new Date(Date.UTC(2026, 9, d));
const product = (id: string, name: string, extra: Partial<SubjectRow> = {}): SubjectRow => ({ id, name, label: "Physical product", status: "ACTIVE", updatedAt: day(1), coverPath: null, ...extra });
const campaign = (id: string, name: string, extra: Partial<SubjectRow> = {}): SubjectRow => ({ id, name, label: "Offer", status: "ACTIVE", updatedAt: day(1), coverPath: null, ...extra });
const row = (subject: { productId?: string; campaignId?: string }, status: string, count: number, last = day(5)): CountRow => ({ productId: subject.productId ?? null, campaignId: subject.campaignId ?? null, status, count, lastCreatedAt: last });

const products = [product("p1", "Sourdough"), product("p2", "Croissant"), product("p3", "Old cake", { status: "ARCHIVED" })];
const campaigns = [campaign("c1", "Back to school")];
const counts: CountRow[] = [
  row({ productId: "p1" }, "PENDING_APPROVAL", 2, day(10)),
  row({ productId: "p1" }, "DRAFT", 1, day(9)),
  row({ productId: "p1" }, "SCHEDULED", 3),
  row({ productId: "p1" }, "PUBLISHING", 1),
  row({ productId: "p1" }, "PUBLISHED", 4),
  row({ productId: "p1" }, "FAILED", 1),
  row({ campaignId: "c1" }, "PUBLISHED", 2, day(12)),
  row({}, "PENDING_APPROVAL", 5, day(11)),
  row({}, "CANCELLED", 9, day(13)),
];

describe("countBySubject", () => {
  it("adds statuses into review, scheduled, posted and failed, and ignores cancelled posts", () => {
    const map = countBySubject(counts);
    expect(map.get("product:p1")?.counts).toEqual({ review: 3, scheduled: 4, posted: 4, failed: 1 });
    expect(map.get("campaign:c1")?.counts).toEqual({ review: 0, scheduled: 0, posted: 2, failed: 0 });
    expect(map.get("general")?.counts).toEqual({ review: 5, scheduled: 0, posted: 0, failed: 0 });
    expect(map.get("general")?.last).toEqual(day(11));
  });
});

describe("buildSubjectCards", () => {
  it("makes one card per product and campaign plus General, and hides archived ones without posts", () => {
    const cards = buildSubjectCards({ products, campaigns, counts, filters: EMPTY_FILTERS });
    expect(cards.map((c) => c.key).sort()).toEqual(["campaign:c1", "general", "product:p1", "product:p2"]);
    const general = cards.find((c) => c.kind === "general")!;
    expect(general).toMatchObject({ name: "General", href: "/dashboard/content/general", total: 5 });
    expect(cards.find((c) => c.key === "product:p1")).toMatchObject({ href: "/dashboard/content/products/p1", total: 12 });
  });

  it("keeps an archived product that still has posts", () => {
    const cards = buildSubjectCards({ products, campaigns, counts: [...counts, row({ productId: "p3" }, "PUBLISHED", 1)], filters: EMPTY_FILTERS });
    expect(cards.some((c) => c.key === "product:p3")).toBe(true);
  });

  it("sorts by latest activity by default, by most to review, or by name", () => {
    expect(buildSubjectCards({ products, campaigns, counts, filters: EMPTY_FILTERS }).map((c) => c.key)).toEqual(["campaign:c1", "general", "product:p1", "product:p2"]);
    expect(buildSubjectCards({ products, campaigns, counts, filters: { ...EMPTY_FILTERS, sort: "review" } }).map((c) => c.key).slice(0, 2)).toEqual(["general", "product:p1"]);
    expect(buildSubjectCards({ products, campaigns, counts, filters: { ...EMPTY_FILTERS, sort: "name" } }).map((c) => c.name)).toEqual(["Back to school", "Croissant", "General", "Sourdough"]);
  });

  it("with a post filter on, shows only subjects with matching posts", () => {
    const f = parseContentFilters({ status: "review" });
    expect(buildSubjectCards({ products, campaigns, counts, filters: f }).map((c) => c.key).sort()).toEqual(["general", "product:p1"]);
    const byApp = parseContentFilters({ app: "tiktok" });
    expect(buildSubjectCards({ products, campaigns, counts: [row({ campaignId: "c1" }, "SCHEDULED", 1)], filters: byApp }).map((c) => c.key)).toEqual(["campaign:c1"]);
  });

  it("searches names and kinds", () => {
    expect(buildSubjectCards({ products, campaigns, counts, filters: { ...EMPTY_FILTERS, q: "sour" } }).map((c) => c.key)).toEqual(["product:p1"]);
    expect(buildSubjectCards({ products, campaigns, counts, filters: { ...EMPTY_FILTERS, q: "offer" } }).map((c) => c.key)).toEqual(["campaign:c1"]);
  });

  it("links each subject to its posts", () => {
    expect(subjectHref("campaign", "c1")).toBe("/dashboard/content/campaigns/c1");
    expect(subjectHref("general", null)).toBe("/dashboard/content/general");
  });
});
