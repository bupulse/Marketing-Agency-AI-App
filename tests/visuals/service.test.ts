import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    contentVisual: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    generatedContent: { findFirst: vi.fn() },
    post: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    connection: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
    design: { deleteMany: vi.fn() },
  },
  logError: vi.fn(),
  hasFeature: vi.fn(),
  featureStatus: vi.fn(),
  consumeUsage: vi.fn(),
  getUsageSummary: vi.fn(),
  spend: vi.fn(),
  createAiDesign: vi.fn(),
  createTemplateDesign: vi.fn(),
  mediaUsage: vi.fn(),
  assertPlatformRoom: vi.fn(),
  signedUpload: vi.fn(),
  storage: { remove: vi.fn(), info: vi.fn(), createSignedUrl: vi.fn() },
  generate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/entitlements", () => ({ hasFeature: mocks.hasFeature, featureStatus: mocks.featureStatus }));
vi.mock("@/lib/usage", () => {
  class UsageLimitError extends Error {
    constructor(public reason: string, public metric: string) {
      super("limit");
    }
  }
  return { consumeUsage: mocks.consumeUsage, getUsageSummary: mocks.getUsageSummary, UsageLimitError };
});
vi.mock("@/lib/ai/budget", async (original) => ({ ...(await original<typeof import("@/lib/ai/budget")>()), companySpendThisMonth: mocks.spend }));
vi.mock("@/lib/ai", () => ({ getCheapTextProvider: () => ({ provider: { name: "gemini", generate: mocks.generate }, model: "gemini-2.5-flash-lite" }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/designs/service", () => {
  class DesignError extends Error {}
  return { createAiDesign: mocks.createAiDesign, createTemplateDesign: mocks.createTemplateDesign, DesignError };
});
vi.mock("@/lib/media/service", () => {
  class MediaError extends Error {}
  return { mediaUsage: mocks.mediaUsage, assertPlatformRoom: mocks.assertPlatformRoom, MediaError };
});
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: mocks.signedUpload }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => mocks.storage } }) }));

import { AIBudgetExceededError } from "@/lib/ai/budget";
import { DesignError } from "@/lib/designs/service";
import { UsageLimitError } from "@/lib/usage";
import { fallbackPlan } from "@/lib/visuals/direction";
import { attachToGroup, drawSlide, finalizeVideo, planVisuals, prepareVideoUpload, renderImageStep, sniffVideo, VisualError, type PlanInput } from "@/lib/visuals/service";
import type { ImagePlan, VisualSlide } from "@/lib/visuals/types";
import { buildVideoPlan } from "@/lib/visuals/video-plan";

const U = "user-1";
const owner = { userId: U, businessId: "biz1" };
const photo = `${U}/gallery/aaaaaaaa-1000.jpg`;

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    owner,
    target: { contentId: "c1" },
    business: { name: "Kigali Kicks", tone: "bold", industry: "Retail", brandColors: ["#FF5500"] },
    subjectType: "product",
    title: "Aero Sneaker",
    price: "RWF 45,000",
    caption: "Meet the Aero Sneaker.",
    headlines: ["The all-new Aero Sneaker"],
    videoScript: "Hook: Light as air.\nCTA: Visit us today!",
    photos: [photo],
    video: false,
    carouselAllowed: true,
    aiAllowed: true,
    ...over,
  };
}

const slide = (over: Partial<VisualSlide> = {}): VisualSlide => ({ template: "new-arrival", headline: "Light", subline: "", chip: "", source: "album", photoPath: photo, designId: null, path: null, ...over });
const plan = (slides: VisualSlide[]): ImagePlan => ({ version: 1, pack: "bold", aspectRatio: "4:5", slides, directedBy: "ai", notes: [] });

