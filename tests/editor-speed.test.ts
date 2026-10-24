import { describe, expect, it } from "vitest";
import { describeEdit } from "@/lib/editor/describe";
import { setClipSound, setSpeed, snapCutsToBeats, splitShot, trimShot } from "@/lib/editor/ops";
import { CLIP_FADE_MAX, CLIP_RATE, type Layer, type MotionSpec, type Scene } from "@/lib/video-engine/spec";

const clip = (url: string, start: number, over: Partial<Layer> = {}): Layer => ({ kind: "video", url, fit: "cover", start, sound: true, x: 0.5, y: 0.5, w: 1, h: 1, ...over }) as Layer;
const scene = (seconds: number, layers: Layer[]): Scene => ({ seconds, background: { kind: "solid", colors: ["#000"] }, layers });
// Shots 1 to 3 play clip a straight through (0 to 4, 4 to 7, 7 to 9.5); shot 4 is another clip; shot 5 is an AI clip.
const AI = "https://s/storage/v1/object/sign/clips/u1/videos/veo/vc-0123456789ab.mp4?token=t";
const reel = (): MotionSpec => ({
  version: 1, title: "R", ratio: "9:16", fps: 30, palette: { background: "#000", primary: "#f00", accent: "#f00", text: "#fff" },
  scenes: [scene(4, [clip("a.mp4", 0)]), scene(3, [clip("a.mp4", 4)]), scene(2.5, [clip("a.mp4", 7)]), scene(3, [clip("b.mp4", 1)]), scene(3, [clip(AI, 0)])],
  music: null, caption: "", hashtags: [],
});
const frozen = <T,>(v: T): T => {
  if (v && typeof v === "object") {
    Object.values(v).forEach(frozen);
    Object.freeze(v);
  }
  return v;
};
const vid = (s: MotionSpec, i: number) => s.scenes[i].layers.find((l) => l.kind === "video") as Extract<Layer, { kind: "video" }>;

describe("setSpeed", () => {
  it("sets the rate on the shot, keeps its length and leaves the input alone", () => {
    const s = frozen(reel());
    const out = setSpeed(s, 3, 0.5);
    expect(vid(out, 3).rate).toBe(0.5);
    expect(out.scenes[3].seconds).toBe(3);
    expect(out.scenes[0]).toBe(s.scenes[0]);
  });
  it("clamps the rate to 0.5 to 2 and rounds it", () => {
    expect(vid(setSpeed(reel(), 3, 9), 3).rate).toBe(CLIP_RATE.max);
    expect(vid(setSpeed(reel(), 3, 0.1), 3).rate).toBe(CLIP_RATE.min);
    expect(vid(setSpeed(reel(), 3, 1.2345), 3).rate).toBe(1.23);
  });
  it("leaves the rate out at 1, as the validator does", () => {
    const slow = setSpeed(reel(), 3, 0.5);
    expect("rate" in vid(setSpeed(slow, 3, 1), 3)).toBe(false);
    expect(setSpeed(reel(), 3, 1)).toEqual(reel());
  });
  it("moves the starts of the shots that carry on the same clip, and no others", () => {
    // Shot 1 at 0.5x reads 2 s instead of 4: shot 2 now starts at 2, shot 3 follows (it was 3 s after shot 2's start).
    const out = setSpeed(reel(), 0, 0.5);
    expect(vid(out, 1).start).toBe(2);
    expect(vid(out, 2).start).toBe(5);
    expect(vid(out, 3).start).toBe(1);
    // Speeding up the middle shot moves only the one after it.
    const fast = setSpeed(reel(), 1, 2);
    expect(vid(fast, 0).start).toBe(0);
    expect(vid(fast, 2).start).toBe(10);
    expect(vid(fast, 3).start).toBe(1);
  });
  it("does not rewrite a shot that did not continue the clip, and never goes below the clip's start", () => {
    const s = reel();
    s.scenes[1] = scene(3, [clip("a.mp4", 9)]);
    const out = setSpeed(s, 0, 2);
    expect(vid(out, 1).start).toBe(9);
    expect(vid(setSpeed(reel(), 0, 0.5), 1).start).toBeGreaterThanOrEqual(0);
  });
  it("does nothing for a bad index, a bad number, a shot without a clip or no change", () => {
    const s = reel();
    expect(setSpeed(s, 9, 2)).toBe(s);
    expect(setSpeed(s, 0, Number.NaN)).toBe(s);
    expect(setSpeed(s, 0, 1)).toBe(s);
    const plain = { ...s, scenes: [scene(3, [])] };
    expect(setSpeed(plain, 0, 2)).toBe(plain);
  });
});

