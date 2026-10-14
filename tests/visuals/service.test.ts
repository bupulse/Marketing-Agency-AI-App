import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    contentVisual: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
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
  consumeDailyVideo: vi.fn(async () => ({ day: "2026-10-13" })),
  getUsageSummary: vi.fn(),
  spend: vi.fn(),
  createAiDesign: vi.fn(),
  refundUsage: vi.fn(async () => undefined),
  createTemplateDesign: vi.fn(),
  mediaUsage: vi.fn(),
  assertPlatformRoom: vi.fn(),
  signedUpload: vi.fn(),
  storage: { remove: vi.fn(), info: vi.fn(), download: vi.fn() },
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
  return { consumeUsage: mocks.consumeUsage, consumeDailyVideo: mocks.consumeDailyVideo, getUsageSummary: mocks.getUsageSummary, refundUsage: mocks.refundUsage, UsageLimitError };
});
vi.mock("@/lib/ai/budget", async (original) => ({ ...(await original<typeof import("@/lib/ai/budget")>()), companySpendThisMonth: mocks.spend }));
vi.mock("@/lib/ai", () => ({ getCheapTextProvider: () => ({ provider: { name: "gemini", generate: mocks.generate }, model: "gemini-2.5-flash-lite" }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call(), withLateTimeout: <T,>(p: Promise<T>) => p }));
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
import { attachToGroup, drawSlide, finalizeVideo, leaseVideoForBrowser, planVisuals, prepareVideoUpload, readyMedia, countsAsNewVideo, renderImageStep, sniffVideo, updateVideoPlan, VisualError, type PlanInput } from "@/lib/visuals/service";
import type { ImagePlan, VisualSlide } from "@/lib/visuals/types";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { mp4Bytes } from "./video-bytes";

const upload = (bytes: Uint8Array, type = "video/mp4") => {
  mocks.storage.info.mockResolvedValue({ data: { size: bytes.length, contentType: type } });
  mocks.storage.download.mockResolvedValue({ data: new Blob([bytes.slice().buffer]), error: null });
};

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
  mocks.getUsageSummary.mockResolvedValue({ used: { image: 0, videos: 0 }, limits: { image: 50, videos: 120 }, videosToday: 0, videosPerDay: 4 });
  mocks.spend.mockResolvedValue({ totalUsd: 0, widgetUsd: 0, ownerUsd: 0, allowanceUsd: 3, widgetCapUsd: 1.5 });
  mocks.mediaUsage.mockResolvedValue({ count: 0, bytes: 0 });
  mocks.storage.remove.mockResolvedValue({ data: [], error: null });
  mocks.prisma.contentVisual.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.contentVisual.count.mockResolvedValue(0);
  mocks.signedUpload.mockImplementation(async (_b: string, path: string) => ({ path, token: "tok" }));
});

