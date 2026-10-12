import { describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn().mockResolvedValue(1),
  knowledgeFaq: { findMany: vi.fn(), updateMany: vi.fn() },
  persona: { findMany: vi.fn(), updateMany: vi.fn() },
  competitor: { findMany: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }));

import { reorderList } from "@/lib/knowledge/records";

describe("reorderList", () => {
  it("writes the whole order in one UPDATE ... FROM (VALUES ...) scoped to the company", async () => {
    tx.knowledgeFaq.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    await reorderList("faq", "b1", ["c", "a", "b"]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2); // the advisory lock, then the one update
    const [strings, ...values] = tx.$executeRaw.mock.calls[1] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toMatch(/^UPDATE \?.*SET "position" = v.position FROM \(VALUES \?\) AS v\(id, position\) WHERE t."id" = v.id AND t."businessId" = \?$/);
    const params = JSON.stringify(values);
    expect(params).toContain("KnowledgeFaq");
    expect(params.indexOf('"c"')).toBeLessThan(params.indexOf('"a"')); // in the new order
    expect(values.at(-1)).toBe("b1");
    expect(tx.knowledgeFaq.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an order that is not exactly the company's rows", async () => {
    tx.persona.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(reorderList("persona", "b1", ["a"])).rejects.toThrow(/changed in the meantime/);
    await expect(reorderList("persona", "b1", ["a", "x"])).rejects.toThrow(/changed in the meantime/);
    await expect(reorderList("persona", "b1", ["a", "a"])).rejects.toThrow(/changed in the meantime/);
  });
});
