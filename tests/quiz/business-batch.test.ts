import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  knowledgeFaq: { count: vi.fn(), findFirst: vi.fn(), createManyAndReturn: vi.fn() },
  competitor: { count: vi.fn(), findFirst: vi.fn(), createManyAndReturn: vi.fn() },
  product: { count: vi.fn(), createMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }));

import { createCompetitors, createFaqs } from "@/lib/knowledge/records";
import { createProducts } from "@/lib/knowledge/service";
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
    tx.product.createMany.mockResolvedValue({ count: 1 });
    expect(await createProducts("b1", [data])).toBe(1);
    expect(tx.product.createMany.mock.calls[0][0].data[0]).toMatchObject({ businessId: "b1", name: "Passion Juice", priceModel: "ON_REQUEST", status: "DRAFT" });
    tx.product.count.mockResolvedValue(MAX_PRODUCTS_PER_BUSINESS);
    await expect(createProducts("b1", [data])).rejects.toThrow(/limit/);
  });
});