describe("planVisuals (the art director with the content)", () => {
  it("saves the art director's validated plan as pending, and a video plan when asked", async () => {
    mocks.generate.mockResolvedValue({ text: JSON.stringify({ format: "single", pack: "warm", slides: [{ headline: "Light as air", subline: "", chip: "", kicker: "", template: "new-arrival", image: "album", photo: 0, scene: "" }] }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    const out = await planVisuals(input({ video: true }));
    expect(out).toEqual({ image: "v-image", video: "v-video" });
    const [image, video] = mocks.prisma.contentVisual.create.mock.calls.map(([a]) => a.data);
    expect(image).toMatchObject({ businessId: "biz1", contentId: "c1", kind: "image", status: "pending" });
    // AI photos are allowed here, so the cover is a people scene with the album photo as the product reference.
    expect(image.plan).toMatchObject({ directedBy: "ai", pack: "warm", slides: [{ headline: "Light as air", source: "ai", photoPath: photo }] });
    expect(image.plan.people).toMatchObject({ role: expect.any(String), age: expect.any(String) });
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

  it("uses the credit reserved when the run was planned, and gives it back when no AI photo is made", async () => {
    const reserved = "2026-10-01T00:00:00.000Z";
    const state = { aiAllowed: true, aiMade: 0, maxAi: 1 };
    const out = await drawSlide(owner, "p1", p, slide({ source: "ai", prepaidAi: reserved }), state);
    expect(mocks.createAiDesign.mock.calls[0][0]).toMatchObject({ prepaid: { periodStart: new Date(reserved) } });
    expect(out.prepaidAi).toBeNull();
    expect(mocks.refundUsage).not.toHaveBeenCalled();
    // The cap is reached: the reserved credit goes back.
    const next = await drawSlide(owner, "p1", p, slide({ source: "ai", prepaidAi: reserved }), state);
    expect(next.source).toBe("album");
    expect(mocks.refundUsage).toHaveBeenCalledWith(owner.userId, "image", new Date(reserved));
  });

  it("no image credits: the album photo, and AI is not tried again this time", async () => {
    mocks.createAiDesign.mockRejectedValueOnce(new UsageLimitError("limit_reached", "image"));
    const state = { aiAllowed: true, aiMade: 0, maxAi: 2 };
    const out = await drawSlide(owner, null, p, slide({ source: "ai" }), state);
    expect(out.note).toMatch(/AI images for this month used/);
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
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "carousel", plan: plan([slide(), slide({ source: "text", photoPath: null, template: "announcement" }), slide({ source: "text", photoPath: null, template: "announcement" })]) });
    const r = await renderImageStep(owner, "v1");
    expect(r.status).toBe("ready");
    const data = mocks.prisma.contentVisual.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "ready", kind: "carousel", error: null });
    expect(data.items.map((i: { designId: string }) => i.designId)).toEqual(["d1", "d2", "d3"]);
  });

  it("a second call while one is drawing answers 'rendering' and pays for nothing", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "image", plan: plan([slide({ source: "ai" })]) });
    mocks.prisma.contentVisual.updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await renderImageStep(owner, "v1");
    expect(r.status).toBe("rendering");
    expect(mocks.createAiDesign).not.toHaveBeenCalled();
    expect(mocks.createTemplateDesign).not.toHaveBeenCalled();
    const lease = mocks.prisma.contentVisual.updateMany.mock.calls[0][0];
    expect(lease.where).toMatchObject({ id: "v1", businessId: "biz1" });
    expect(lease.data.renderingUntil).toBeInstanceOf(Date);
  });

  it("a paid AI photo is saved before the template is drawn, so a failed draw keeps it and the retry reuses it", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "image", plan: plan([slide({ source: "ai", photoPath: null })]) });
    mocks.createTemplateDesign.mockRejectedValueOnce(new Error("satori crashed"));
    const r = await renderImageStep(owner, "v1");
    expect(r.status).toBe("failed");
    const saves = mocks.prisma.contentVisual.update.mock.calls.map(([a]) => a.data.plan?.slides?.[0]?.aiPhotoPath);
    expect(saves[0]).toBe(`${U}/designs/ai1.png`); // saved right after the photo, before drawing
    expect(saves.at(-1)).toBe(`${U}/designs/ai1.png`);
    // The lease is released.
    expect(mocks.prisma.contentVisual.update.mock.calls.at(-1)![0].data.renderingUntil).toBeNull();

    const kept = mocks.prisma.contentVisual.update.mock.calls.at(-1)![0].data.plan;
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "image", plan: kept });
    const again = await renderImageStep(owner, "v1");
    expect(again.status).toBe("ready");
    expect(mocks.createAiDesign).toHaveBeenCalledTimes(1);
    expect(mocks.createTemplateDesign.mock.calls.at(-1)![0].photoPath).toBe(`${U}/designs/ai1.png`);
  });

  it("stops when its time is used and stays pending (the screen calls again)", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "image", plan: plan([slide()]) });
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
  const PATH = `${U}/videos/vid1-abcd1.mp4`;
  const MB = 1024 * 1024;
  const inAnHour = () => new Date(Date.now() + 3600_000);
  // The same visual before any upload was allowed.
  const freshRow = () => ({ ...row, uploadPath: null, uploadBytes: 0, uploadExpiresAt: null });
  // A visual with the reservation prepareVideoUpload made for PATH.
  const row = { id: "vid1", businessId: "biz1", contentId: null, groupId: "g1", kind: "video", status: "pending", items: [] as { path: string }[], plan: videoPlan, bytes: 0, seconds: 0, uploadPath: PATH, uploadBytes: 8 * MB, uploadExpiresAt: inAnHour() };
  const file = { bytes: 3_000_000, mimeType: "video/mp4", durationMs: videoPlan.totalMs };

  it("gives a signed upload when the plan, size, length, seconds and quota allow", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(freshRow());
    const r = await prepareVideoUpload(owner, "vid1", file);
    expect(r.path).toMatch(new RegExp(`^${U}/videos/vid1-[a-z0-9]+\\.mp4$`));
    expect(r.seconds).toBe(Math.ceil(videoPlan.totalMs / 1000));
  });

  it("reserves the upload at 8 MB until it is confirmed, and caps open uploads per company", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(freshRow());
    await prepareVideoUpload(owner, "vid1", file);
    const data = mocks.prisma.contentVisual.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ uploadBytes: 8 * 1024 * 1024 });
    expect(data.uploadPath).toMatch(/^user-1\/videos\/vid1-/);
    expect(data.uploadExpiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
    expect(mocks.assertPlatformRoom).toHaveBeenCalledWith(8 * 1024 * 1024);
    mocks.prisma.contentVisual.count.mockResolvedValueOnce(3);
    await expect(prepareVideoUpload(owner, "vid1", file)).rejects.toThrow(/being saved/);
    // A company at 2 GB minus 4 MB cannot reserve 8 MB, even for a small announced file.
    mocks.mediaUsage.mockResolvedValueOnce({ count: 0, bytes: 2 * 1024 ** 3 - 4 * 1024 * 1024 });
    await expect(prepareVideoUpload(owner, "vid1", { ...file, bytes: 1000 })).rejects.toThrow(/out of space/);
  });

  it("refuses without the video feature, too big, too long, no videos left (this month or today), or a full gallery", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(freshRow());
    mocks.featureStatus.mockResolvedValueOnce("not_in_plan");
    await expect(prepareVideoUpload(owner, "vid1", file)).rejects.toThrow(/not in your plan/);
    await expect(prepareVideoUpload(owner, "vid1", { ...file, bytes: 9 * 1024 * 1024 })).rejects.toThrow(/8 MB/);
    await expect(prepareVideoUpload(owner, "vid1", { ...file, durationMs: 45_000 })).rejects.toThrow(/30 seconds/);
    await expect(prepareVideoUpload(owner, "vid1", { ...file, mimeType: "video/quicktime" })).rejects.toThrow(/MP4 or WebM/);
    mocks.getUsageSummary.mockResolvedValue({ used: { image: 0, videos: 120 }, limits: { image: 50, videos: 120 }, videosToday: 0, videosPerDay: 4 });
    await expect(prepareVideoUpload(owner, "vid1", file)).rejects.toThrow(/120 videos for this month are used up \(120 of 120\)/);
    mocks.getUsageSummary.mockResolvedValue({ used: { image: 0, videos: 40 }, limits: { image: 50, videos: 120 }, videosToday: 4, videosPerDay: 4 });
    await expect(prepareVideoUpload(owner, "vid1", file)).rejects.toThrow(/^4 videos today, the most a day: more tomorrow\. 40 of 120 this month\.$/);
    mocks.getUsageSummary.mockResolvedValue({ used: { image: 0, videos: 0 }, limits: { image: 50, videos: 120 }, videosToday: 0, videosPerDay: 4 });
    mocks.mediaUsage.mockResolvedValueOnce({ count: 500, bytes: 0 });
    await expect(prepareVideoUpload(owner, "vid1", file)).rejects.toThrow(/gallery is full/);
    expect(mocks.signedUpload).not.toHaveBeenCalled();
  });

  it("finalize: reads the real length from the file, counts one video (month and day), and puts it on the group's video posts", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    upload(mp4Bytes(14_200));
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ kind: "video", status: "ready", items: [{ path: `${U}/videos/vid1-abcd1.mp4` }] }]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: "ig", network: "instagram", format: "SCRIPT", mediaPaths: [], status: "PENDING_APPROVAL", lastError: null },
      { id: "tt", network: "tiktok", format: "SCRIPT", mediaPaths: [], status: "PENDING_APPROVAL", lastError: null },
      { id: "li", network: "linkedin", format: "POST", mediaPaths: [`${U}/designs/x.png`], status: "PENDING_APPROVAL", lastError: null },
    ]);
    // The browser says 2 s; the file says 14.2 s: the video is 15 s long and uses one of the plan's videos.
    const r = await finalizeVideo(owner, "vid1", { path: `${U}/videos/vid1-abcd1.mp4`, durationMs: 2000 });
    expect(r.seconds).toBe(15);
    expect(mocks.consumeUsage).toHaveBeenCalledWith(U, "videos", 1);
    expect(mocks.consumeDailyVideo).toHaveBeenCalledWith(U, 4);
    expect(mocks.prisma.contentVisual.update.mock.calls[0][0].data).toMatchObject({ status: "ready", seconds: 15, items: [{ path: `${U}/videos/vid1-abcd1.mp4` }], uploadPath: null, uploadBytes: 0, uploadExpiresAt: null });
    const updates = Object.fromEntries(mocks.prisma.post.updateMany.mock.calls.map(([a]) => [a.where.id, a.data]));
    expect(updates.ig).toMatchObject({ format: "POST", mediaPaths: [`${U}/videos/vid1-abcd1.mp4`] });
    expect(updates.tt).toMatchObject({ format: "SCRIPT", mediaPaths: [`${U}/videos/vid1-abcd1.mp4`] });
    expect(updates.li).toBeUndefined();
  });

  it("a robot's file is taken only while the robot still holds the video", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    upload(mp4Bytes(10_000));
    mocks.prisma.post.findMany.mockResolvedValue([]);
    // The owner took it over ("Make it now"): refused before billing, file deleted.
    mocks.prisma.contentVisual.findUnique.mockResolvedValueOnce({ robotJobId: null, renderingUntil: inAnHour() });
    await expect(finalizeVideo({ ...owner, service: true }, "vid1", { path: PATH, durationMs: 10_000 }, { robotJob: "job-1" })).rejects.toThrow(/made elsewhere/);
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.storage.remove).toHaveBeenCalledWith([PATH]);
    // Still held: billed once, the attempt count goes back to 0.
    mocks.prisma.contentVisual.findUnique.mockResolvedValueOnce({ robotJobId: "job-1", renderingUntil: inAnHour() });
    await expect(finalizeVideo({ ...owner, service: true }, "vid1", { path: PATH, durationMs: 10_000 }, { robotJob: "job-1" })).resolves.toMatchObject({ seconds: 10 });
    expect(mocks.prisma.contentVisual.update.mock.calls.at(-1)![0].data).toMatchObject({ status: "ready", robotJobId: null, renderingUntil: null, robotAttempts: 0 });
  });

  it("the owner's browser waits for a robot that started under 5 minutes ago, then takes over and cancels its upload", async () => {
    const now = new Date("2026-10-13T10:00:00Z");
    const robotRow = { ...row, robotJobId: "job-1", renderingUntil: new Date(now.getTime() + 12 * 60_000) };
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(robotRow);
    mocks.prisma.contentVisual.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(leaseVideoForBrowser(owner, "vid1", now)).rejects.toThrow(/being made automatically/);
    const where = mocks.prisma.contentVisual.updateMany.mock.calls[0][0].where;
    // Takeover allowed once the robot's lease ends 10 minutes from now or sooner (it started 5 or more minutes ago).
    expect(where.robotJobId).toBe("job-1");
    expect(where.OR).toContainEqual({ renderingUntil: { lte: new Date(now.getTime() + 10 * 60_000) } });
    expect(mocks.storage.remove).not.toHaveBeenCalled();
    // Past 5 minutes: the owner wins; the robot's reserved file goes.
    await leaseVideoForBrowser(owner, "vid1", now);
    const data = mocks.prisma.contentVisual.updateMany.mock.calls[1][0].data;
    expect(data).toMatchObject({ robotJobId: null, uploadPath: null, uploadBytes: 0, uploadExpiresAt: null });
    expect(mocks.storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("finalize is idempotent: the same file again is not billed twice", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ ...row, status: "ready", seconds: 15, items: [{ path: `${U}/videos/vid1-abcd1.mp4` }] });
    const r = await finalizeVideo(owner, "vid1", { path: `${U}/videos/vid1-abcd1.mp4`, durationMs: 15_000 });
    expect(r).toEqual({ path: `${U}/videos/vid1-abcd1.mp4`, seconds: 15 });
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.storage.download).not.toHaveBeenCalled();
  });

  it("finalize re-checks the plan, and refuses (and deletes) other paths, non-videos, videos over 30.5 s, unreadable lengths, or no videos left", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    await expect(finalizeVideo(owner, "vid1", { path: `${U}/videos/other-abcd1.mp4`, durationMs: 1000 })).rejects.toThrow(/could not be used/);
    mocks.featureStatus.mockResolvedValueOnce("not_in_plan");
    await expect(finalizeVideo(owner, "vid1", { path: `${U}/videos/vid1-abcd1.mp4`, durationMs: 1000 })).rejects.toThrow(/not in your plan/);
    const path = PATH;
    upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    await expect(finalizeVideo(owner, "vid1", { path, durationMs: 1000 })).rejects.toThrow(/not an MP4/);
    expect(mocks.storage.remove).toHaveBeenCalledWith([path]);
    expect(mocks.prisma.contentVisual.updateMany).toHaveBeenCalledWith({ where: { id: "vid1", uploadPath: path }, data: { uploadPath: null, uploadBytes: 0, uploadExpiresAt: null } });
    upload(mp4Bytes(31_000));
    await expect(finalizeVideo(owner, "vid1", { path, durationMs: 10_000 })).rejects.toThrow(/30 seconds/);
    upload(mp4Bytes(30_400));
    mocks.consumeUsage.mockResolvedValueOnce({});
    await expect(finalizeVideo(owner, "vid1", { path, durationMs: 10_000 })).resolves.toMatchObject({ seconds: 31 });
    upload(new Uint8Array([0, 0, 0, 0x10, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0, 0, 0, 0, 0]));
    await expect(finalizeVideo(owner, "vid1", { path, durationMs: 10_000 })).rejects.toThrow(/length/);
    upload(mp4Bytes(10_000));
    mocks.consumeUsage.mockRejectedValueOnce(new UsageLimitError("limit_reached", "videos"));
    await expect(finalizeVideo(owner, "vid1", { path, durationMs: 10_000 })).rejects.toThrow(/videos are used up/);
  });

  it("finalize: today's cap reached after the month's count is taken gives the month's video back (nothing is used)", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    mocks.prisma.post.findMany.mockResolvedValue([]);
    upload(mp4Bytes(10_000));
    mocks.consumeUsage.mockResolvedValueOnce({ periodStart: new Date("2026-10-01T00:00:00Z") });
    mocks.consumeDailyVideo.mockRejectedValueOnce(new UsageLimitError("limit_reached", "videos"));
    mocks.getUsageSummary.mockResolvedValue({ used: { image: 0, videos: 9 }, limits: { image: 50, videos: 120 }, videosToday: 4, videosPerDay: 4 });
    await expect(finalizeVideo(owner, "vid1", { path: PATH, durationMs: 10_000 })).rejects.toThrow(/4 videos today, the most a day: more tomorrow/);
    expect(mocks.refundUsage).toHaveBeenCalledWith(U, "videos", new Date("2026-10-01T00:00:00Z"), 1);
    expect(mocks.storage.remove).toHaveBeenCalledWith([PATH]);
    expect(mocks.prisma.contentVisual.update).not.toHaveBeenCalled();
  });

  it("finalize takes only the reserved upload: another file in the folder, or an expired reservation, is refused and deleted", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ ...row, uploadPath: `${U}/videos/vid1-other1.mp4` });
    upload(mp4Bytes(10_000));
    await expect(finalizeVideo(owner, "vid1", { path: PATH, durationMs: 10_000 })).rejects.toThrow(/could not be used/);
    expect(mocks.storage.remove).toHaveBeenCalledWith([PATH]);
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ ...row, uploadExpiresAt: new Date(Date.now() - 1000) });
    await expect(finalizeVideo(owner, "vid1", { path: PATH, durationMs: 10_000 })).rejects.toThrow(/could not be used/);
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
  });

  it("finalize checks the quota again with the real size, not counting the visual's own reservation and old video", async () => {
    const replacing = { ...row, status: "ready", items: [{ path: `${U}/videos/vid1-old01.mp4` }], bytes: 6 * MB };
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(replacing);
    upload(mp4Bytes(10_000));
    // Usage includes the old video (6 MB) and the reservation (8 MB): 2 GB minus 1 MB in all, so the new file fits.
    mocks.mediaUsage.mockResolvedValueOnce({ count: 500, bytes: 2 * 1024 ** 3 - MB });
    await expect(finalizeVideo(owner, "vid1", { path: PATH, durationMs: 10_000 })).resolves.toMatchObject({ seconds: 10 });
    expect(mocks.assertPlatformRoom).toHaveBeenLastCalledWith(0);

    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row);
    mocks.mediaUsage.mockResolvedValueOnce({ count: 501, bytes: 0 }); // full without this visual
    await expect(finalizeVideo(owner, "vid1", { path: PATH, durationMs: 10_000 })).rejects.toThrow(/gallery is full/);
    expect(mocks.storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("replacing a video: the old file and the visual's own reservation are not counted against the new reservation", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ ...row, status: "ready", items: [{ path: `${U}/videos/vid1-old01.mp4` }], bytes: 7 * MB, uploadPath: null, uploadBytes: 0, uploadExpiresAt: null });
    mocks.mediaUsage.mockResolvedValueOnce({ count: 120, bytes: 2 * 1024 ** 3 - 2 * MB }); // includes the old 7 MB video
    await expect(prepareVideoUpload(owner, "vid1", file)).resolves.toMatchObject({ seconds: expect.any(Number) });
    expect(mocks.assertPlatformRoom).toHaveBeenLastCalledWith(1 * MB);
  });

  describe("making an existing video again (remake)", () => {
    const OLD = `${U}/videos/vid1-old01.mp4`;
    // A video already made and counted: making it again (captions, photos, music, voice) uses none of the plan's videos.
    const made = { ...row, status: "pending", items: [{ path: OLD }], seconds: 28 };
    const usedUp = { used: { image: 0, videos: 120 }, limits: { image: 50, videos: 120 }, videosToday: 4, videosPerDay: 4 };

    it("uses no video, even with the month's and today's videos used up, in the browser and for the robot", async () => {
      mocks.getUsageSummary.mockResolvedValue(usedUp);
      mocks.prisma.contentVisual.findFirst.mockResolvedValue({ ...made, uploadPath: null, uploadExpiresAt: null });
      await expect(prepareVideoUpload(owner, "vid1", { ...file, durationMs: 27_500 })).resolves.toMatchObject({ seconds: 28 });
      mocks.prisma.contentVisual.findFirst.mockResolvedValue(made);
      mocks.prisma.contentVisual.findMany.mockResolvedValue([]);
      upload(mp4Bytes(29_000));
      expect((await finalizeVideo(owner, "vid1", { path: PATH, durationMs: 29_000 })).seconds).toBe(29);
      expect(mocks.consumeUsage).not.toHaveBeenCalled();
      expect(mocks.consumeDailyVideo).not.toHaveBeenCalled();
      expect(mocks.prisma.contentVisual.update.mock.calls.at(-1)![0].data).toMatchObject({ status: "ready", seconds: 29, items: [{ path: PATH }] });
      // Its file removed by the 30-day clean-up: making it is a new video.
      expect(countsAsNewVideo({ kind: "video", items: [] })).toBe(true);
      expect(countsAsNewVideo({ kind: "video", items: [{ path: OLD }] })).toBe(false);
    });

    it("changing captions of a made video is never refused on the count, and the video goes on showing", async () => {
      mocks.getUsageSummary.mockResolvedValue(usedUp);
      mocks.prisma.contentVisual.findFirst.mockResolvedValue({ ...made, status: "ready" });
      await updateVideoPlan(owner, "vid1", { texts: ["New caption"] });
      expect(mocks.prisma.contentVisual.update.mock.calls[0][0].data).not.toHaveProperty("items");
    });

    it("a refused remake keeps the current file on the posts", async () => {
      mocks.prisma.contentVisual.findFirst.mockResolvedValue(made);
      upload(mp4Bytes(31_000));
      await expect(finalizeVideo(owner, "vid1", { path: PATH, durationMs: 14_200 })).rejects.toThrow(/30 seconds/);
      expect(mocks.storage.remove).toHaveBeenCalledWith([PATH]);
      expect(mocks.storage.remove).not.toHaveBeenCalledWith([OLD]);
      mocks.prisma.contentVisual.findMany.mockResolvedValue([{ kind: "video", status: "failed", items: [{ path: OLD }], plan: videoPlan }]);
      expect((await readyMedia("biz1", { groupId: "g1" })).video).toBe(OLD);
    });
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
    const updatedAt = new Date("2026-10-12T10:00:00Z");
    mocks.prisma.post.findMany.mockResolvedValue([{ id: "fb", network: "facebook", format: "POST", mediaPaths: ["old.png"], status: "SCHEDULED", lastError: null, updatedAt }]);
    await attachToGroup("biz1", "g1", { feed: true });
    const status = { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED"] };
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where).toMatchObject({ businessId: "biz1", groupId: "g1", lockedAt: null, status });
    expect(mocks.prisma.post.updateMany).toHaveBeenCalledWith({ where: { groupId: "g1", status, id: "fb", lockedAt: null, updatedAt }, data: { format: "CAROUSEL", mediaPaths: ["a.png", "b.png", "c.png"] } });
  });

  it("Studio drafts take a finished picture only while waiting and untouched by the owner", async () => {
    const { attachToContent } = await import("@/lib/visuals/service");
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ kind: "image", status: "ready", items: [{ path: "a.png" }] }]);
    mocks.prisma.post.findMany.mockResolvedValue([]);
    await attachToContent("biz1", "content-1", { feed: true }).catch(() => {});
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where).toEqual({
      businessId: "biz1",
      contentId: "content-1",
      source: "STUDIO",
      status: { in: ["DRAFT", "PENDING_APPROVAL"] },
      ownerEditedAt: null,
      lockedAt: null,
    });
  });
});

