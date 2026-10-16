import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminClient: vi.fn(),
  prisma: {
    business: { findFirst: vi.fn(), findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    design: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  },
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  withLedger: vi.fn(),
  generate: vi.fn(),
  renderTemplate: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  info: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/usage", () => ({ consumeUsage: mocks.consumeUsage, refundUsage: mocks.refundUsage }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, RATE_LIMITS: { templateDesign: { limit: 60, windowSeconds: 3600 }, aiImage: { limit: 10, windowSeconds: 3600 } } }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: mocks.withLedger }));
vi.mock("@/lib/ai/image", () => ({ getImageProvider: () => ({ name: "gemini", generate: mocks.generate }) }));
vi.mock("@/lib/designs/templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/designs/templates/registry")>()),
  renderTemplate: mocks.renderTemplate,
}));
// Server-side writes use the service key (Phase 9, H2): the session's Storage policies are for the browser's uploads.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => {
    mocks.adminClient(...args);
    return { storage: { from: () => ({ upload: mocks.upload, download: mocks.download, remove: mocks.remove, info: mocks.info }) } };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: { from: () => ({ upload: mocks.upload, download: mocks.download, remove: mocks.remove, info: mocks.info }) },
  }),
}));

import { createAiDesign, createAiPhotoDesign, createTemplateDesign, DesignError, deleteDesign } from "@/lib/designs/service";

const USER = "11111111-1111-1111-1111-111111111111";
const owner = { userId: USER, businessId: "biz1" };
const business = { id: "biz1", userId: USER, name: "Sunrise Bakery", industry: "Food", description: null, audience: null, logoUrl: null, brandColors: ["#E4572E"], tone: "luxury", contentLanguage: "French" };
const periodStart = new Date("2026-10-01");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.business.findFirst.mockResolvedValue(business);
  mocks.prisma.design.create.mockResolvedValue({});
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.consumeUsage.mockResolvedValue({ periodStart });
  mocks.renderTemplate.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  // The real ledger wraps the call; here it just runs it, like a successful one.
  mocks.withLedger.mockImplementation(async (_ctx, _meta, call) => call());
  mocks.generate.mockResolvedValue({ data: new Uint8Array([9, 9]), mimeType: "image/png", provider: "gemini", model: "gemini-2.5-flash-image", usage: { inputTokens: 10, outputTokens: 1290 } });
});

describe("template designs", () => {
  it("render, store under the user's designs folder and use no credit", async () => {
    const { id, path } = await createTemplateDesign({ ...owner, template: "offer", aspectRatio: "4:5", headline: "Sale" });
    expect(path).toBe(`${USER}/designs/${id}.png`);
    expect(mocks.upload).toHaveBeenCalledWith(path, expect.any(Uint8Array), expect.objectContaining({ contentType: "image/png" }));
    expect(mocks.adminClient).toHaveBeenCalled();
    expect(mocks.prisma.design.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "TEMPLATE", template: "offer", aspectRatio: "4:5", width: 1080, height: 1350, businessId: "biz1" }),
    });
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.withLedger).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects unknown templates and other people's businesses", async () => {
    await expect(createTemplateDesign({ ...owner, template: "nope", aspectRatio: "1:1", headline: "x" })).rejects.toThrow(DesignError);
    mocks.prisma.business.findFirst.mockResolvedValue(null);
    await expect(createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "x" })).rejects.toThrow(DesignError);
    expect(mocks.prisma.business.findFirst).toHaveBeenLastCalledWith({ where: { id: "biz1", userId: USER } });
  });

  it("only reads photos from the user's own projects folder", async () => {
    for (const photoPath of ["22222222-2222-2222-2222-222222222222/projects/a.jpg", `${USER}/../other/a.jpg`, `/${USER}/a.jpg`, `${USER}/media/a.jpg`]) {
      await expect(createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "x", photoPath })).rejects.toThrow(DesignError);
    }
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("refuses an oversized or unsupported photo without downloading it", async () => {
    const photoPath = `${USER}/projects/a.jpg`;
    mocks.info.mockResolvedValue({ data: { size: 40 * 1024 * 1024, contentType: "image/jpeg" }, error: null });
    await expect(createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "x", photoPath })).rejects.toThrow(/too large/);
    mocks.info.mockResolvedValue({ data: { size: 1000, contentType: "image/webp" }, error: null });
    await expect(createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "x", photoPath })).rejects.toThrow(/JPG or PNG/);
    mocks.info.mockResolvedValue({ data: { size: 1000, contentType: "application/pdf" }, error: null });
    await expect(createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "x", photoPath })).rejects.toThrow(DesignError);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    mocks.rateLimit.mockRejectedValue(new Error("limited"));
    await expect(createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "x" })).rejects.toThrow("limited");
    expect(mocks.rateLimit).toHaveBeenCalledWith(`design:${USER}`, expect.anything());
    expect(mocks.renderTemplate).not.toHaveBeenCalled();
  });

  it("removes the stored file when the row cannot be saved", async () => {
    mocks.prisma.design.create.mockRejectedValue(new Error("db down"));
    await expect(createTemplateDesign({ ...owner, template: "quote", aspectRatio: "1:1", headline: "x" })).rejects.toThrow("db down");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});

