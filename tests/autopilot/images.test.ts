import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTemplateDesign: vi.fn(),
  createAiPhotoDesign: vi.fn(),
  designUpdate: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { design: { update: mocks.designUpdate } } }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/rate-limit", () => ({
  RateLimitError: class RateLimitError extends Error {
    constructor(public retryAfterSeconds: number) {
      super("Too many requests");
    }
  },
}));
vi.mock("@/lib/usage", () => ({
  UsageLimitError: class UsageLimitError extends Error {
    constructor(public reason: string, public metric: string) {
      super("limit");
    }
  },
}));
vi.mock("@/lib/designs/service", () => ({
  createTemplateDesign: mocks.createTemplateDesign,
  createAiPhotoDesign: mocks.createAiPhotoDesign,
  DesignError: class DesignError extends Error {},
}));

import { getIdea } from "@/lib/autopilot/playbook";
import { aspectFor, makeGroupImages, type ImageContext } from "@/lib/autopilot/images";
import type { PlannedGroup } from "@/lib/autopilot/planner";
import { DesignError } from "@/lib/designs/service";
import { UsageLimitError } from "@/lib/usage";

const ctx: ImageContext = { userId: "user1", businessId: "biz1", businessName: "Sunrise Bakery", language: "English", useAiImages: false, service: true };
const text = { kicker: "New", headline: "Fresh bread", subline: "Every morning", chip: "From 500" };

const group = (idea: string, over: Partial<PlannedGroup> = {}): PlannedGroup => ({
  groupId: "g1",
  idea: getIdea(idea)!,
  day: "2026-10-13",
  photos: [{ path: "user1/gallery/a.jpg", fromProject: false, mimeType: "image/jpeg" }],
  networks: ["instagram", "linkedin"],
  posts: [],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createTemplateDesign.mockImplementation(async (i: { aspectRatio: string }) => ({ id: `d-${i.aspectRatio}`, path: `user1/designs/${i.aspectRatio.replace(":", "x")}.png` }));
  mocks.createAiPhotoDesign.mockResolvedValue({ id: "ai1", path: "user1/designs/ai.png" });
  mocks.designUpdate.mockResolvedValue({});
  mocks.logError.mockResolvedValue(undefined);
});

