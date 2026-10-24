import { describe, expect, it } from "vitest";
import { DEMO_SPEC } from "@/components/editor/demo-spec";
import { MIN_BLOCK_PX, PX_PER_SECOND, blockWidth, playheadX, shotAt, shotStarts, trimFromDrag } from "@/components/editor/layout";
import { historyReducer } from "@/components/editor/use-spec-history";
import { createHistory, deleteShot, moveShot, setLook, totalSeconds } from "@/lib/editor/ops";
import { SPEC_LIMITS } from "@/lib/video-engine/spec";

describe("the demo spec", () => {
  it("has 3 to 5 shots within the scene limits, a shape sticker and transitions, and no clips", () => {
    expect(DEMO_SPEC.scenes.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_SPEC.scenes.length).toBeLessThanOrEqual(5);
    for (const s of DEMO_SPEC.scenes) expect(s.seconds >= SPEC_LIMITS.minSceneSeconds && s.seconds <= SPEC_LIMITS.maxSceneSeconds).toBe(true);
    expect(DEMO_SPEC.scenes.some((s) => s.layers.some((l) => l.kind === "shape"))).toBe(true);
    expect(DEMO_SPEC.scenes.filter((s) => s.transition).length).toBeGreaterThan(1);
    expect(DEMO_SPEC.scenes.some((s) => s.layers.some((l) => l.kind === "video" || l.kind === "photo"))).toBe(false);
    expect(totalSeconds(DEMO_SPEC)).toBeGreaterThanOrEqual(SPEC_LIMITS.minTotalSeconds);
  });
});

describe("history reducer", () => {
  it("applies, undoes, redoes and resets", () => {
    let h = createHistory(DEMO_SPEC);
    h = historyReducer(h, { type: "apply", op: (s) => setLook(s, "warm") });
    h = historyReducer(h, { type: "apply", op: (s) => moveShot(s, 0, 2) });
    expect(h.present.scenes[2].seconds).toBe(DEMO_SPEC.scenes[0].seconds);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.scenes).toEqual(DEMO_SPEC.scenes);
    expect(h.present.look?.grade).toBe("warm");
    h = historyReducer(h, { type: "redo" });
    expect(h.present.scenes[2].seconds).toBe(DEMO_SPEC.scenes[0].seconds);
    expect(historyReducer(h, { type: "reset", spec: DEMO_SPEC }).past).toEqual([]);
  });
  it("adds no step for an edit that changes nothing", () => {
    const h = createHistory(DEMO_SPEC);
    expect(historyReducer(h, { type: "apply", op: (s) => deleteShot(s, 99) })).toBe(h);
  });
  it("never changes the demo spec", () => {
    const before = JSON.stringify(DEMO_SPEC);
    historyReducer(createHistory(DEMO_SPEC), { type: "apply", op: (s) => deleteShot(s, 0) });
    expect(JSON.stringify(DEMO_SPEC)).toBe(before);
  });
});

describe("timeline layout", () => {
  it("sizes a block by its seconds, with a minimum", () => {
    expect(blockWidth(3)).toBe(3 * PX_PER_SECOND);
    expect(blockWidth(0.5)).toBe(MIN_BLOCK_PX);
  });
  it("finds where shots start and which shot a time is in", () => {
    expect(shotStarts(DEMO_SPEC)).toEqual([0, 3, 6, 9.5]);
    expect(shotAt(DEMO_SPEC, 0)).toBe(0);
    expect(shotAt(DEMO_SPEC, 3)).toBe(1);
    expect(shotAt(DEMO_SPEC, 9.4)).toBe(2);
    expect(shotAt(DEMO_SPEC, 99)).toBe(3);
    expect(shotAt(DEMO_SPEC, -5)).toBe(0);
  });
  it("puts the playhead inside the right block, counting the gaps", () => {
    expect(playheadX(DEMO_SPEC, 0)).toBe(0);
    expect(playheadX(DEMO_SPEC, 1.5)).toBe(Math.round(1.5 * PX_PER_SECOND));
    expect(playheadX(DEMO_SPEC, 3, 6)).toBe(blockWidth(3) + 6);
    expect(playheadX(DEMO_SPEC, 4.5, 6)).toBe(blockWidth(3) + 6 + Math.round(0.5 * blockWidth(3)));
  });
  it("turns a drag of the right edge into a length within the limits", () => {
    expect(trimFromDrag(3, PX_PER_SECOND)).toBe(4);
    expect(trimFromDrag(3, 0)).toBe(3);
    expect(trimFromDrag(3, -9999)).toBe(SPEC_LIMITS.minSceneSeconds);
    expect(trimFromDrag(3, 9999)).toBe(SPEC_LIMITS.maxSceneSeconds);
    expect(trimFromDrag(3, 10)).toBe(3.2);
  });
});
