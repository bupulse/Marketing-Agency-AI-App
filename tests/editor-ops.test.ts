import { describe, expect, it } from "vitest";
import { HISTORY_STEPS, addSticker, apply, createHistory, deleteShot, moveShot, redo, removeSticker, setCaptionText, setLook, setTransition, setZoom, snapCutsToBeats, splitShot, textSticker, totalSeconds, trimShot, undo } from "@/lib/editor/ops";
import type { Layer, MotionSpec, Scene, Transition } from "@/lib/video-engine/spec";

const clip = (url: string, start: number, over: Partial<Layer> = {}): Layer => ({ kind: "video", url, fit: "cover", start, sound: true, x: 0.5, y: 0.5, w: 1, h: 1, keyframes: [{ at: 0, scale: 1 }, { at: 1, scale: 1.06 }], ...over }) as Layer;
const words = (text: string): Layer => ({ kind: "text", text, font: "inter", size: 0.07, color: "#fff", x: 0.5, y: 0.7, w: 0.8, h: 0.1, box: { color: "#000" } });
const scene = (seconds: number, layers: Layer[], transition?: Transition): Scene => ({ seconds, background: { kind: "solid", colors: ["#000"] }, layers, ...(transition ? { transition } : {}) });

const base = (): MotionSpec => ({
  version: 1,
  title: "Test",
  ratio: "9:16",
  fps: 30,
  palette: { background: "#000", primary: "#f00", accent: "#f00", text: "#fff" },
  scenes: [scene(4, [clip("a.mp4", 0), words("one")]), scene(3, [clip("a.mp4", 4)], "flash"), scene(5, [clip("b.mp4", 1), words("three")], "whip")],
  music: null,
  caption: "",
  hashtags: [],
});

/** Freezes the whole spec, so any change to the input throws. */
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
const frozen = () => freeze(base());

describe("totalSeconds", () => {
  it("adds the shots", () => expect(totalSeconds(base())).toBe(12));
});

describe("trimShot", () => {
  it("sets the clip start and the length without changing the input", () => {
    const s = frozen();
    const out = trimShot(s, 0, { start: 1.5, seconds: 2.5 });
    expect(out.scenes[0].seconds).toBe(2.5);
    expect(out.scenes[0].layers[0]).toMatchObject({ kind: "video", start: 1.5 });
    expect(out.scenes[1]).toBe(s.scenes[1]);
    expect(s.scenes[0].seconds).toBe(4);
  });
  it("keeps the length within the scene limits", () => {
    expect(trimShot(base(), 0, { seconds: 0.2 }).scenes[0].seconds).toBe(1.2);
    expect(trimShot(base(), 0, { seconds: 99 }).scenes[0].seconds).toBe(8);
  });
  it("never runs past the end of the clip", () => {
    const out = trimShot(base(), 0, { start: 5, seconds: 4 }, { clipSeconds: 8 });
    expect(out.scenes[0].layers[0]).toMatchObject({ start: 5 });
    expect(out.scenes[0].seconds).toBe(3);
    expect(trimShot(base(), 0, { start: 50 }, { clipSeconds: 8 }).scenes[0].layers[0]).toMatchObject({ start: 6.8 });
    expect(trimShot(base(), 0, { start: -3 }).scenes[0].layers[0]).toMatchObject({ start: 0 });
  });
  it("returns the same spec for a bad index, a bad number or no change", () => {
    const s = base();
    expect(trimShot(s, 9, { seconds: 3 })).toBe(s);
    expect(trimShot(s, -1, { seconds: 3 })).toBe(s);
    expect(trimShot(s, 0, { seconds: Number.NaN })).toBe(s);
    expect(trimShot(s, 0, { seconds: 4 })).toBe(s);
  });
});

