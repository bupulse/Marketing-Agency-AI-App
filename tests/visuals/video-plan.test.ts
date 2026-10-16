import { describe, expect, it } from "vitest";
import { buildVideoPlan, fitDurations, readVideoPlan, sceneDuration, scriptLines, withSceneTexts } from "@/lib/visuals/video-plan";
import { billableSeconds, captionAlphas, captionAt, captionOpacity, frameCount, frameTimestampUs, kenBurns, layersAt, sceneStarts, totalDuration, wrapText } from "@/lib/visuals/timeline";
import { VIDEO_LIMITS, type VideoPlan } from "@/lib/visuals/types";

const SCRIPT = `[0-3s] Hook: Tired of heavy shoes?
(Close-up of the sneaker on a track)
0:03 - 0:08 VO: Meet the Aero Sneaker, light as air.
Scene 3: On-screen text: Made for Kigali streets.
B-roll of runners at dawn
CTA: Visit Kigali Kicks today!`;

const base = { hook: "Tired of heavy shoes?", businessName: "Kigali Kicks", photos: ["u/gallery/a.jpg", "u/gallery/b.jpg"], pack: "bold" as const, colors: ["#FF5500"] };

describe("scriptLines", () => {
  it("keeps what viewers read: no timestamps, labels or stage directions", () => {
    expect(scriptLines(SCRIPT)).toEqual(["Tired of heavy shoes?", "Meet the Aero Sneaker, light as air.", "Made for Kigali streets.", "Visit Kigali Kicks today!"]);
  });
  it("splits long lines at sentence ends", () => {
    const long = `${"A sentence that is quite long indeed. ".repeat(4)}`;
    expect(scriptLines(long).length).toBeGreaterThan(1);
  });
});

describe("durations", () => {
  it("each scene is long enough to read and within limits", () => {
    expect(sceneDuration("Hi")).toBe(VIDEO_LIMITS.minSceneMs);
    expect(sceneDuration("x".repeat(200))).toBe(VIDEO_LIMITS.maxSceneMs);
  });
  it("the whole video fits 10 to 30 seconds, crossfades included", () => {
    for (const ds of [[2000, 2000], Array(7).fill(6000), [3000, 4000, 3500]]) {
      const fitted = fitDurations(ds);
      const total = totalDuration(fitted.map((d) => ({ durationMs: d })), VIDEO_LIMITS.crossfadeMs);
      expect(total).toBeGreaterThanOrEqual(VIDEO_LIMITS.minMs);
      expect(total).toBeLessThanOrEqual(VIDEO_LIMITS.maxMs);
    }
  });
});

describe("buildVideoPlan", () => {
  it("hook first, call to action last, photos cycled, vertical 1080x1920 within 30 s", () => {
    const plan = buildVideoPlan({ ...base, script: SCRIPT });
    expect(plan).toMatchObject({ width: 1080, height: 1920, fps: 30, pack: "bold" });
    expect(plan.scenes[0]).toMatchObject({ role: "hook", text: "Tired of heavy shoes?", photoPath: "u/gallery/a.jpg" });
    expect(plan.scenes.at(-1)).toMatchObject({ role: "cta", text: "Kigali Kicks" });
    expect(plan.scenes.at(-1)!.photoPath).toBeNull(); // fewer photos than scenes: the closing scene is the brand backdrop
    expect(plan.scenes[1].photoPath).toBe("u/gallery/b.jpg");
    expect(plan.totalMs).toBeGreaterThanOrEqual(VIDEO_LIMITS.minMs);
    expect(plan.totalMs).toBeLessThanOrEqual(VIDEO_LIMITS.maxMs);
    expect(plan.totalMs).toBe(totalDuration(plan.scenes, plan.crossfadeMs));
  });

  it("an empty script and no photos still make a 10 second video on the brand backdrop", () => {
    const plan = buildVideoPlan({ ...base, script: "", photos: [] });
    expect(plan.scenes.length).toBe(2);
    expect(plan.scenes.every((s) => s.photoPath === null)).toBe(true);
    expect(plan.totalMs).toBe(VIDEO_LIMITS.minMs);
  });

  it("at most 7 scenes however long the script", () => {
    const plan = buildVideoPlan({ ...base, script: Array.from({ length: 20 }, (_, i) => `Line number ${i} of the script.`).join("\n") });
    expect(plan.scenes.length).toBe(VIDEO_LIMITS.maxScenes);
    expect(plan.totalMs).toBeLessThanOrEqual(VIDEO_LIMITS.maxMs);
  });

  it("edited captions keep the shape and refit the timing", () => {
    const plan = buildVideoPlan({ ...base, script: SCRIPT });
    const edited = withSceneTexts(plan, plan.scenes.map((s, i) => (i === 1 ? "x".repeat(300) : s.text)));
    expect(edited.scenes).toHaveLength(plan.scenes.length);
    expect(edited.scenes[1].text.length).toBeLessThanOrEqual(VIDEO_LIMITS.sceneText);
    expect(edited.totalMs).toBeLessThanOrEqual(VIDEO_LIMITS.maxMs);
  });

  it("reads stored plans defensively", () => {
    expect(readVideoPlan(buildVideoPlan({ ...base, script: SCRIPT }))).not.toBeNull();
    expect(readVideoPlan({ version: 1, scenes: [], totalMs: 1 })).toBeNull();
    expect(readVideoPlan({ ...buildVideoPlan({ ...base, script: SCRIPT }), totalMs: 60_000 })).toBeNull();
  });
});

