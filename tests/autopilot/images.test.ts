import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPhotoDesign: vi.fn(),
  paintOne: vi.fn(),
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
  createPhotoDesign: mocks.createPhotoDesign,
  DesignError: class DesignError extends Error {},
}));
vi.mock("@/lib/image-engine/engine", () => ({ paintOne: mocks.paintOne, EngineError: class EngineError extends Error {} }));

import { getIdea } from "@/lib/autopilot/playbook";
import { aspectFor, makeGroupImages, type ImageContext } from "@/lib/autopilot/images";
import type { PlannedGroup } from "@/lib/autopilot/planner";
import { EngineError } from "@/lib/image-engine/engine";

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
  mocks.createPhotoDesign.mockImplementation(async (i: { aspectRatio: string }) => ({ id: `d-${i.aspectRatio}`, path: `user1/designs/${i.aspectRatio.replace(":", "x")}.jpg` }));
  mocks.paintOne.mockResolvedValue({ id: "c1", designId: "ai1", path: "user1/designs/ai.png" });
  mocks.designUpdate.mockResolvedValue({});
  mocks.logError.mockResolvedValue(undefined);
});

describe("group images (no templates: the engine's finished ad, else the owner's photo as it is)", () => {
  it("without AI, the gallery photo as it is, one picture per size, with the service key", async () => {
    const out = await makeGroupImages(group("new-arrival", { posts: [{ connectionId: "c", network: "instagram", format: "POST", scheduledAt: new Date() }] }), text, ctx);
    expect(mocks.paintOne).not.toHaveBeenCalled();
    expect(mocks.createPhotoDesign.mock.calls.map(([a]) => a.aspectRatio).sort()).toEqual(["1:1", "4:5"]);
    expect(mocks.createPhotoDesign.mock.calls[0][0]).toMatchObject({ photoPath: "user1/gallery/a.jpg", service: true, userId: "user1", businessId: "biz1" });
    expect(out.designs).toEqual({ "4:5": "user1/designs/4x5.jpg", "1:1": "user1/designs/1x1.jpg" });
    expect(mocks.designUpdate).toHaveBeenCalledWith({ where: { id: "d-4:5" }, data: { prompt: "photo:user1/gallery/a.jpg" } });
  });

  it("no photo and no AI: no picture (never a template)", async () => {
    const out = await makeGroupImages(group("new-arrival", { photos: [], posts: [{ connectionId: "c", network: "instagram", format: "POST", scheduledAt: new Date() }] }), text, ctx);
    expect(out.designs).toEqual({});
  });

  it("with AI on, one finished ad from the engine for every size, guided by the idea and the caption", async () => {
    const out = await makeGroupImages(group("new-arrival", { posts: [{ connectionId: "c", network: "instagram", format: "POST", scheduledAt: new Date() }] }), text, { ...ctx, useAiImages: true }, { caption: "Fresh bread every morning." });
    expect(mocks.paintOne).toHaveBeenCalledTimes(1);
    expect(mocks.paintOne.mock.calls[0][1]).toMatchObject({ source: "autopilot", aspectRatio: "4:5", photoPath: "user1/gallery/a.jpg", caption: "Fresh bread every morning." });
    expect(out).toMatchObject({ aiUsed: true, designs: { "4:5": "user1/designs/ai.png", "1:1": "user1/designs/ai.png" } });
    expect(mocks.createPhotoDesign).not.toHaveBeenCalled();
  });

  it("credits run out: the owner's photo, AI not tried again this run, with a note", async () => {
    mocks.paintOne.mockRejectedValueOnce(new EngineError("You have no AI image credits left this month."));
    const out = await makeGroupImages(group("new-arrival", { posts: [{ connectionId: "c", network: "instagram", format: "POST", scheduledAt: new Date() }] }), text, { ...ctx, useAiImages: true });
    expect(out.aiStopped).toBe(true);
    expect(out.notes[0]).toMatch(/own photos/);
    expect(out.designs["4:5"]).toBe("user1/designs/4x5.jpg");
  });

  it("sizes: Instagram is portrait, the rest square", () => {
    expect(aspectFor("instagram")).toBe("4:5");
    expect(aspectFor("facebook")).toBe("1:1");
  });

  it("an article or a script to film needs no picture", async () => {
    const out = await makeGroupImages(group("li-thought-leadership", { posts: [{ connectionId: "c", network: "linkedin", format: "ARTICLE", scheduledAt: new Date() }] }), text, { ...ctx, useAiImages: true });
    if (!getIdea("li-thought-leadership")!.template) expect(out.designs).toEqual({});
  });
});
