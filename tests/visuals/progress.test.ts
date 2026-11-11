import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ contentVisual: { findMany: vi.fn() }, imageConcept: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/visuals/service", () => ({ readItems: (v: unknown) => (Array.isArray(v) ? v : []) }));

import { setProgress, setProgressOf } from "@/lib/visuals/progress";
import type { ImagePlan, VisualSlide } from "@/lib/visuals/types";

const NOW = new Date("2026-11-11T10:00:00Z");
const slide = (over: Partial<VisualSlide>): VisualSlide => ({ template: "announcement", headline: "H", subline: "", chip: "", source: "ai", photoPath: null, designId: null, path: null, ...over });
const picturePlan = (slides: VisualSlide[], reel = true): ImagePlan => ({ version: 1, pack: "fresh", aspectRatio: "4:5", slides, directedBy: "ai", notes: [], daySet: { groupId: "g1", maxAi: 3, reel: reel ? { kind: "slideshow", hook: "", cta: "", scenes: [] } : null } });
const videoPlan = { version: 1, scenes: [{ text: "x" }], totalMs: 12_000, colors: {}, music: { title: "Kigali Sunrise" } };

describe("setProgressOf (the loading screen's numbers)", () => {
  it("counts the captions, each picture's steps and the reel; shows the step in words", () => {
    const p = setProgressOf({
      groupId: "g1",
      picture: { status: "pending", error: null, plan: picturePlan([slide({ conceptId: "a" }), slide({ conceptId: "b" }), slide({ source: "album", path: "u/d/3.jpg" })]) },
      concepts: new Map([["a", { status: "painted" }], ["b", { status: "painting" }]]),
      reel: null,
      now: NOW,
    });
    // captions 1 + picture a 2/3 + picture b 1/3 + own photo 1/1 + reel 0/2
    expect(p).toMatchObject({ step: "images", label: "Designing images", done: 5, total: 10, percent: 50, ready: false, failed: false });
    expect(p.images).toEqual([
      { index: 0, status: "working", stage: "checking", path: null },
      { index: 1, status: "working", stage: "painting", path: null },
      { index: 2, status: "ready", stage: null, path: "u/d/3.jpg" },
    ]);
    expect(p.reel).toMatchObject({ status: "waiting", visualId: null });
  });

  it("makes the reel once the pictures are ready, adds the music while it renders, then Ready", () => {
    const picture = { status: "ready", error: null, plan: picturePlan([slide({ path: "u/d/1.png" })]) };
    const pending = setProgressOf({ groupId: "g1", picture, concepts: new Map(), reel: { id: "r1", status: "pending", error: null, items: [], plan: videoPlan, renderingUntil: null }, now: NOW });
    expect(pending).toMatchObject({ step: "reel", label: "Making the reel", done: 5, total: 6, ready: false });
    const rendering = setProgressOf({ groupId: "g1", picture, concepts: new Map(), reel: { id: "r1", status: "pending", error: null, items: [], plan: videoPlan, renderingUntil: new Date(NOW.getTime() + 60_000) }, now: NOW });
    expect(rendering).toMatchObject({ step: "music", label: "Adding music", reel: { status: "rendering", music: "Kigali Sunrise" } });
    const ready = setProgressOf({ groupId: "g1", picture, concepts: new Map(), reel: { id: "r1", status: "ready", error: null, items: [{ path: "u/videos/r1.mp4" }], plan: videoPlan, renderingUntil: null }, now: NOW });
    expect(ready).toMatchObject({ step: "ready", label: "Ready", percent: 100, ready: true, reel: { status: "ready", path: "u/videos/r1.mp4" } });
  });

  it("a day without a reel is ready with its pictures; a set whose pictures failed says so", () => {
    expect(setProgressOf({ groupId: "g1", picture: { status: "ready", error: null, plan: picturePlan([slide({ path: "p.png" })], false) }, concepts: new Map(), reel: null, now: NOW })).toMatchObject({ ready: true, reel: null, percent: 100 });
    expect(setProgressOf({ groupId: "g1", picture: { status: "failed", error: "No picture could be made.", plan: picturePlan([slide({ skipped: true })]) }, concepts: new Map(), reel: null, now: NOW })).toMatchObject({ failed: true, ready: false, step: "ready", error: "No picture could be made." });
    expect(setProgressOf({ groupId: "g1", picture: null, concepts: new Map(), reel: null, now: NOW })).toMatchObject({ step: "captions", label: "Writing captions" });
  });
});

describe("setProgress (read from the database, the business's own sets only)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reads the sets' visuals and their pictures' engine steps", async () => {
    prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", groupId: "g1", kind: "carousel", status: "pending", error: null, plan: picturePlan([slide({ conceptId: "a" })], false), items: [], renderingUntil: null }]);
    prisma.imageConcept.findMany.mockResolvedValue([{ id: "a", status: "fixing" }]);
    const [p] = await setProgress("b1", ["g1", "g1"], NOW);
    expect(prisma.contentVisual.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", groupId: { in: ["g1"] } });
    expect(prisma.imageConcept.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", id: { in: ["a"] } });
    expect(p.images[0]).toMatchObject({ status: "working", stage: "fixing" });
  });
});