describe("timeline", () => {
  const plan: Pick<VideoPlan, "scenes" | "crossfadeMs"> = {
    crossfadeMs: 500,
    scenes: [
      { text: "a", photoPath: null, durationMs: 3000, motion: "zoom-in", role: "hook" },
      { text: "b", photoPath: null, durationMs: 3000, motion: "pan-left", role: "cta" },
    ],
  };

  it("scenes overlap by the crossfade", () => {
    expect(sceneStarts(plan)).toEqual([0, 2500]);
    expect(totalDuration(plan.scenes, 500)).toBe(5500);
  });

  it("one layer, then two while crossfading (the old one fully drawn underneath), then one", () => {
    expect(layersAt(plan, 1000)).toEqual([{ index: 0, opacity: 1, progress: 1000 / 3000 }]);
    const mid = layersAt(plan, 2750);
    expect(mid.map((l) => l.index)).toEqual([0, 1]);
    expect(mid[0].opacity).toBe(1);
    expect(mid[1].opacity).toBeCloseTo(0.5);
    expect(layersAt(plan, 4000).map((l) => l.index)).toEqual([1]);
    expect(layersAt(plan, 5500).map((l) => l.index)).toEqual([1]); // the very end still shows the last scene
  });

  it("Ken Burns covers the frame without stretching and zooms in", () => {
    const image = { width: 2000, height: 1000 };
    const frame = { width: 1080, height: 1920 };
    const start = kenBurns("zoom-in", 0, image, frame);
    const end = kenBurns("zoom-in", 1, image, frame);
    expect(start.sw / start.sh).toBeCloseTo(1080 / 1920);
    expect(start.sh).toBeCloseTo(1000);
    expect(end.sw).toBeLessThan(start.sw);
    const panL = kenBurns("pan-left", 0, image, frame);
    const panR = kenBurns("pan-left", 1, image, frame);
    expect(panL.sx).toBeGreaterThan(panR.sx);
    expect(panR.sx).toBeGreaterThanOrEqual(0);
  });

  it("captions fade, wrap and clip", () => {
    expect(captionOpacity(0)).toBe(0);
    expect(captionOpacity(0.5)).toBe(1);
    expect(captionOpacity(1)).toBe(0);
    const lines = wrapText("one two three four five six seven", 9, (s) => s.length, 2);
    expect(lines).toEqual(["one two", "three…"]);
    expect(wrapText("supercalifragilistic", 8, (s) => s.length)).toEqual(["supercal", "ifragili", "stic"]);
  });

  it("captions are sequential: at no time are two captions above 0.1 opacity, and each one is fully shown", () => {
    for (const p of [buildVideoPlan({ ...base, script: SCRIPT }), buildVideoPlan({ ...base, script: Array.from({ length: 12 }, (_, i) => `Line ${i} of the script.`).join("\n") }), plan]) {
      const total = totalDuration(p.scenes, p.crossfadeMs);
      const peak = p.scenes.map(() => 0);
      for (let t = 0; t <= total; t += 5) {
        const alphas = captionAlphas(p, t);
        expect(alphas.filter((a) => a > 0.1).length, `t=${t}`).toBeLessThanOrEqual(1);
        alphas.forEach((a, i) => (peak[i] = Math.max(peak[i], a)));
      }
      expect(peak.every((a) => a === 1)).toBe(true);
      // Mid-crossfade (where the bug showed both texts) there is no caption at all.
      const starts = sceneStarts(p);
      expect(captionAt(p, starts[1] + p.crossfadeMs / 2)).toBeNull();
      // The last caption stays to the end.
      expect(captionAt(p, total)?.index).toBe(p.scenes.length - 1);
    }
  });

  it("frames and seconds", () => {
    expect(frameCount({ totalMs: 10_000, fps: 30 })).toBe(300);
    expect(frameTimestampUs(30, 30)).toBe(1_000_000);
    expect(billableSeconds(10_001)).toBe(11);
  });
});