describe("group images", () => {
  it("puts the gallery photo in a free template, one design per size, with the service key", async () => {
    const result = await makeGroupImages(group("tip-how-to"), text, ctx);
    expect(mocks.createAiPhotoDesign).not.toHaveBeenCalled();
    expect(mocks.createTemplateDesign).toHaveBeenCalledTimes(2);
    expect(mocks.createTemplateDesign).toHaveBeenCalledWith(expect.objectContaining({ userId: "user1", businessId: "biz1", service: true, template: "announcement", photoPath: "user1/gallery/a.jpg", aspectRatio: "4:5", headline: "Fresh bread", kicker: "New" }));
    expect(result.designs).toEqual({ "4:5": "user1/designs/4x5.png", "1:1": "user1/designs/1x1.png" });
    // The photo is remembered so the next plans prefer others.
    expect(mocks.designUpdate).toHaveBeenCalledWith({ where: { id: "d-4:5" }, data: { prompt: "photo:user1/gallery/a.jpg" } });
  });

  it("uses a text-only layout when there is no photo for a photo template", async () => {
    await makeGroupImages(group("new-arrival", { photos: [] }), text, ctx);
    expect(mocks.createTemplateDesign).toHaveBeenCalledWith(expect.objectContaining({ template: "announcement", photoPath: null }));
  });

  it("draws without the photo when the photo cannot be used", async () => {
    mocks.createTemplateDesign.mockImplementationOnce(async () => {
      throw new DesignError("Templates need a JPG or PNG photo.");
    });
    const result = await makeGroupImages(group("tip-how-to", { networks: ["instagram"] }), text, ctx);
    expect(mocks.createTemplateDesign).toHaveBeenCalledTimes(2);
    expect(mocks.createTemplateDesign.mock.calls[1][0].photoPath).toBeNull();
    expect(result.designs["4:5"]).toBeDefined();
  });

  it("makes no image for posts without one (scripts, articles) or for video-only networks", async () => {
    expect((await makeGroupImages(group("reel-quick-tip", { photos: [], networks: ["tiktok", "youtube"] }), text, ctx)).designs).toEqual({});
    expect((await makeGroupImages(group("li-thought-leadership", { photos: [], networks: ["linkedin"] }), text, ctx)).designs).toEqual({});
    expect(mocks.createTemplateDesign).not.toHaveBeenCalled();
  });

  it("gives a feed post of an idea without a template of its own the announcement design", async () => {
    const at = new Date("2026-10-13T07:00:00Z");
    const made = await makeGroupImages(group("li-company-story", { networks: ["linkedin"], posts: [{ connectionId: "c-li", network: "linkedin", format: "POST", scheduledAt: at }] }), text, ctx);
    expect(made.designs).toEqual({ "1:1": "user1/designs/1x1.png" });
    expect(mocks.createTemplateDesign).toHaveBeenCalledWith(expect.objectContaining({ template: "announcement", photoPath: "user1/gallery/a.jpg", aspectRatio: "1:1" }));
  });

  it("falls back to the business name for scripts the image font cannot draw", async () => {
    await makeGroupImages(group("tip-how-to"), text, { ...ctx, language: "Hindi" });
    expect(mocks.createTemplateDesign).toHaveBeenCalledWith(expect.objectContaining({ headline: "Sunrise Bakery", subline: null, chip: null, kicker: "" }));
  });

  it("always has a headline, even when the writer's was dropped", async () => {
    await makeGroupImages(group("tip-how-to"), { ...text, headline: "" }, ctx);
    expect(mocks.createTemplateDesign.mock.calls[0][0].headline).toBe("Sunrise Bakery");
  });

  it("with AI images on, makes one AI photo design (1 image credit) for every size", async () => {
    const result = await makeGroupImages(group("tip-how-to"), text, { ...ctx, useAiImages: true });
    expect(mocks.createAiPhotoDesign).toHaveBeenCalledTimes(1);
    expect(mocks.createAiPhotoDesign).toHaveBeenCalledWith(expect.objectContaining({ service: true, aspectRatio: "4:5", usePhotoPath: "user1/gallery/a.jpg" }));
    expect(mocks.createTemplateDesign).not.toHaveBeenCalled();
    expect(result).toMatchObject({ aiUsed: true, designs: { "4:5": "user1/designs/ai.png", "1:1": "user1/designs/ai.png" } });
  });

  it("skips gracefully to free templates when image credits run out, and stops trying AI", async () => {
    mocks.createAiPhotoDesign.mockRejectedValue(new UsageLimitError("limit_reached", "image"));
    const result = await makeGroupImages(group("tip-how-to"), text, { ...ctx, useAiImages: true });
    expect(result.aiStopped).toBe(true);
    expect(result.aiUsed).toBe(false);
    expect(result.notes[0]).toMatch(/ran out of image credits/);
    expect(mocks.createTemplateDesign).toHaveBeenCalled();
    const next = await makeGroupImages(group("poll-question"), text, { ...ctx, useAiImages: true }, { aiStopped: true });
    expect(mocks.createAiPhotoDesign).toHaveBeenCalledTimes(1);
    expect(next.designs["4:5"]).toBeDefined();
  });

  it("never throws: an unexpected failure leaves the group without an image", async () => {
    mocks.createTemplateDesign.mockRejectedValue(new Error("render exploded"));
    const result = await makeGroupImages(group("tip-how-to"), text, ctx);
    expect(result.designs).toEqual({});
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("sizes: Instagram portrait, everything else square", () => {
    expect(aspectFor("instagram")).toBe("4:5");
    expect(aspectFor("facebook")).toBe("1:1");
    expect(aspectFor("linkedin")).toBe("1:1");
  });
});
