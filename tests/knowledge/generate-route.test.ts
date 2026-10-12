import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(async () => ({ deletionScheduledFor: null, suspendedAt: null })) },
  business: { findUnique: vi.fn(async () => ({ id: "b1" })) },
  mediaAsset: { findMany: vi.fn((): Promise<{ id: string; path: string }[]> => Promise.resolve([])) },
  product: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: "prod1" })), findFirst: vi.fn() },
  campaign: { count: vi.fn(async () => 0), findFirst: vi.fn() },
  productPhoto: { findMany: vi.fn(async () => []), createMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
}));
const usage = vi.hoisted(() => ({ consumeUsage: vi.fn(async () => ({ periodStart: new Date() })), refundUsage: vi.fn(async () => {}), UsageLimitError: class extends Error {} }));
const generate = vi.hoisted(() => vi.fn(async () => ({ id: "c1" })));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/supabase/server", () => ({ getCurrentUser: async () => ({ id: "u1" }), createClient: async () => ({}) }));
vi.mock("@/lib/team/company", () => ({ resolveCompany: async () => null }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/studio/service", () => ({ generateForSubject: generate }));
vi.mock("@/lib/region", () => ({ companyRegion: async () => ({ currency: "RWF" }) }));

import { POST } from "@/app/api/generate/route";

const call = (body: unknown) => POST(new Request("https://x.test/api/generate", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("/api/generate with the old project fields", () => {
  it("answers 400 for photo paths that are not the company's gallery photos, before charging or creating anything", async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([{ id: "a1", path: "u1/gallery/a.jpg" }]);
    const res = await call({ type: "product", title: "Basket", photoPaths: ["u1/gallery/a.jpg", "u1/projects/old.jpg"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_photo", paths: ["u1/projects/old.jpg"] });
    expect((prisma.mediaAsset.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ businessId: "b1", path: { in: ["u1/gallery/a.jpg", "u1/projects/old.jpg"] } });
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it("puts gallery photos in the new product's album and writes for it", async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([{ id: "a1", path: "u1/gallery/a.jpg" }]);
    const res = await call({ type: "service", title: "Deep cleaning", price: "From 25,000 RWF", photoPaths: ["u1/gallery/a.jpg"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ projectId: "prod1", productId: "prod1", campaignId: null });
    expect((prisma.product.create.mock.calls[0] as unknown as [{ data: unknown }])[0].data).toMatchObject({ businessId: "b1", kind: "SERVICE", name: "Deep cleaning", priceModel: "FROM", priceNote: "From 25,000 RWF", currency: "RWF" });
    expect(prisma.productPhoto.createMany).toHaveBeenCalledWith({ data: [{ productId: "prod1", assetId: "a1", position: 0 }], skipDuplicates: true });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ subject: { kind: "product", id: "prod1" } }));
  });

  it("refuses more photos than an album holds", async () => {
    const res = await call({ type: "product", title: "Basket", photoPaths: Array.from({ length: 31 }, (_, i) => `u1/gallery/${i}.jpg`) });
    expect(res.status).toBe(400);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });
});