describe("splitShot", () => {
  it("makes two scenes with the right starts and a cut between", () => {
    const s = frozen();
    const out = splitShot(s, 1, 1.5);
    expect(out.scenes).toHaveLength(4);
    expect(out.scenes[1].seconds).toBe(1.5);
    expect(out.scenes[2].seconds).toBe(1.5);
    expect(out.scenes[1].layers[0]).toMatchObject({ start: 4 });
    expect(out.scenes[2].layers[0]).toMatchObject({ start: 5.5 });
    expect(out.scenes[1].transition).toBe("flash");
    expect(out.scenes[2].transition).toBe("cut");
    expect(totalSeconds(out)).toBe(totalSeconds(s));
  });
  it("re-fits a layer that runs across the split", () => {
    const s = base();
    s.scenes[0].layers[1] = { ...words("late"), from: 0.5, to: 1 };
    const out = splitShot(s, 0, 2);
    expect(out.scenes[0].layers).toHaveLength(1);
    expect(out.scenes[1].layers.find((l) => l.kind === "text")).toMatchObject({ text: "late" });
    const early = splitShot(s, 0, 1.5);
    expect(early.scenes[0].layers.find((l) => l.kind === "text")).toBeUndefined();
    expect(early.scenes[1].layers.find((l) => l.kind === "text")).toMatchObject({ from: 0.2 });
  });
  it("refuses a part shorter than the minimum, a bad index and a bad time", () => {
    const s = base();
    expect(splitShot(s, 0, 0.5)).toBe(s);
    expect(splitShot(s, 0, 3.5)).toBe(s);
    expect(splitShot(s, 5, 2)).toBe(s);
    expect(splitShot(s, 0, Number.NaN)).toBe(s);
  });
  it("is not limited to 8 scenes", () => {
    const s = { ...base(), scenes: Array.from({ length: 10 }, () => scene(3, [clip("a.mp4", 0)])) };
    expect(splitShot(s, 0, 1.5).scenes).toHaveLength(11);
    expect(trimShot(s, 9, { seconds: 2 }).scenes).toHaveLength(10);
  });
});

describe("deleteShot and moveShot", () => {
  it("deletes one shot, keeps the last one", () => {
    const s = frozen();
    expect(deleteShot(s, 1).scenes.map((x) => x.seconds)).toEqual([4, 5]);
    expect(deleteShot(s, 7)).toBe(s);
    const one = { ...base(), scenes: [base().scenes[0]] };
    expect(deleteShot(one, 0)).toBe(one);
  });
  it("moves a shot to a position", () => {
    const s = frozen();
    expect(moveShot(s, 0, 2).scenes.map((x) => x.seconds)).toEqual([3, 5, 4]);
    expect(moveShot(s, 2, 0).scenes.map((x) => x.seconds)).toEqual([5, 4, 3]);
    expect(moveShot(s, 1, 1)).toBe(s);
    expect(moveShot(s, 0, 3)).toBe(s);
  });
});

describe("setTransition", () => {
  it("accepts only known transitions", () => {
    const s = frozen();
    expect(setTransition(s, 2, "spin").scenes[2].transition).toBe("spin");
    expect(setTransition(s, 2, "teleport" as Transition)).toBe(s);
    expect(setTransition(s, 9, "spin")).toBe(s);
    expect(setTransition(s, 2, "whip")).toBe(s);
  });
});

describe("setZoom", () => {
  it("writes the two scale keyframes on the clip", () => {
    const s = frozen();
    const out = setZoom(s, 0, 1.3);
    expect(out.scenes[0].layers[0]).toMatchObject({ keyframes: [{ at: 0, scale: 1.3 }, { at: 1, scale: 1.36 }] });
    expect(out.scenes[0].layers[1]).toBe(s.scenes[0].layers[1]);
  });
  it("keeps a spin and clamps the amount", () => {
    const s = base();
    s.scenes[1].layers[0] = clip("a.mp4", 4, { keyframes: [{ at: 0, scale: 1.2, rotate: 5 }, { at: 1, scale: 1.3 }] } as Partial<Layer>);
    const out = setZoom(s, 1, 9);
    expect(out.scenes[1].layers[0]).toMatchObject({ keyframes: [{ at: 0, scale: 2, rotate: 5 }, { at: 1, scale: 2 }] });
    expect(setZoom(base(), 0, 0.2).scenes[0].layers[0]).toMatchObject({ keyframes: [{ scale: 1 }, { scale: 1.06 }] });
  });
  it("does nothing on a shot without a clip or photo, or with a bad index", () => {
    const s = { ...base(), scenes: [scene(3, [words("x")]), scene(3, [clip("a.mp4", 0)])] };
    expect(setZoom(s, 0, 1.2)).toBe(s);
    expect(setZoom(s, 4, 1.2)).toBe(s);
  });
});

describe("setCaptionText", () => {
  it("changes a text layer only", () => {
    const s = frozen();
    expect(setCaptionText(s, 0, 1, "  hello   world ").scenes[0].layers[1]).toMatchObject({ text: "hello world" });
    expect(setCaptionText(s, 0, 0, "x")).toBe(s);
    expect(setCaptionText(s, 0, 5, "x")).toBe(s);
    expect(setCaptionText(s, 0, 1, "   ")).toBe(s);
    expect(setCaptionText(s, 0, 1, "one")).toBe(s);
  });
  it("cuts the text to the limit", () => {
    const out = setCaptionText(base(), 0, 1, "a".repeat(500));
    expect((out.scenes[0].layers[1] as { text: string }).text).toHaveLength(140);
  });
});