describe("fallback plan used when nothing else works", () => {
  it("is always drawable", () => {
    const p = fallbackPlan({ subjectType: "event", title: "Open day", caption: "", headlines: [], business: { name: "B" }, photos: [], carouselAllowed: false, aiAllowed: false });
    expect(p.slides[0]).toMatchObject({ headline: "Open day", source: "text" });
  });
});

describe("changing a picture while it is being drawn", () => {
  it("is refused with a friendly message, and nothing is changed", async () => {
    const { updateImageVisual } = await import("@/lib/visuals/service");
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "image", plan: plan([slide()]), renderingUntil: new Date(Date.now() + 60_000) });
    await expect(updateImageVisual(owner, "v1", { pack: "warm" })).rejects.toThrow(/still being drawn/);
    expect(mocks.prisma.contentVisual.update).not.toHaveBeenCalled();
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "image", plan: plan([slide()]), renderingUntil: new Date(Date.now() - 1000) });
    await expect(updateImageVisual(owner, "v1", { pack: "warm" })).resolves.toMatchObject({ status: "pending" });
  });
});

describe("New design (the owner never picks a template)", () => {
  it("gives every slide a different design of the same style and keeps the paid AI photo", async () => {
    const { updateImageVisual } = await import("@/lib/visuals/service");
    const before = plan([slide({ source: "ai", aiPhotoPath: "u1/designs/ai.png", design: "clean/hero-01" })]);
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "image", plan: before, renderingUntil: null });
    const out = await updateImageVisual(owner, "v1", { redesign: true });
    expect(out.status).toBe("pending");
    expect(out.plan.slides[0].design).not.toBe("clean/hero-01");
    expect(out.plan.slides[0].design?.startsWith(`${before.pack}/`)).toBe(true);
    expect(out.plan.slides[0].aiPhotoPath).toBe("u1/designs/ai.png");
    expect(out.plan.slides[0].designId).toBeNull();
  });
});