let n = 0;
beforeEach(() => {
  vi.clearAllMocks();
  n = 0;
  mocks.prisma.contentVisual.create.mockImplementation(async ({ data }: { data: { kind: string } }) => ({ id: `v-${data.kind}` }));
  mocks.prisma.contentVisual.update.mockResolvedValue({});
  mocks.prisma.contentVisual.findFirst.mockResolvedValue(null);
  mocks.prisma.post.findFirst.mockResolvedValue({ productId: "p1", campaignId: null });
  mocks.prisma.generatedContent.findFirst.mockResolvedValue({ productId: "p1", campaignId: null });
  mocks.prisma.post.count.mockResolvedValue(0);
  mocks.prisma.business.findUnique.mockResolvedValue({ userId: U });
  mocks.createTemplateDesign.mockImplementation(async (a: { photoPath: string | null }) => ({ id: `d${++n}`, path: `${U}/designs/d${n}.png`, photo: a.photoPath }));
  mocks.createAiDesign.mockResolvedValue({ id: "ai1", path: `${U}/designs/ai1.png` });
  mocks.hasFeature.mockResolvedValue(true);
  mocks.featureStatus.mockResolvedValue("ok");
  mocks.getUsageSummary.mockResolvedValue({ used: { image: 0, videoSeconds: 0 }, limits: { image: 50, videoSeconds: 120 } });
  mocks.spend.mockResolvedValue({ totalUsd: 0, widgetUsd: 0, ownerUsd: 0, allowanceUsd: 3, widgetCapUsd: 1.5 });
  mocks.mediaUsage.mockResolvedValue({ count: 0, bytes: 0 });
  mocks.storage.remove.mockResolvedValue({ data: [], error: null });
  mocks.signedUpload.mockImplementation(async (_b: string, path: string) => ({ path, token: "tok" }));
});

describe("planVisuals (the art director with the content)", () => {
  it("saves the art director's validated plan as pending, and a video plan when asked", async () => {
    mocks.generate.mockResolvedValue({ text: JSON.stringify({ format: "single", pack: "warm", slides: [{ headline: "Light as air", subline: "", chip: "", kicker: "", template: "new-arrival", image: "album", photo: 0, scene: "" }] }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    const out = await planVisuals(input({ video: true }));
    expect(out).toEqual({ image: "v-image", video: "v-video" });
    const [image, video] = mocks.prisma.contentVisual.create.mock.calls.map(([a]) => a.data);
    expect(image).toMatchObject({ businessId: "biz1", contentId: "c1", kind: "image", status: "pending" });
    expect(image.plan).toMatchObject({ directedBy: "ai", pack: "warm", slides: [{ headline: "Light as air", source: "album", photoPath: photo }] });
    expect(video).toMatchObject({ kind: "video", status: "pending" });
    expect(video.plan.scenes[0].text).toBe("The all-new Aero Sneaker");
  });

  it("an AI error gives the rules' plan (logged), the budget cap gives it quietly", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("boom"));
    await planVisuals(input());
    expect(mocks.prisma.contentVisual.create.mock.calls[0][0].data.plan.directedBy).toBe("rules");
    expect(mocks.logError).toHaveBeenCalledTimes(1);

    mocks.logError.mockClear();
    mocks.generate.mockRejectedValueOnce(new AIBudgetExceededError("gemini"));
    await planVisuals(input());
    expect(mocks.prisma.contentVisual.create.mock.calls[1][0].data.plan.directedBy).toBe("rules");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("never throws: a database failure is logged and the content has no visual yet", async () => {
    mocks.generate.mockResolvedValue({ text: "{}", provider: "gemini", model: "m", usage: { inputTokens: 0, outputTokens: 0 } });
    mocks.prisma.contentVisual.create.mockRejectedValueOnce(new Error("db down"));
    await expect(planVisuals(input())).resolves.toEqual({ image: null, video: null });
  });
});

describe("drawSlide (image sources and fallbacks)", () => {
  const p = plan([]);

  it("an AI slide pays once for the photo, then draws the template over it", async () => {
    const state = { aiAllowed: true, aiMade: 0, maxAi: 1 };
    const out = await drawSlide(owner, "p1", p, slide({ source: "ai", scene: "runner at dawn" }), state);
    expect(mocks.createAiDesign).toHaveBeenCalledTimes(1);
    expect(mocks.createAiDesign.mock.calls[0][0]).toMatchObject({ aspectRatio: "4:5", usePhotoPath: photo, subjectId: "p1" });
    expect(mocks.createTemplateDesign.mock.calls[0][0]).toMatchObject({ photoPath: `${U}/designs/ai1.png`, pack: "bold" });
    expect(out).toMatchObject({ source: "ai", aiPhotoPath: `${U}/designs/ai1.png`, designId: "d1" });

    // The cap is reached: the next AI slide uses the album photo, with a note.
    const next = await drawSlide(owner, "p1", p, slide({ source: "ai" }), state);
    expect(mocks.createAiDesign).toHaveBeenCalledTimes(1);
    expect(next).toMatchObject({ source: "album", photoPath: photo });
    expect(next.note).toMatch(/not available/);
  });

  it("no image credits: the album photo, and AI is not tried again this time", async () => {
    mocks.createAiDesign.mockRejectedValueOnce(new UsageLimitError("limit_reached", "image"));
    const state = { aiAllowed: true, aiMade: 0, maxAi: 2 };
    const out = await drawSlide(owner, null, p, slide({ source: "ai" }), state);
    expect(out.note).toMatch(/image credits/);
    expect(out.source).toBe("album");
    expect(state.aiAllowed).toBe(false);
  });

  it("no photo and no AI: a free text design (announcement, not a photo template)", async () => {
    const out = await drawSlide(owner, null, p, slide({ source: "ai", photoPath: null }), { aiAllowed: false, aiMade: 0, maxAi: 1 });
    expect(out.source).toBe("text");
    expect(mocks.createTemplateDesign.mock.calls[0][0]).toMatchObject({ template: "announcement", photoPath: null });
  });

  it("a photo the template cannot draw: drawn again as text", async () => {
    mocks.createTemplateDesign.mockRejectedValueOnce(new DesignError("Templates need a JPG or PNG photo."));
    const out = await drawSlide(owner, null, p, slide(), { aiAllowed: false, aiMade: 0, maxAi: 0 });
    expect(mocks.createTemplateDesign).toHaveBeenCalledTimes(2);
    expect(mocks.createTemplateDesign.mock.calls[1][0].photoPath).toBeNull();
    expect(out.note).toMatch(/text design/);
  });
});

describe("renderImageStep", () => {
  it("draws every slide and marks a carousel ready with its items in order", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValueOnce({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "carousel", plan: plan([slide(), slide({ source: "text", photoPath: null, template: "announcement" }), slide({ source: "text", photoPath: null, template: "announcement" })]) });
    const r = await renderImageStep(owner, "v1");
    expect(r.status).toBe("ready");
    const data = mocks.prisma.contentVisual.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "ready", kind: "carousel", error: null });
    expect(data.items.map((i: { designId: string }) => i.designId)).toEqual(["d1", "d2", "d3"]);
  });

  it("stops when its time is used and stays pending (the screen calls again)", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValueOnce({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "image", plan: plan([slide()]) });
    const r = await renderImageStep(owner, "v1", { budgetMs: -1 });
    expect(r.status).toBe("pending");
    expect(mocks.createTemplateDesign).not.toHaveBeenCalled();
  });

  it("another company's visual is not found", async () => {
    await expect(renderImageStep(owner, "theirs")).rejects.toBeInstanceOf(VisualError);
    expect(mocks.prisma.contentVisual.findFirst).toHaveBeenCalledWith({ where: { id: "theirs", businessId: "biz1" } });
  });
});