describe("stickers", () => {
  it("adds a text sticker with a box and a shape, and removes them", () => {
    const s = frozen();
    const a = addSticker(s, 1, textSticker("45,000 RWF"));
    expect(a.scenes[1].layers).toHaveLength(2);
    const b = addSticker(a, 1, { kind: "shape", shape: "arrow", color: "#ff0", x: 0.5, y: 0.5, w: 0.2, h: 0.2 });
    expect(b.scenes[1].layers).toHaveLength(3);
    expect(removeSticker(b, 1, 2).scenes[1].layers).toHaveLength(2);
    expect(removeSticker(b, 1, 1).scenes[1].layers.map((l) => l.kind)).toEqual(["video", "shape"]);
  });
  it("refuses a text layer without a box, an empty one, a full shot and removing the clip", () => {
    const s = base();
    expect(addSticker(s, 0, { ...textSticker("x"), box: null })).toBe(s);
    expect(addSticker(s, 0, textSticker("  "))).toBe(s);
    expect(addSticker(s, 9, textSticker("x"))).toBe(s);
    const full = { ...s, scenes: [scene(3, Array.from({ length: 14 }, () => words("x")))] };
    expect(addSticker(full, 0, textSticker("y"))).toBe(full);
    expect(removeSticker(s, 0, 0)).toBe(s);
    expect(removeSticker(s, 0, 7)).toBe(s);
  });
});

describe("setLook", () => {
  it("sets the grade and keeps the other look settings", () => {
    const s = freeze({ ...base(), look: { grain: 0.3 } });
    expect(setLook(s, "warm").look).toEqual({ grain: 0.3, grade: "warm" });
    expect(setLook(s, "sepia" as never)).toBe(s);
    expect(setLook(base(), "none")).toEqual(base());
    expect(setLook(base(), "none")).not.toHaveProperty("look");
  });
});

describe("snapCutsToBeats", () => {
  // A beat every 0.5 s starting at 0.1.
  const beat = { period: 0.5, offset: 0.1 };
  it("moves each cut onto a beat and keeps the total", () => {
    const s = freeze({ ...base(), scenes: [scene(4.2, [clip("a.mp4", 0)]), scene(3.3, [clip("a.mp4", 4.2)]), scene(4.5, [clip("b.mp4", 0)])] });
    const out = snapCutsToBeats(s, beat);
    expect(totalSeconds(out)).toBeCloseTo(12, 5);
    const cut1 = out.scenes[0].seconds;
    expect((cut1 - 0.1) / 0.5).toBeCloseTo(Math.round((cut1 - 0.1) / 0.5), 5);
    expect(out.scenes.every((x) => x.seconds >= 1.2 && x.seconds <= 8)).toBe(true);
    // The second shot picks up the same clip where the first now ends.
    const first = out.scenes[0].layers[0] as { start: number };
    const second = out.scenes[1].layers[0] as { start: number };
    expect(second.start).toBeCloseTo(first.start + cut1, 5);
  });
  it("changes nothing without a beat, on a single shot, or when the cuts are on the beat", () => {
    const s = base();
    expect(snapCutsToBeats(s, null)).toBe(s);
    const one = { ...s, scenes: [s.scenes[0]] };
    expect(snapCutsToBeats(one, beat)).toBe(one);
    const on = { ...s, scenes: [scene(4.1, [clip("a.mp4", 0)]), scene(4, [clip("b.mp4", 0)]), scene(3.9, [clip("c.mp4", 0)])] };
    expect(snapCutsToBeats(on, beat)).toBe(on);
    expect(snapCutsToBeats(s, { period: 9, offset: 0 })).toBe(s);
  });
});

describe("history", () => {
  it("applies, undoes and redoes", () => {
    let h = createHistory(frozen());
    h = apply(h, (s) => setLook(s, "warm"));
    h = apply(h, (s) => deleteShot(s, 0));
    expect(h.present.scenes).toHaveLength(2);
    h = undo(h);
    expect(h.present.scenes).toHaveLength(3);
    expect(h.present.look?.grade).toBe("warm");
    h = redo(h);
    expect(h.present.scenes).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present.look).toBeUndefined();
    expect(undo(h)).toBe(h);
  });
  it("adds no step for an edit that changes nothing, and a new edit clears redo", () => {
    let h = createHistory(base());
    expect(apply(h, (s) => deleteShot(s, 99))).toBe(h);
    h = apply(h, (s) => setLook(s, "cool"));
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = apply(h, (s) => setLook(s, "mono"));
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });
  it("keeps at most 100 steps", () => {
    let h = createHistory(base());
    for (let k = 0; k < 130; k++) h = apply(h, (s) => trimShot(s, 0, { seconds: 1.2 + (k % 2 ? 0.5 : 1) + k * 0.01 }));
    expect(h.past).toHaveLength(HISTORY_STEPS);
  });
});
