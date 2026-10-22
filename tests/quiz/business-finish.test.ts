import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
  campaign: { findMany: vi.fn() },
  connection: { count: vi.fn() },
  persona: { findMany: vi.fn() },
  competitor: { count: vi.fn() },
  knowledgeFaq: { count: vi.fn() },
  testimonial: { count: vi.fn() },
  marketingInterview: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));

import { knowledgeProgress } from "@/lib/knowledge/overview";
import { toReachFull, type SectionProgress, type SectionKey } from "@/lib/knowledge/sections";

// Placeholder business (fixtures use fake names).
const business = { id: "b1", name: "Inzozi Bakery", website: null, industryId: "i1", industryOther: null, profile: null, knowledge: null, logoUrl: null, brandColors: ["#2F6BFF"], tone: "warm", positioning: null, policies: null, marketingProfile: null };
const product = (photos: number) => ({ summary: "Fresh", usps: ["Made fresh"], priceModel: "ON_REQUEST", priceAmount: null, priceNote: null, _count: { photos } });

beforeEach(() => {
  vi.resetAllMocks();
  prisma.product.findMany.mockResolvedValue([product(0), product(0), product(0), product(2)]);
  prisma.campaign.findMany.mockResolvedValue([]);
  prisma.connection.count.mockResolvedValue(0);
  prisma.persona.findMany.mockResolvedValue([]);
  prisma.competitor.count.mockResolvedValue(0);
  prisma.knowledgeFaq.count.mockResolvedValue(0);
  prisma.testimonial.count.mockResolvedValue(0);
  prisma.marketingInterview.findUnique.mockResolvedValue(null);
});

describe("the to-do of each section", () => {
  it("says what to do next, with counts", async () => {
    const p = await knowledgeProgress(business, "2026-10-22");
    expect(p.products?.next).toBe("Add photos to 3 products");
    expect(p.brand?.next).toBe("Upload your logo");
    expect(p.channels?.summary).toBe("Connect a social account");
    expect(p.audience?.next).toBe("Describe your main customer");
    expect(p.reviews?.next).toBe("Add what customers say about you");
  });
});

describe("toReachFull", () => {
  const progress: Partial<Record<SectionKey, SectionProgress>> = {
    profile: { percent: 100, summary: "Complete" },
    products: { percent: 25, summary: "4 items · 3 need details", next: "Add photos to 3 products" },
    campaigns: { percent: null, summary: "None yet" },
    locations: { percent: 67, summary: "Add your phone" },
    brand: { percent: 67, summary: "Add your logo", next: "Upload your logo" },
    channels: { percent: 0, summary: "Connect a social account" },
    audience: { percent: 50, summary: "Add their needs", next: "Add your customers' needs" },
    faqs: { percent: 90, summary: "Add your policies" },
  };

  it("lists the furthest from complete first, at most 4, each with the page that fixes it", () => {
    expect(toReachFull(progress, () => true)).toEqual([
      { key: "channels", label: "Connect a social account", href: "/dashboard/connections" },
      { key: "products", label: "Add photos to 3 products", href: "/dashboard/knowledge/products" },
      { key: "audience", label: "Add your customers' needs", href: "/dashboard/knowledge/audience" },
      { key: "locations", label: "Add your phone", href: "/dashboard/knowledge/locations" },
    ]);
  });

  it("leaves out what the person may not edit, complete sections and sections without a %", () => {
    const todo = toReachFull(progress, (s) => s.permission !== "channels" && s.permission !== "settings", 10);
    expect(todo.map((t) => t.key)).toEqual(["products", "audience"]);
    expect(toReachFull({ profile: { percent: 100, summary: "Complete" } }, () => true)).toEqual([]);
  });
});