describe("AI designs", () => {
  it("consumes one image credit, goes through the ledger as feature image, and stores the result", async () => {
    const { id, path } = await createAiDesign({ ...owner, prompt: "fresh bread on a table", aspectRatio: "1:1" });
    expect(mocks.consumeUsage).toHaveBeenCalledWith(USER, "image");
    expect(mocks.withLedger).toHaveBeenCalledTimes(1);
    const [ctx, meta, , describe_] = mocks.withLedger.mock.calls[0];
    expect(ctx).toEqual({ userId: USER, businessId: "biz1", feature: "image" });
    expect(meta.provider).toBe("gemini");
    expect(describe_(await mocks.generate())).toMatchObject({ images: 1, provider: "gemini" });
    expect(mocks.generate.mock.calls[0][0].prompt).toContain("Sunrise Bakery");
    expect(mocks.generate.mock.calls[0][0].prompt).toContain("Do not put any text");
    expect(path).toBe(`${USER}/designs/${id}.png`);
    expect(mocks.prisma.design.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "AI", prompt: "fresh bread on a table" }) });
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("refunds the credit when the AI call fails", async () => {
    mocks.withLedger.mockRejectedValue(new Error("provider down"));
    await expect(createAiDesign({ ...owner, prompt: "fresh bread", aspectRatio: "1:1" })).rejects.toThrow("provider down");
    expect(mocks.refundUsage).toHaveBeenCalledWith(USER, "image", periodStart);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("keeps the original error when the refund itself fails", async () => {
    mocks.withLedger.mockRejectedValue(new Error("provider down"));
    mocks.refundUsage.mockRejectedValue(new Error("db down"));
    await expect(createAiDesign({ ...owner, prompt: "fresh bread", aspectRatio: "1:1" })).rejects.toThrow("provider down");
  });

  it("refunds when storing the image fails", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "quota" } });
    await expect(createAiDesign({ ...owner, prompt: "fresh bread", aspectRatio: "1:1" })).rejects.toThrow();
    expect(mocks.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("does not call the AI when the plan has no credits left", async () => {
    mocks.consumeUsage.mockRejectedValue(new Error("limit"));
    await expect(createAiDesign({ ...owner, prompt: "fresh bread", aspectRatio: "1:1" })).rejects.toThrow("limit");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("rejects a photo outside the user's folder before using a credit", async () => {
    await expect(createAiDesign({ ...owner, prompt: "fresh bread", aspectRatio: "1:1", usePhotoPath: "someone-else/a.jpg" })).rejects.toThrow(DesignError);
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
  });
});

describe("template style packs", () => {
  it("uses the requested pack, else the one matching the business voice, and the content language", async () => {
    await createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "Sale", pack: "bold" });
    expect(mocks.renderTemplate.mock.calls[0][1]).toMatchObject({ pack: "bold", language: "French" });
    await createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "Sale" });
    expect(mocks.renderTemplate.mock.calls[1][1]).toMatchObject({ pack: "elegant" });
    await createTemplateDesign({ ...owner, template: "offer", aspectRatio: "1:1", headline: "Sale", pack: "nope" });
    expect(mocks.renderTemplate.mock.calls[2][1]).toMatchObject({ pack: "elegant" });
  });
});

