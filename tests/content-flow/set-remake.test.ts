import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class UsageLimitError extends Error {}
  class VisualError extends Error {}
  return {
    prisma: { contentVisual: { findMany: vi.fn(), create: vi.fn() } },
    consumeUsage: vi.fn(),
    removeVisual: vi.fn(async () => undefined),
    startSets: vi.fn(async () => undefined),
    UsageLimitError,
    VisualError,
  };
});
vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/usage", () => ({ consumeUsage: h.consumeUsage, UsageLimitError: h.UsageLimitError }));
vi.mock("@/lib/visuals/service", () => ({ removeVisual: h.removeVisual, VisualError: h.VisualError }));
vi.mock("@/lib/content-flow/set-worker", () => ({ startSets: h.startSets }));

import { remadeSetPlan, remakeDaySetVisuals } from "@/lib/content-flow/set-remake";
import type { ImagePlan, VisualSlide } from "@/lib/visuals/types";

const NOW = new Date("2026-11-11T10:00:00Z");
const owner = { userId: "u1", businessId: "b1" };
const slide = (over: Partial<VisualSlide>): VisualSlide => ({ template: "announcement", headline: "H", subline: "", chip: "", source: "ai", photoPath: "u1/gallery/p.jpg", designId: "d", path: "u1/designs/x.png", ...over });
const plan = (): ImagePlan => ({
  version: 1,
  pack: "fresh",
  aspectRatio: "4:5",
  directedBy: "ai",
  notes: ["AI images for this month used."],
  slides: [
    slide({ headline: "Greens at school", scene: "Pupils holding lettuce", conceptId: "c1", aiPhotoPath: "u1/designs/x.png" }),
    // An AI picture that fell back to the owner's photo when it was drawn.
    slide({ headline: "40 plants", source: "album", note: "The AI picture could not be made" }),
    slide({ headline: "Own photo", source: "album", photoPath: "u1/gallery/q.jpg" }),
  ],
  daySet: { groupId: "group-0001", maxAi: 2, reel: { kind: "slideshow", hook: "Greens at school", cta: "Message us", scenes: [{ onScreen: "Greens at school", voice: "Fresh greens at school." }] }, reelVisualId: "reel-old" },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-11-01") });
  h.prisma.contentVisual.create.mockResolvedValue({ id: "pic-new" });
});

describe("remadeSetPlan (New pictures on the day's set)", () => {
  it("keeps each picture's words, idea and photo; the first maxAi are AI again; nothing drawn; no reel yet", () => {
    const next = remadeSetPlan(plan());
    expect(next.slides.map((s) => s.source)).toEqual(["ai", "ai", "album"]);
    expect(next.slides.map((s) => s.headline)).toEqual(["Greens at school", "40 plants", "Own photo"]);
    expect(next.slides[0]).toMatchObject({ scene: "Pupils holding lettuce", photoPath: "u1/gallery/p.jpg", designId: null, path: null });
    expect(next.slides[0]).not.toHaveProperty("conceptId");
    expect(next.slides[0]).not.toHaveProperty("aiPhotoPath");
    expect(next.slides[1]).not.toHaveProperty("note");
    expect(next.daySet).toEqual({ groupId: "group-0001", maxAi: 2, reel: plan().daySet!.reel });
    expect(next.notes).toEqual([]);
  });
});

describe("remakeDaySetVisuals: by group, never per post", () => {
  const rows = () => [
    { id: "reel-old", kind: "video", plan: {}, createdAt: new Date("2026-11-11T08:05:00Z"), renderingUntil: null },
    { id: "pic-old", kind: "carousel", plan: plan(), createdAt: new Date("2026-11-11T08:00:00Z"), renderingUntil: null },
    // A reel from an even older remake, still on a waiting post: not touched again.
    { id: "reel-older", kind: "video", plan: {}, createdAt: new Date("2026-11-10T08:00:00Z"), renderingUntil: null },
  ];

  it("makes a new picture visual for the group, reserves the AI pictures, lets the old set and its reel go, and draws it on the server", async () => {
    h.prisma.contentVisual.findMany.mockResolvedValue(rows());
    const out = await remakeDaySetVisuals(owner, "group-0001", NOW);
    expect(out).toEqual({ groupId: "group-0001", visualId: "pic-new" });
    expect(h.prisma.contentVisual.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", groupId: "group-0001", contentId: null });
    expect(h.consumeUsage).toHaveBeenCalledWith("u1", "image", 2);
    const data = h.prisma.contentVisual.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ businessId: "b1", groupId: "group-0001", kind: "carousel", status: "pending", items: [] });
    expect(data).not.toHaveProperty("contentId");
    expect(data.plan.slides.filter((s: VisualSlide) => s.prepaidAi).length).toBe(2);
    expect(h.removeVisual.mock.calls.map((c) => (c as unknown[])[1])).toEqual(["pic-old", "reel-old"]);
    expect(h.startSets).toHaveBeenCalledWith("b1", ["group-0001"], NOW);
  });

  it("no credits left: still remade (the pictures fall back to the owner's photos when drawn)", async () => {
    h.prisma.contentVisual.findMany.mockResolvedValue(rows());
    h.consumeUsage.mockRejectedValueOnce(new h.UsageLimitError("limit"));
    await remakeDaySetVisuals(owner, "group-0001", NOW);
    expect(h.prisma.contentVisual.create.mock.calls[0][0].data.plan.slides.some((s: VisualSlide) => s.prepaidAi)).toBe(false);
  });

  it("refuses a set still being drawn, or a group without a day's set", async () => {
    h.prisma.contentVisual.findMany.mockResolvedValue([{ ...rows()[1], renderingUntil: new Date(NOW.getTime() + 30_000) }]);
    await expect(remakeDaySetVisuals(owner, "group-0001", NOW)).rejects.toThrow(/still being drawn/);
    h.prisma.contentVisual.findMany.mockResolvedValue([{ ...rows()[1], plan: { ...plan(), daySet: undefined } }]);
    await expect(remakeDaySetVisuals(owner, "group-0001", NOW)).rejects.toThrow(/could not find/);
    expect(h.prisma.contentVisual.create).not.toHaveBeenCalled();
    expect(h.startSets).not.toHaveBeenCalled();
  });
});
