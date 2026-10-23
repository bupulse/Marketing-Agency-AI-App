import { describe, expect, it } from "vitest";
import { clipDurations, clipPathsOf, isOwnClipPath, pickClipScenes, withClips, withoutClips } from "@/lib/visuals/clip-scenes";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { VIDEO_LIMITS } from "@/lib/visuals/types";

const SCRIPT = "Grow your own greens\nNo soil, no mess\nFits any balcony\nWater once a week";
const make = (photos: string[]) => buildVideoPlan({ script: SCRIPT, hook: "Fresh lettuce at home", businessName: "LEAF", photos, pack: "bold" });

describe("pickClipScenes", () => {
  it("opens with a clip, then a body scene with a different photo; never the closing scene", () => {
    const plan = make(["u/projects/a.jpg", "u/projects/b.jpg"]);
    const picked = pickClipScenes(plan, 2);
    expect(picked.map((p) => p.scene)).toEqual([0, 1]);
    expect(new Set(picked.map((p) => p.photoPath)).size).toBe(2);
    expect(picked.every((p) => plan.scenes[p.scene].role !== "cta")).toBe(true);
  });

  it("with one photo, uses it twice (Veo makes a different shot)", () => {
    const picked = pickClipScenes(make(["u/projects/a.jpg"]), 2);
    expect(picked).toHaveLength(2);
    expect(picked.every((p) => p.photoPath === "u/projects/a.jpg")).toBe(true);
  });

  it("with no photo, none", () => {
    expect(pickClipScenes(make([]), 2)).toEqual([]);
  });
});

describe("clipDurations", () => {
  it("holds clip scenes for the clip (at most a scene's maximum)", () => {
    expect(clipDurations([3000, 3000, 3000], new Map([[0, 6000]]), 500)).toEqual([6000, 3000, 3000]);
    expect(clipDurations([3000, 3000], new Map([[0, 8000]]), 500)[0]).toBe(VIDEO_LIMITS.maxSceneMs);
  });

  it("keeps the video within 30 s: the other scenes give up time first", () => {
    const out = clipDurations([6000, 6000, 6000, 6000, 6000, 6000], new Map([[0, 6000], [1, 6000]]), 500);
    const total = out.reduce((a, b) => a + b, 0) - 500 * 5;
    expect(total).toBeLessThanOrEqual(VIDEO_LIMITS.maxMs);
    expect(out[0]).toBe(6000);
    expect(out[1]).toBe(6000);
    expect(out.slice(2).every((d) => d >= VIDEO_LIMITS.minSceneMs)).toBe(true);
  });
});

describe("withClips / withoutClips", () => {
  it("puts the clips in their scenes, keeps the photos as stand-ins, and re-times", () => {
    const plan = { ...make(["u/projects/a.jpg", "u/projects/b.jpg"]), quality: "ai" as const };
    const next = withClips(plan, [{ scene: 0, path: "u/aiclips/v-0.mp4", ms: 6000 }]);
    expect(next.scenes[0].clipPath).toBe("u/aiclips/v-0.mp4");
    expect(next.scenes[0].photoPath).toBe("u/projects/a.jpg");
    expect(next.scenes[0].durationMs).toBe(6000);
    expect(next.totalMs).toBeLessThanOrEqual(VIDEO_LIMITS.maxMs);
    expect(clipPathsOf(next)).toEqual(["u/aiclips/v-0.mp4"]);
  });

  it("back to a simple video clears the mark and the clips, with the reason", () => {
    const plan = withClips({ ...make(["u/projects/a.jpg"]), quality: "ai" as const }, [{ scene: 0, path: "u/aiclips/v-0.mp4", ms: 6000 }]);
    const simple = withoutClips(plan, "Because.");
    expect(simple.quality).toBe("simple");
    expect(simple.aiNote).toBe("Because.");
    expect(clipPathsOf(simple)).toEqual([]);
  });

  it("only the owner's own clip folder counts as theirs", () => {
    expect(isOwnClipPath("u", "u/aiclips/v-0.mp4")).toBe(true);
    expect(isOwnClipPath("u", "x/aiclips/v-0.mp4")).toBe(false);
    expect(isOwnClipPath("u", "u/aiclips/../videos/a.mp4")).toBe(false);
    expect(isOwnClipPath("u", "u/videos/a.mp4")).toBe(false);
  });
});