describe("AI photo designs", () => {
  const photo = { ...owner, template: "new-arrival", pack: "warm", aspectRatio: "4:5" as const, headline: "Fresh sourdough", chip: "From $8" };
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]);

  it("consumes one image credit, asks for a scene without text, lays the template over it and stores an AI design", async () => {
    mocks.generate.mockResolvedValue({ data: PNG, mimeType: "image/png", provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1290 } });
    const { id, path } = await createAiPhotoDesign({ ...photo, scene: 'Loaves with the headline "Fresh" in text' });
    expect(mocks.consumeUsage).toHaveBeenCalledWith(USER, "image");
    expect(mocks.withLedger.mock.calls[0][0]).toEqual({ userId: USER, businessId: "biz1", feature: "image" });
    const prompt = mocks.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Do not put any text");
    expect(prompt).toContain("calm");
    expect(mocks.renderTemplate).toHaveBeenCalledWith("new-arrival", expect.objectContaining({ pack: "warm", headline: "Fresh sourdough", chip: "From $8", photoDataUrl: expect.stringMatching(/^data:image\/png;base64,/) }), "4:5");
    expect(path).toBe(`${USER}/designs/${id}.png`);
    expect(mocks.prisma.design.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "AI", template: "new-arrival", aspectRatio: "4:5", width: 1080, height: 1350 }) });
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("refunds when the provider fails or the layout cannot be drawn at all", async () => {
    mocks.withLedger.mockRejectedValue(new Error("provider down"));
    await expect(createAiPhotoDesign(photo)).rejects.toThrow("provider down");
    expect(mocks.refundUsage).toHaveBeenCalledTimes(1);

    mocks.withLedger.mockImplementation(async (_c, _m, call) => call());
    mocks.generate.mockResolvedValue({ data: PNG, mimeType: "image/png", provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    mocks.renderTemplate.mockRejectedValue(new Error("satori"));
    await expect(createAiPhotoDesign(photo)).rejects.toThrow(/credit was returned/);
    expect(mocks.refundUsage).toHaveBeenCalledTimes(2);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("keeps the paid design, drawn without the photo, when the photo is WebP or cannot be decoded", async () => {
    mocks.generate.mockResolvedValue({ data: PNG, mimeType: "image/webp", provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    await createAiPhotoDesign(photo);
    expect(mocks.renderTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.renderTemplate.mock.calls[0][1].photoDataUrl).toBeNull();
    expect(mocks.refundUsage).not.toHaveBeenCalled();

    mocks.renderTemplate.mockReset();
    mocks.renderTemplate.mockRejectedValueOnce(new Error("bad png")).mockResolvedValue(new Uint8Array([1]).buffer);
    mocks.generate.mockResolvedValue({ data: PNG, mimeType: "image/png", provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    await createAiPhotoDesign(photo);
    expect(mocks.renderTemplate.mock.calls[1][1].photoDataUrl).toBeNull();
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("uses the tighter AI rate limit, not the template one", async () => {
    await createAiPhotoDesign(photo);
    await createAiDesign({ ...owner, prompt: "fresh bread", aspectRatio: "1:1" });
    expect(mocks.rateLimit).toHaveBeenCalledWith(`aiimage:${USER}`, { limit: 10, windowSeconds: 3600 });
    expect(mocks.rateLimit).not.toHaveBeenCalledWith(`design:${USER}`, expect.anything());
  });

  it("does not call the AI without credits, for quotes, or for a photo outside the user's folder", async () => {
    mocks.consumeUsage.mockRejectedValue(new Error("limit"));
    await expect(createAiPhotoDesign(photo)).rejects.toThrow("limit");
    expect(mocks.generate).not.toHaveBeenCalled();
    await expect(createAiPhotoDesign({ ...photo, template: "quote" })).rejects.toThrow(DesignError);
    await expect(createAiPhotoDesign({ ...photo, usePhotoPath: "someone-else/a.jpg" })).rejects.toThrow(DesignError);
    expect(mocks.consumeUsage).toHaveBeenCalledTimes(1);
  });
});

describe("deleteDesign", () => {
  it("only deletes the user's own designs", async () => {
    mocks.prisma.design.findFirst.mockResolvedValue(null);
    expect(await deleteDesign(USER, "d1")).toBe(false);
    expect(mocks.prisma.design.findFirst).toHaveBeenCalledWith({ where: { id: "d1", business: { userId: USER } } });
    expect(mocks.prisma.design.delete).not.toHaveBeenCalled();

    mocks.prisma.design.findFirst.mockResolvedValue({ id: "d1", path: `${USER}/designs/d1.png` });
    expect(await deleteDesign(USER, "d1")).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith([`${USER}/designs/d1.png`]);
    expect(mocks.prisma.design.delete).toHaveBeenCalledWith({ where: { id: "d1" } });
  });
});