describe("the clip's length accounts for the speed", () => {
  it("trims within the clip: a shot at 2x reads twice its length", () => {
    const fast = setSpeed(reel(), 3, 2);
    // From 1 s in a 7 s clip: 6 s left, 3 s of shot at 2x.
    expect(trimShot(fast, 3, { seconds: 8 }, { clipSeconds: 7 }).scenes[3].seconds).toBe(3);
    // At 0.5x the same clip allows 12 s of shot, so only the scene limit applies.
    const slow = setSpeed(reel(), 3, 0.5);
    expect(trimShot(slow, 3, { seconds: 8 }, { clipSeconds: 7 }).scenes[3].seconds).toBe(8);
  });
  it("keeps the minimum shot inside the clip at any speed", () => {
    const fast = setSpeed(reel(), 3, 2);
    expect(vid(trimShot(fast, 3, { start: 50 }, { clipSeconds: 7 }), 3).start).toBe(4.6);
  });
  it("a split reads on from the right place in the clip", () => {
    const slow = setSpeed(reel(), 0, 0.5);
    const out = splitShot(slow, 0, 1.5);
    expect(vid(out, 0).start).toBe(0);
    expect(vid(out, 1).start).toBe(0.75);
    expect(vid(out, 1).rate).toBe(0.5);
  });
  it("snapping cuts to the beat keeps a continuing shot continuing at any speed", () => {
    const slow = setSpeed(reel(), 0, 0.5);
    const out = snapCutsToBeats(slow, { period: 0.5, offset: 0.1 });
    const a = vid(out, 0);
    expect(vid(out, 1).start).toBeCloseTo(a.start + out.scenes[0].seconds * 0.5, 1);
  });
});

describe("setClipSound", () => {
  it("sets the level and the fades, clamped", () => {
    const out = setClipSound(frozen(reel()), 0, { volume: 0.5, fadeIn: 0.3, fadeOut: 9 });
    expect(vid(out, 0)).toMatchObject({ volume: 0.5, fadeIn: 0.3, fadeOut: CLIP_FADE_MAX });
    expect(vid(setClipSound(reel(), 0, { volume: 5 }), 0).volume).toBeUndefined();
    expect(vid(setClipSound(reel(), 0, { volume: -1 }), 0).volume).toBe(0);
    expect(vid(setClipSound(reel(), 0, { fadeIn: -2 }), 0).fadeIn).toBeUndefined();
  });
  it("leaves the defaults out and changes one setting at a time", () => {
    const set = setClipSound(reel(), 0, { volume: 0.5, fadeIn: 1 });
    const back = setClipSound(set, 0, { volume: 1 });
    expect(vid(back, 0)).toMatchObject({ fadeIn: 1 });
    expect("volume" in vid(back, 0)).toBe(false);
    expect(vid(setClipSound(back, 0, { fadeIn: 0 }), 0)).toEqual(vid(reel(), 0));
  });
  it("does not touch an AI clip, and does nothing for bad input or no change", () => {
    const s = reel();
    expect(setClipSound(s, 4, { volume: 0.2 })).toBe(s);
    expect(setClipSound(s, 9, { volume: 0.2 })).toBe(s);
    expect(setClipSound(s, 0, { volume: Number.NaN })).toBe(s);
    expect(setClipSound(s, 0, { volume: 1 })).toBe(s);
    expect(setClipSound(s, 0, {})).toBe(s);
  });
});

describe("describeEdit names speed and sound", () => {
  it("lists the changes in plain words", () => {
    let s = setSpeed(reel(), 3, 0.75);
    s = setClipSound(s, 0, { volume: 0.4, fadeIn: 0.5, fadeOut: 1 });
    const lines = describeEdit(reel(), s);
    expect(lines).toEqual(["Shot 1 sound level changed from 100% to 40%.", "Shot 1 sound fade-in changed from 0 s to 0.5 s.", "Shot 1 sound fade-out changed from 0 s to 1 s.", "Shot 4 speed changed from 1x to 0.75x."]);
  });
  it("says nothing when the speed and sound are as they were", () => {
    expect(describeEdit(reel(), setSpeed(setSpeed(reel(), 3, 2), 3, 1))).toEqual([]);
  });
});
