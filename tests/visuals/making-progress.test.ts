import { describe, expect, it } from "vitest";
import { easedPercent, progressFromVisuals, realPercent, shownPercent, stepsFor } from "@/components/visuals/making-progress";
import type { VisualView } from "@/lib/visuals/types";

// The loading screen's number (owner, 11 November 2026): fast to about 60%, then slower, never 100 before ready.

const visual = (over: Partial<VisualView>): VisualView => ({ id: "v", kind: "image", status: "pending", items: [], imagePlan: null, videoPlan: null, error: null, renderedAt: null, ...over }) as VisualView;

describe("loading screen percentage", () => {
  it("climbs fast to 60% in about 6 seconds, then slows, and never reaches 100", () => {
    expect(easedPercent(0)).toBe(1);
    expect(easedPercent(3_000)).toBeGreaterThan(45);
    expect(easedPercent(6_000)).toBeCloseTo(60, 5);
    const later = easedPercent(30_000);
    expect(later).toBeGreaterThan(60);
    expect(later - 60).toBeLessThan(60 - 1);
    expect(easedPercent(10 * 60_000)).toBeLessThan(97);
    // Slower after 60%: the next 6 seconds add much less than the first 6.
    expect(easedPercent(12_000) - easedPercent(6_000)).toBeLessThan(15);
  });

  it("shows the larger of clock and real progress, never goes back, and jumps to 100 only when done", () => {
    expect(shownPercent(0, 30, 50, false)).toBe(50);
    expect(shownPercent(70, 30, 50, false)).toBe(70);
    expect(shownPercent(98, 99.5, 99.9, false)).toBe(99);
    expect(shownPercent(40, 41, 0, true)).toBe(100);
    expect(realPercent({ step: "images", fraction: 0.5 })).toBeCloseTo(37.5);
    expect(realPercent({ step: "ready" })).toBe(100);
  });

  it("leaves out the reel and music steps for an images-only set", () => {
    expect(stepsFor({ reel: false })).toEqual(["captions", "images", "ready"]);
    expect(stepsFor({ reel: true, music: false })).toEqual(["captions", "images", "reel", "ready"]);
    expect(stepsFor({ reel: true, music: true })).toEqual(["captions", "images", "reel", "music", "ready"]);
  });
});

describe("progress estimated from the visuals", () => {
  it("captions first, then images (by slides ready), then the reel, then music near the end of a render", () => {
    expect(progressFromVisuals({ writing: true, images: [], videos: [] }).step).toBe("captions");
    const image = visual({ imagePlan: { slides: [{}, {}, {}, {}] } as never });
    const video = visual({ id: "w", kind: "video", videoPlan: { music: { trackId: "t" } } as never });
    const drawing = progressFromVisuals({ images: [image], videos: [video], drawing: { drawn: 1, total: 4 } });
    expect(drawing.step).toBe("images");
    expect(drawing.fraction).toBe(0.25);
    expect(drawing.images).toHaveLength(4);
    const ready = visual({ status: "ready", items: [{ path: "p", url: "https://x/1.png", designId: null }] });
    expect(progressFromVisuals({ images: [ready], videos: [video] })).toMatchObject({ step: "reel", fraction: null, reel: true, music: true });
    expect(progressFromVisuals({ images: [ready], videos: [video], render: 0.9 }).step).toBe("music");
    expect(progressFromVisuals({ images: [ready], videos: [{ ...video, status: "ready" }] }).step).toBe("ready");
  });

  it("says why when making failed and nothing is still being made", () => {
    const failed = visual({ status: "failed", error: "The picture could not be drawn." });
    expect(progressFromVisuals({ images: [failed], videos: [] }).failed).toBe("The picture could not be drawn.");
  });
});
