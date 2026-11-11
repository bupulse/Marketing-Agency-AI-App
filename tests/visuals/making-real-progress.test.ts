import { describe, expect, it } from "vitest";
import { nextPollIn, POLL_MS, SLOW_POLL_MS, STOP_AFTER_MS } from "@/components/content-flow/use-set-progress";
import { fromSetProgress, realPercent, shownPercent, easedPercent } from "@/components/visuals/making-progress";
import type { SetImageProgress, SetProgress, SetReelProgress } from "@/lib/visuals/progress";

// The loading screens read the server's real progress (daySetProgressAction -> lib/visuals/progress.ts SetProgress).

const img = (status: SetImageProgress["status"], url?: string): SetImageProgress => ({ index: 0, status, stage: status === "working" ? "painting" : null, path: status === "ready" ? "u/d/1.png" : null, ...(url ? { url } : {}) });
const reel = (status: SetReelProgress["status"], music: string | null = "Kigali Sunrise"): SetReelProgress => ({ status, visualId: status === "waiting" ? null : "r1", path: null, music: status === "waiting" ? null : music, error: null });
const set = (over: Partial<SetProgress>): SetProgress => ({ groupId: "g1", step: "images", label: "Designing images", done: 1, total: 1, percent: 0, ready: false, failed: false, error: null, images: [], reel: null, ...over });

describe("fromSetProgress: the server's progress as the loading screen shows it", () => {
  it("no sets: the screen keeps its own estimate", () => {
    expect(fromSetProgress([])).toBeNull();
  });

  it("pictures: the step, the fraction of the pictures' units done, each ready picture with its signed URL, the reel and music ahead", () => {
    // captions 1 + picture a 3/3 + picture b 1/3 + skipped 0 + reel 0/2
    const p = fromSetProgress([set({ done: 5, total: 9, images: [img("ready", "https://signed/a"), img("working"), img("skipped")], reel: reel("waiting") })])!;
    expect(p).toMatchObject({ step: "images", reel: true, music: true });
    expect(p.fraction).toBeCloseTo(4 / 6);
    expect(p.images).toEqual([{ url: "https://signed/a" }, { url: null }]);
    // The real number sits inside the pictures' span (15 to 60).
    expect(realPercent(p)).toBeCloseTo(15 + 45 * (4 / 6));
  });

  it("the reel: planned and waiting for the renderer is half its step; rendering with music is 'Adding music'", () => {
    expect(fromSetProgress([set({ step: "reel", done: 5, total: 6, reel: reel("pending") })])).toMatchObject({ step: "reel", fraction: 0.5 });
    expect(fromSetProgress([set({ step: "music", done: 5, total: 6, reel: reel("rendering") })])).toMatchObject({ step: "music", fraction: null, music: true });
    // A reel with no song (empty library) has no music step.
    expect(fromSetProgress([set({ step: "reel", reel: reel("pending", null) })])).toMatchObject({ music: false });
    // A day without a reel has neither step.
    expect(fromSetProgress([set({ images: [img("working")] })])).toMatchObject({ reel: false, music: false });
  });

  it("several sets: the earliest step still being made; ready only when all are; failed only when all failed", () => {
    const a = set({ groupId: "a", step: "reel", reel: reel("pending") });
    const b = set({ groupId: "b", step: "images", done: 2, total: 4, images: [img("working")] });
    expect(fromSetProgress([a, b])).toMatchObject({ step: "images" });
    const ready = set({ groupId: "a", step: "ready", ready: true, images: [img("ready", "u")] });
    const failed = set({ groupId: "b", step: "ready", failed: true, error: "No picture could be made." });
    expect(fromSetProgress([ready, failed])).toMatchObject({ step: "ready", failed: null });
    expect(fromSetProgress([failed])).toMatchObject({ step: "ready", failed: "No picture could be made." });
  });

  it("the shown number: the eased clock over the real fraction, below 100 until ready, 100 when it is", () => {
    const working = fromSetProgress([set({ done: 2, total: 9, images: [img("working")], reel: reel("waiting") })])!;
    // Early on the clock leads (fast to 60%); the real fraction wins when it is ahead.
    expect(shownPercent(0, easedPercent(3_000), realPercent(working), false)).toBeCloseTo(easedPercent(3_000));
    const late = fromSetProgress([set({ step: "music", reel: reel("rendering") })])!;
    expect(shownPercent(0, easedPercent(1_000), realPercent(late), false)).toBe(realPercent(late));
    expect(shownPercent(0, easedPercent(60 * 60_000), 99.9, false)).toBeLessThan(100);
    const done = fromSetProgress([set({ step: "ready", ready: true })])!;
    expect(shownPercent(50, 50, realPercent(done), done.step === "ready")).toBe(100);
  });
});

describe("polling", () => {
  it("every 2.5 s while a set is made, slower after 5 minutes, stops when all are finished or after 30 minutes", () => {
    expect(nextPollIn(null, 0)).toBe(POLL_MS);
    expect(nextPollIn([{ ready: false, failed: false }], 1_000)).toBe(POLL_MS);
    expect(nextPollIn([{ ready: false, failed: false }], 6 * 60_000)).toBe(SLOW_POLL_MS);
    expect(nextPollIn([{ ready: true, failed: false }, { ready: false, failed: true }], 1_000)).toBeNull();
    expect(nextPollIn([{ ready: false, failed: false }], STOP_AFTER_MS)).toBeNull();
  });
});
