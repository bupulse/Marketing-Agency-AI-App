import { describe, expect, it } from "vitest";
import { MAX_LINES, describeEdit } from "@/lib/editor/describe";
import { addSticker, deleteShot, moveShot, setCaptionText, setLook, setTransition, setZoom, splitShot, textSticker, trimShot } from "@/lib/editor/ops";
import type { Layer, MotionSpec, Scene } from "@/lib/video-engine/spec";

const clip = (url: string, start: number): Layer => ({ kind: "video", url, fit: "cover", start, sound: true, x: 0.5, y: 0.5, w: 1, h: 1, keyframes: [{ at: 0, scale: 1 }, { at: 1, scale: 1.06 }] });
const words = (text: string): Layer => ({ kind: "text", text, font: "inter", size: 0.07, color: "#fff", x: 0.5, y: 0.7, w: 0.8, h: 0.1, box: { color: "#000" } });
const scene = (seconds: number, layers: Layer[], transition?: Scene["transition"]): Scene => ({ seconds, background: { kind: "solid", colors: ["#000"] }, layers, ...(transition ? { transition } : {}) });
const reel = (): MotionSpec => ({
  version: 1, title: "Reel", ratio: "9:16", fps: 30, palette: { background: "#000", primary: "#f00", accent: "#f00", text: "#fff" },
  scenes: [scene(4, [clip("a.mp4", 0), words("Grow indoors")]), scene(3, [clip("a.mp4", 4)], "flash"), scene(2.5, [clip("b.mp4", 1), words("Call us")], "whip"), scene(3, [clip("c.mp4", 0)], "zoom")],
  music: null, caption: "", hashtags: [],
});
const frozen = <T,>(v: T): T => {
  if (v && typeof v === "object") {
    Object.values(v).forEach(frozen);
    Object.freeze(v);
  }
  return v;
};

describe("describeEdit", () => {
  it("says nothing when nothing changed", () => {
    expect(describeEdit(reel(), reel())).toEqual([]);
  });
  it("names a removed shot", () => {
    expect(describeEdit(reel(), deleteShot(reel(), 1))).toEqual(["Shot 2 was removed (3 s).", "The total length changed from 12.5 s to 9.5 s."]);
  });
  it("names a trim, with the seconds", () => {
    expect(describeEdit(reel(), trimShot(reel(), 0, { seconds: 2.5 }))).toEqual(["Shot 1 was trimmed from 4 s to 2.5 s.", "The total length changed from 12.5 s to 11 s."]);
    expect(describeEdit(reel(), trimShot(reel(), 2, { start: 1.8 }))).toEqual(["Shot 3 now starts 0.8 s later in its clip."]);
  });
  it("names a split", () => {
    expect(describeEdit(reel(), splitShot(reel(), 0, 1.5))).toEqual(["Shot 1 was split in two: 1.5 s and 2.5 s."]);
  });
  it("names a moved shot once", () => {
    expect(describeEdit(reel(), moveShot(reel(), 3, 0))).toEqual(["Shot 4 was moved to position 1."]);
    expect(describeEdit(reel(), moveShot(reel(), 0, 3))).toEqual(["Shot 1 was moved to position 4."]);
  });
  it("names transition, zoom, words and look changes", () => {
    let s = setTransition(reel(), 1, "spin");
    s = setZoom(s, 2, 1.3);
    s = setCaptionText(s, 0, 1, "Grow all year");
    s = setLook(s, "warm");
    expect(describeEdit(reel(), s)).toEqual([
      'Shot 1 words changed: "Grow indoors" -> "Grow all year".',
      "The way shot 2 comes in changed from flash to spin.",
      "Shot 3 zoom changed from 1.00x to 1.30x.",
      "The colour look changed from none to warm.",
    ]);
  });
  it("names stickers added and removed", () => {
    const added = addSticker(addSticker(reel(), 3, textSticker("45,000 RWF")), 3, { kind: "shape", shape: "arrow", color: "#ff0", x: 0.5, y: 0.5, w: 0.2, h: 0.2 });
    expect(describeEdit(reel(), added)).toEqual(['Shot 4: text added "45,000 RWF".', "Shot 4: an arrow shape added."]);
    expect(describeEdit(added, reel())).toEqual(['Shot 4: text removed "45,000 RWF".', "Shot 4: an arrow shape removed."]);
  });
  it("is deterministic, does not change its inputs, and is capped", () => {
    const before = frozen(reel());
    const after = frozen(setLook(trimShot(moveShot(before, 3, 0), 1, { seconds: 2 }), "film"));
    expect(describeEdit(before, after)).toEqual(describeEdit(before, after));
    let s = reel();
    for (let i = 0; i < 40; i++) s = i % 2 ? trimShot(s, 0, { seconds: 4 }) : trimShot(s, 0, { seconds: 3 });
    const many: MotionSpec = { ...reel(), scenes: Array.from({ length: 40 }, (_, i) => scene(2, [clip(`x${i}.mp4`, 0)])) };
    const lines = describeEdit(many, { ...many, scenes: [] });
    expect(lines).toHaveLength(MAX_LINES + 1);
    expect(lines[MAX_LINES]).toMatch(/more changes/);
  });
});