describe("video upload checks", () => {
  const videoPlan = buildVideoPlan({ script: "One.\nTwo.", hook: "Hook", businessName: "Kigali Kicks", photos: [], pack: "clean" });
  const row = { id: "vid1", businessId: "biz1", contentId: null, groupId: "g1", kind: "video", status: "pending", items: [], plan: videoPlan };
  const file = { bytes: 3_000_000, mimeType: "video/mp4", durationMs: videoPlan.totalMs };

  it("gives a signed upload when the plan, size, length, seconds and quota allow", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    const r = await prepareVideoUpload(owner, "vid1", file);
    expect(r.path).toMatch(new RegExp(`^${U}/videos/vid1-[a-z0-9]+\\.mp4$`));
    expect(r.seconds).toBe(Math.ceil(videoPlan.totalMs / 1000));
  });

  it("refuses without the video feature, too big, too long, no seconds left, or a full gallery", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    mocks.featureStatus.mockResolvedValueOnce("not_in_plan");
    await expect(prepareVideoUpload(owner, "vid1", file)).rejects.toThrow(/not in your plan/);
    await expect(prepareVideoUpload(owner, "vid1", { ...file, bytes: 9 * 1024 * 1024 })).rejects.toThrow(/8 MB/);
    await expect(prepareVideoUpload(owner, "vid1", { ...file, durationMs: 45_000 })).rejects.toThrow(/30 seconds/);
    await expect(prepareVideoUpload(owner, "vid1", { ...file, mimeType: "video/quicktime" })).rejects.toThrow(/MP4 or WebM/);
    mocks.getUsageSummary.mockResolvedValue({ used: { image: 0, videoSeconds: 115 }, limits: { image: 50, videoSeconds: 120 } });
    await expect(prepareVideoUpload(owner, "vid1", file)).rejects.toThrow(/video seconds/);
    mocks.getUsageSummary.mockResolvedValue({ used: { image: 0, videoSeconds: 0 }, limits: { image: 50, videoSeconds: 120 } });
    mocks.mediaUsage.mockResolvedValueOnce({ count: 500, bytes: 0 });
    await expect(prepareVideoUpload(owner, "vid1", file)).rejects.toThrow(/gallery is full/);
    expect(mocks.signedUpload).not.toHaveBeenCalled();
  });

  it("finalize: checks the file's own bytes, counts the seconds, and puts the video on the group's video posts", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    mocks.storage.info.mockResolvedValue({ data: { size: 3_000_000, contentType: "video/mp4" } });
    mocks.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/video" } });
    const head = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(head)));
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ kind: "video", status: "ready", items: [{ path: `${U}/videos/vid1-abcd1.mp4` }] }]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: "ig", network: "instagram", format: "SCRIPT", mediaPaths: [], status: "PENDING_APPROVAL", lastError: null },
      { id: "tt", network: "tiktok", format: "SCRIPT", mediaPaths: [], status: "PENDING_APPROVAL", lastError: null },
      { id: "li", network: "linkedin", format: "POST", mediaPaths: [`${U}/designs/x.png`], status: "PENDING_APPROVAL", lastError: null },
    ]);
    const r = await finalizeVideo(owner, "vid1", { path: `${U}/videos/vid1-abcd1.mp4`, durationMs: videoPlan.totalMs });
    expect(r.seconds).toBe(Math.ceil(videoPlan.totalMs / 1000));
    expect(mocks.consumeUsage).toHaveBeenCalledWith(U, "videoSeconds", r.seconds);
    expect(mocks.prisma.contentVisual.update.mock.calls[0][0].data).toMatchObject({ status: "ready", bytes: 3_000_000, items: [{ path: `${U}/videos/vid1-abcd1.mp4` }] });
    const updates = Object.fromEntries(mocks.prisma.post.updateMany.mock.calls.map(([a]) => [a.where.id, a.data]));
    expect(updates.ig).toMatchObject({ format: "POST", mediaPaths: [`${U}/videos/vid1-abcd1.mp4`] });
    expect(updates.tt).toMatchObject({ format: "SCRIPT", mediaPaths: [`${U}/videos/vid1-abcd1.mp4`] });
    expect(updates.li).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("finalize refuses (and deletes) a file that is not a video, another visual's path, or one over the seconds", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    await expect(finalizeVideo(owner, "vid1", { path: `${U}/videos/other-abcd1.mp4`, durationMs: 1000 })).rejects.toThrow(/could not be used/);
    mocks.storage.info.mockResolvedValue({ data: { size: 1000, contentType: "video/mp4" } });
    mocks.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/video" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))));
    await expect(finalizeVideo(owner, "vid1", { path: `${U}/videos/vid1-abcd1.mp4`, durationMs: 1000 })).rejects.toThrow(/not an MP4/);
    expect(mocks.storage.remove).toHaveBeenCalledWith([`${U}/videos/vid1-abcd1.mp4`]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))));
    mocks.consumeUsage.mockRejectedValueOnce(new UsageLimitError("limit_reached", "videoSeconds"));
    await expect(finalizeVideo(owner, "vid1", { path: `${U}/videos/vid1-abcd1.mp4`, durationMs: 1000 })).rejects.toThrow(/video seconds/);
    expect(mocks.prisma.contentVisual.update).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("sniffs MP4 and WebM", () => {
    expect(sniffVideo(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe("video/mp4");
    expect(sniffVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe("video/webm");
    expect(sniffVideo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });
});

describe("attachToGroup (pictures)", () => {
  it("a redrawn carousel replaces the feed posts' pictures; posts going out are left alone", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ kind: "carousel", status: "ready", items: [{ path: "a.png" }, { path: "b.png" }, { path: "c.png" }] }]);
    mocks.prisma.post.findMany.mockResolvedValue([{ id: "fb", network: "facebook", format: "POST", mediaPaths: ["old.png"], status: "SCHEDULED", lastError: null }]);
    await attachToGroup("biz1", "g1", { feed: true });
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where).toMatchObject({ businessId: "biz1", groupId: "g1", lockedAt: null, status: { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED"] } });
    expect(mocks.prisma.post.updateMany).toHaveBeenCalledWith({ where: { id: "fb", lockedAt: null }, data: { format: "CAROUSEL", mediaPaths: ["a.png", "b.png", "c.png"] } });
  });
});

describe("fallback plan used when nothing else works", () => {
  it("is always drawable", () => {
    const p = fallbackPlan({ subjectType: "event", title: "Open day", caption: "", headlines: [], business: { name: "B" }, photos: [], carouselAllowed: false, aiAllowed: false });
    expect(p.slides[0]).toMatchObject({ headline: "Open day", source: "text" });
  });
});
