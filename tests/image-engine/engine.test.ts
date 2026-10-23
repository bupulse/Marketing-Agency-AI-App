import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; batchId: string; businessId: string; status: string; paintingUntil: Date | null; createdAt: Date };
const h = vi.hoisted(() => {
  const rows: Row[] = [];
  let n = 0;
  const match = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR") return (v as Record<string, unknown>[]).some((w) => match(r, w));
      if (v && typeof v === "object" && !(v instanceof Date) && "lt" in (v as object)) return r[k] instanceof Date && (r[k] as Date) < (v as { lt: Date }).lt;
      if (v instanceof Date) return r[k] instanceof Date && (r[k] as Date).getTime() === v.getTime();
      return r[k] === v;
    });
  const prisma = {
    business: { findUnique: vi.fn(async () => ({ id: "b1", userId: "u1", name: "LEAF", industry: "Agriculture", description: "Hydroponic towers", audience: null, tone: null, contentLanguage: "English", country: "Rwanda", knowledge: null, brandColors: ["#1b5e20"], logoUrl: "u1/logo/l.png" })) },
    product: { findFirst: vi.fn(async () => ({ id: "p1", name: "LEAF Hydro Tower", summary: "Grows 30 plants", description: null, priceModel: "FIXED", priceAmount: 250000, currency: "RWF", priceNote: null, usps: ["Saves water"], photos: [{ asset: { path: "u1/gallery/a.jpg", kind: "photo" } }] })) },
    testimonial: { findMany: vi.fn(async () => []) },
    imageConcept: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where))),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) rows.push({ ...d, id: `c${++n}`, status: "planned", paintingUntil: null, createdAt: new Date(2026, 9, 23, 0, 0, n), fixed: false, rating: null, check: null, path: null, designId: null, error: null } as unknown as Row);
        return { count: data.length };
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => match(r, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    },
  };
  return { rows, prisma, consume: vi.fn(), refund: vi.fn(async () => {}), design: vi.fn(), check: vi.fn(), del: vi.fn(async () => true), left: { value: 100 } };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/entitlements", () => ({ featureStatus: async () => "ok" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => {}, RATE_LIMITS: { imageBatch: {} } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/usage", () => ({
  consumeUsage: h.consume,
  refundUsage: h.refund,
  getUsageSummary: async () => ({ limits: { image: h.left.value }, used: { image: 0 } }),
}));
vi.mock("@/lib/designs/service", () => ({ createEngineDesign: h.design, deleteDesign: h.del, DesignError: class DesignError extends Error {} }));
vi.mock("@/lib/image-engine/check", () => ({ checkPicture: h.check }));
vi.mock("@/lib/image-engine/captioner", () => ({ captionBatch: async (_o: unknown, input: { concepts: unknown[] }) => input.concepts.map((_, i) => `Caption ${i}`) }));
vi.mock("@/lib/image-engine/planner", () => ({
  writeConcepts: async (_o: unknown, input: { slots: unknown[] }) => input.slots.map((_, i) => ({ title: `Idea ${i}`, scene: `Scene ${i}`, headline: `Headline ${i}`, subline: "", cta: "Order now", prompt: `Prompt ${i}`, planner: i % 2 ? "gemini" : "claude" })),
}));

import { batchPictures, paintNext, planBatch } from "@/lib/image-engine/engine";

const owner = { userId: "u1", businessId: "b1" };
const period = new Date("2026-10-13T00:00:00Z");

beforeEach(() => {
  h.rows.length = 0;
  h.left.value = 100;
  h.consume.mockReset().mockResolvedValue({ periodStart: period });
  h.refund.mockClear();
  h.del.mockClear();
  let d = 0;
  h.design.mockReset().mockImplementation(async () => ({ id: `d${++d}`, path: `u1/designs/d${d}.png`, mimeType: "image/png", bytes: new Uint8Array([1]) }));
  h.check.mockReset().mockResolvedValue({ ok: true, problems: [], fix: null, ran: true });
});

describe("planning a batch", () => {
  it("reserves exactly the batch's credits and saves one planned picture per slot, Pro first", async () => {
    const res = await planBatch(owner, { source: "designs", subjectId: "p1", brief: "large scale", count: 4, quality: "auto", aspectRatio: "4:5" });
    expect(res).toMatchObject({ count: 4, credits: 7, pro: 1 });
    expect(h.consume).toHaveBeenCalledWith("u1", "image", 7);
    expect(h.rows.map((r) => r.tier)).toEqual(["pro", "lite", "lite", "lite"]);
    expect(h.rows[0]).toMatchObject({ pattern: "at-scale", photoPath: "u1/gallery/a.jpg", credits: 4, caption: "Caption 0", creditPeriod: period });
  });
  it("makes fewer pictures when the credits run short, and refuses with none", async () => {
    h.left.value = 2;
    expect((await planBatch(owner, { source: "designs", count: 4, quality: "auto", aspectRatio: "1:1" })).count).toBe(2);
    h.left.value = 0;
    await expect(planBatch(owner, { source: "designs", count: 4, quality: "auto", aspectRatio: "1:1" })).rejects.toThrow("no AI image credits left");
  });
});

describe("painting a batch", () => {
  it("paints each picture once, as a finished ad with the product photo and the logo", async () => {
    const { batchId } = await planBatch(owner, { source: "designs", subjectId: "p1", count: 4, quality: "auto", aspectRatio: "4:5" });
    while (await paintNext(owner, batchId));
    const pics = await batchPictures("b1", batchId);
    expect(pics.every((p) => p.status === "done" && p.path)).toBe(true);
    expect(h.design).toHaveBeenCalledTimes(4);
    const first = h.design.mock.calls[0][0];
    expect(first).toMatchObject({ model: "gemini-3-pro-image", usePhotoPath: "u1/gallery/a.jpg", useLogo: true, aspectRatio: "4:5" });
    expect(first.prompt).toContain('Headline, large and bold: "Headline 0"');
    expect(h.design.mock.calls[1][0].model).toBe("gemini-2.5-flash-image");
  });
  it("lets the Editor fix a picture that fails the check once, keeping the better one", async () => {
    const { batchId } = await planBatch(owner, { source: "designs", subjectId: "p1", count: 4, quality: "lite", aspectRatio: "4:5" });
    h.check.mockResolvedValueOnce({ ok: false, problems: ["The headline is not written correctly."], fix: 'Write the headline exactly as: "Headline 0". Keep everything else exactly the same.', ran: true });
    await paintNext(owner, batchId);
    expect(h.design).toHaveBeenCalledTimes(2);
    expect(h.design.mock.calls[1][0]).toMatchObject({ editOf: "u1/designs/d1.png" });
    expect(h.del).toHaveBeenCalledWith("u1", "d1");
    expect(h.rows[0]).toMatchObject({ status: "done", path: "u1/designs/d2.png", fixed: true });
  });
  it("gives a failed picture's credits back", async () => {
    const { batchId } = await planBatch(owner, { source: "designs", subjectId: "p1", count: 4, quality: "auto", aspectRatio: "4:5" });
    h.design.mockRejectedValueOnce(new Error("Gemini down"));
    expect(await paintNext(owner, batchId)).toMatchObject({ status: "failed" });
    expect(h.refund).toHaveBeenCalledWith("u1", "image", period, 4);
    expect(h.rows[0]).toMatchObject({ status: "failed", error: "This picture could not be made. Its credits were given back." });
  });
});
