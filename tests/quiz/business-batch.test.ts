import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  knowledgeFaq: { count: vi.fn(), findFirst: vi.fn(), createManyAndReturn: vi.fn() },
  competitor: { count: vi.fn(), findFirst: vi.fn(), createManyAndReturn: vi.fn() },
  product: { count: vi.fn(), createManyAndReturn: vi.fn() },
}));
const db = vi.hoisted(() => ({ product: { findMany: vi.fn(), updateMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), product: db.product } }));

import { createCompetitors, createFaqs } from "@/lib/knowledge/records";
import { activateReadyDrafts, createProducts } from "@/lib/knowledge/service";
import { MAX_FAQS } from "@/lib/knowledge/policies";
import { MAX_PRODUCTS_PER_BUSINESS, productInputSchema } from "@/lib/knowledge/products";

beforeEach(() => {
  vi.resetAllMocks();
  tx.$executeRaw.mockResolvedValue(1);
});

describe("the quiz's batch creates", () => {
  it("add the questions at the end of the list in one write, under the lock, in order", async () => {
    tx.knowledgeFaq.count.mockResolvedValue(3);
    tx.knowledgeFaq.findFirst.mockResolvedValue({ position: 4 });
    tx.knowledgeFaq.createManyAndReturn.mockResolvedValue([{ id: "f2", position: 6 }, { id: "f1", position: 5 }]);
    const ids = await createFaqs("b1", [{ question: "A?", answer: "a" }, { question: "B?", answer: "b" }]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.knowledgeFaq.createManyAndReturn.mock.calls[0][0].data).toEqual([
      { businessId: "b1", position: 5, question: "A?", answer: "a" },
      { businessId: "b1", position: 6, question: "B?", answer: "b" },
    ]);
    expect(ids).toEqual(["f1", "f2"]);
  });

  it("refuse a batch that would pass the cap, and write nothing for an empty one", async () => {
    tx.knowledgeFaq.count.mockResolvedValue(MAX_FAQS - 1);
    tx.knowledgeFaq.findFirst.mockResolvedValue({ position: 9 });
    await expect(createFaqs("b1", [{ question: "A?", answer: "a" }, { question: "B?", answer: "b" }])).rejects.toThrow(/up to/);
    expect(tx.knowledgeFaq.createManyAndReturn).not.toHaveBeenCalled();
    expect(await createCompetitors("b1", [])).toEqual([]);
    expect(tx.competitor.count).not.toHaveBeenCalled();
  });

  it("create the products in one write under the products lock and limit", async () => {
    const data = productInputSchema.parse({ kind: "PHYSICAL", name: "Passion Juice", summary: "Fresh", priceModel: "ON_REQUEST", currency: "RWF", usps: ["Made fresh"], status: "DRAFT" });
    tx.product.count.mockResolvedValue(10);
    tx.product.createManyAndReturn.mockResolvedValue([{ id: "p1", name: "Passion Juice" }]);
    expect(await createProducts("b1", [data])).toEqual([{ id: "p1", name: "Passion Juice" }]);
    expect(tx.product.createManyAndReturn.mock.calls[0][0].data[0]).toMatchObject({ businessId: "b1", name: "Passion Juice", priceModel: "ON_REQUEST", status: "DRAFT" });
    tx.product.count.mockResolvedValue(MAX_PRODUCTS_PER_BUSINESS);
    await expect(createProducts("b1", [data])).rejects.toThrow(/limit/);
  });
});

describe("activateReadyDrafts", () => {
  // Placeholder products (fixtures use fake names).
  const draft = (id: string, name: string, patch: Record<string, unknown> = {}) => ({ id, name, summary: "Done with care", usps: ["Lasts two weeks"], priceModel: "ON_REQUEST", priceAmount: null, priceNote: null, _count: { photos: 1 }, ...patch });

  it("makes every ready draft active, from any visit, and leaves half-finished ones as drafts", async () => {
    db.product.findMany.mockResolvedValue([draft("p1", "Classic Manicure"), draft("p2", "Hair Braiding", { _count: { photos: 2 } }), draft("p3", "Half done", { usps: [] }), draft("p4", "No price", { priceModel: "FIXED" })]);
    db.product.updateMany.mockResolvedValue({ count: 2 });
    expect(await activateReadyDrafts("b1")).toEqual(["Classic Manicure", "Hair Braiding"]);
    expect(db.product.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", status: "DRAFT", photos: { some: {} } });
    expect(db.product.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["p1", "p2"] }, businessId: "b1", status: "DRAFT" }, data: { status: "ACTIVE" } });
  });

  it("writes nothing when no draft is ready", async () => {
    db.product.findMany.mockResolvedValue([draft("p3", "Half done", { summary: "" })]);
    expect(await activateReadyDrafts("b1")).toEqual([]);
    expect(db.product.updateMany).not.toHaveBeenCalled();
  });
});
