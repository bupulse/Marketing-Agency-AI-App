import { beforeEach, describe, expect, it, vi } from "vitest";

// An empty, filtered day points at the newest matching post (QA 13 Nov: "24 to review" on All posts opened a product
// on today, which said "No posts match these filters this day" with nothing to go to).
const prisma = vi.hoisted(() => ({ post: { findFirst: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma }));

import { latestPostDay } from "@/lib/content-flow/queries";
import { EMPTY_FILTERS } from "@/lib/content-board/filters";

const now = new Date("2026-11-14T10:00:00Z");
const filters = { ...EMPTY_FILTERS, statuses: ["review"] } as typeof EMPTY_FILTERS;

describe("latestPostDay", () => {
  beforeEach(() => prisma.post.findFirst.mockReset());

  it("is the day the newest matching post belongs to, on any date, in the business's time zone", async () => {
    prisma.post.findFirst.mockResolvedValue({ status: "PENDING_APPROVAL", scheduledAt: null, publishedAt: null, createdAt: new Date("2026-10-30T23:30:00Z"), plannedDay: null });
    expect(await latestPostDay("b1", { kind: "product", id: "p1" }, filters, "Africa/Kigali", now)).toBe("2026-10-31");
    const where = prisma.post.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"businessId":"b1"');
    expect(JSON.stringify(where)).toContain('"productId":"p1"');
    // No date window: the subject's newest matching post wherever it is.
    expect(JSON.stringify(where)).not.toContain('"createdAt":{"gte"');
  });

  it("prefers the day a missed post moved to, and is null when nothing matches", async () => {
    prisma.post.findFirst.mockResolvedValue({ status: "PENDING_APPROVAL", scheduledAt: null, publishedAt: null, createdAt: new Date("2026-10-20T08:00:00Z"), plannedDay: new Date("2026-10-23T00:00:00Z") });
    expect(await latestPostDay("b1", { kind: "general" }, filters, "Africa/Kigali", now)).toBe("2026-10-23");
    prisma.post.findFirst.mockResolvedValue(null);
    expect(await latestPostDay("b1", { kind: "general" }, filters, "Africa/Kigali", now)).toBeNull();
  });
});
