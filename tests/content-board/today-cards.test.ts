import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
  campaign: { findMany: vi.fn() },
  post: { groupBy: vi.fn(), findFirst: vi.fn() },
  contentVisual: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/publishing/media", () => ({ signPaths: vi.fn(async () => new Map()) }));

import { loadSubjectCards } from "@/lib/content-board/queries";
import { EMPTY_FILTERS } from "@/lib/content-board/filters";

const at = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  prisma.product.findMany.mockResolvedValue([
    { id: "p1", name: "Sourdough", kind: "PHYSICAL", status: "ACTIVE", updatedAt: at, photos: [{ asset: { path: "a.jpg" } }] },
    { id: "p2", name: "Croissant", kind: "PHYSICAL", status: "ACTIVE", updatedAt: at, photos: [{ asset: { path: "b.jpg" } }] },
  ]);
  prisma.campaign.findMany.mockResolvedValue([{ id: "c1", name: "Back to school", type: "OFFER", status: "ACTIVE", updatedAt: at, photos: [{ asset: { path: "c.jpg" } }] }]);
  prisma.post.findFirst.mockResolvedValue(null);
  prisma.contentVisual.findMany.mockResolvedValue([]);
  prisma.post.groupBy.mockImplementation(async (args: { by: string[] }) =>
    // The grid's own counts group by status too; today's count groups by subject only.
    args.by.includes("status")
      ? []
      : [
          { productId: "p1", campaignId: null, _count: { _all: 3 } },
          { productId: null, campaignId: null, _count: { _all: 2 } },
        ],
  );
});

describe("loadSubjectCards: today's posts", () => {
  it("marks the cards with posts made today from one grouped count over the business's local day", async () => {
    const now = new Date("2026-11-12T22:30:00Z"); // 00:30 on 13 Nov in Kigali
    const cards = await loadSubjectCards("b1", EMPTY_FILTERS, "Africa/Kigali", now);
    const made = Object.fromEntries(cards.map((c) => [c.key, c.madeToday]));
    expect(made).toEqual({ "product:p1": 3, "product:p2": 0, "campaign:c1": 0, general: 2 });

    // Two grouped reads in total (the counts and today's), whatever the number of cards: no query per card.
    expect(prisma.post.groupBy).toHaveBeenCalledTimes(2);
    const today = prisma.post.groupBy.mock.calls.map((c) => c[0]).find((a) => !a.by.includes("status"));
    expect(today.by).toEqual(["productId", "campaignId"]);
    expect(today.where).toMatchObject({ businessId: "b1", createdAt: { gte: new Date("2026-11-12T22:00:00Z"), lt: new Date("2026-11-13T22:00:00Z") } });
    expect(today.where.status.in).not.toContain("CANCELLED");
  });

  it("does not follow the board's filters: an app or period filter still shows what was made today", async () => {
    await loadSubjectCards("b1", { ...EMPTY_FILTERS, apps: ["instagram"], view: "week" }, "UTC", new Date("2026-11-12T10:00:00Z"));
    const today = prisma.post.groupBy.mock.calls.map((c) => c[0]).find((a) => !a.by.includes("status"));
    expect(today.where.network).toBeUndefined();
    expect(Object.keys(today.where).sort()).toEqual(["businessId", "createdAt", "status"]);
  });
});