describe("people in the pictures (owner decision, 13 October 2026)", () => {
  it("a carousel pays for one AI image: the designed slides are drawn over the cover's people photo", async () => {
    const carousel = plan([
      slide({ source: "ai", photoPath: photo, scene: "a Rwandan woman holding the phone; the product from the reference photo appears exactly as it is" }),
      slide({ source: "text", photoPath: null, template: "announcement", useCoverPhoto: true, headline: "Tip 1" }),
      slide({ source: "text", photoPath: null, template: "announcement", useCoverPhoto: true, headline: "Tip 2" }),
    ]);
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", businessId: "biz1", contentId: "c1", groupId: null, kind: "carousel", plan: carousel });
    const r = await renderImageStep(owner, "v1");
    expect(r.status).toBe("ready");
    expect(mocks.createAiDesign).toHaveBeenCalledTimes(1);
    // The real product photo is the reference, and the people scene is the prompt.
    expect(mocks.createAiDesign.mock.calls[0][0]).toMatchObject({ usePhotoPath: photo, includePeople: true });
    expect(mocks.createAiDesign.mock.calls[0][0].prompt).toMatch(/Rwandan woman holding the phone/);
    expect(mocks.createTemplateDesign.mock.calls.map(([a]) => a.photoPath)).toEqual([`${U}/designs/ai1.png`, `${U}/designs/ai1.png`, `${U}/designs/ai1.png`]);
  });

  it("the dollar allowance running out gives the same message, refilled on the 1st of next month", async () => {
    const { aiPhotosStatus, nextMonthStart } = await import("@/lib/visuals/service");
    mocks.getUsageSummary.mockResolvedValue({ used: { image: 3, videos: 0 }, limits: { image: 30, videos: 0 }, resetsAt: new Date("2026-11-20T00:00:00Z") });
    mocks.spend.mockResolvedValue({ totalUsd: 6, widgetUsd: 0, ownerUsd: 6, allowanceUsd: 6, widgetCapUsd: 3 });
    const status = await aiPhotosStatus(owner);
    expect(status.allowed).toBe(false);
    expect(status.exhausted?.refillAt).toBe(nextMonthStart(new Date()).toISOString());
    expect(nextMonthStart(new Date("2026-12-15T10:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("AI images used up: the plan says when they come back, and the visual is a free design from real photos", async () => {
    const { aiPhotosStatus, aiExhaustedNote } = await import("@/lib/visuals/service");
    mocks.getUsageSummary.mockResolvedValue({ used: { image: 30, videos: 0 }, limits: { image: 30, videos: 0 }, resetsAt: new Date("2026-11-01T00:00:00Z") });
    const status = await aiPhotosStatus(owner);
    expect(status).toEqual({ allowed: false, exhausted: { refillAt: "2026-11-01T00:00:00.000Z" } });
    expect(aiExhaustedNote(status.exhausted!.refillAt)).toBe("AI images for this month used — next refill on 1 November. Your real photos and brand designs are used instead.");

    mocks.generate.mockResolvedValue({ text: JSON.stringify({ format: "single", pack: "clean", slides: [{ headline: "Hi", subline: "", chip: "", kicker: "", template: "new-arrival", image: "ai", photo: 0, scene: "" }] }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    await planVisuals(input({ aiAllowed: false, aiExhausted: status.exhausted! }));
    const saved = mocks.prisma.contentVisual.create.mock.calls[0][0].data.plan;
    expect(saved.slides[0]).toMatchObject({ source: "album", photoPath: photo });
    expect(saved.aiExhausted).toEqual({ refillAt: "2026-11-01T00:00:00.000Z" });
    expect(saved.notes[0]).toMatch(/AI images for this month used — next refill on 1 November/);
  });
});
