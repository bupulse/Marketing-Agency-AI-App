import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extrusion, extrusionSteps, fogAmount, lightState, particleAt, spinAngle, towardLight, turntableAt, turntableColumn, vanishingPoint } from "@/lib/video-engine/animate";
import { drawSpecFrame } from "@/lib/video-engine/draw";
import { fogFilter, mix, rgba, turntableFit } from "@/lib/video-engine/draw3d";
import { SPEC_FORMAT, briefText, systemPrompt, type DesignBrief } from "@/lib/video-engine/designer";
import { sampleSpec } from "@/lib/video-engine/sample";
import { MATERIALS, PARTICLE_KINDS, SPEC_LIMITS, totalMs, type MotionSpec } from "@/lib/video-engine/spec";
import { TEMPLATE_CATEGORIES, VIDEO_TEMPLATES } from "@/lib/video-engine/templates";
import { validateSpec } from "@/lib/video-engine/validate";
import { MAX_VOICE_CHARS, VOICE_MODEL, VOICE_TIMING, cueTimings, fitSpecToVoice, looksKinyarwanda, placeVoice, speakSpec, voiceCostUsd, voiceLanguage, voiceLines, type SpokenLine } from "@/lib/video-engine/voice";
import { mixSamples } from "@/lib/voice/mix";
import { DEFAULT_VOICE_ID } from "@/lib/voice/voices";

const opts = { ratio: "9:16" as const, photoCount: 1, seconds: 6 };
const twoScenes = (layers: unknown[], scene: Record<string, unknown> = {}) => ({
  palette: { background: "#000000", primary: "#2f6bff", accent: "#7b5cff", text: "#ffffff" },
  scenes: [
    { seconds: 3, background: { kind: "solid", colors: ["#111111"] }, layers, ...scene },
    { seconds: 3, background: { kind: "solid", colors: ["#111111"] }, layers: [] },
  ],
});

describe("validation of the 3D look", () => {
  it("a light is clamped and filled in; fog gets a colour only when there is fog", () => {
    const spec = validateSpec(twoScenes([], { light: { x: 9, y: "0.1", intensity: 3, color: "orange", fog: 0.4, fogColor: "#0b1640" } }), opts);
    expect(spec.scenes[0].light).toEqual({ x: 1.5, y: 0.1, intensity: 1, color: "#ffffff", fog: 0.4, fogColor: "#0b1640" });
    expect(spec.scenes[1].light).toBeUndefined();
    const noFog = validateSpec(twoScenes([], { light: {} }), opts);
    expect(noFog.scenes[0].light).toMatchObject({ x: 0.25, y: 0.15, intensity: 0.6, fog: undefined, fogColor: undefined });
  });

  it("3D text, box and shape materials: clamped, shorthand true, unknown materials dropped", () => {
    const spec = validateSpec(
      twoScenes([
        { kind: "text", text: "Big", font: "anton", size: 0.15, color: "#ffffff", x: 0.5, y: 0.4, w: 0.8, h: 0.2, text3d: { depth: 5, side: "blue", bevel: "yes", spin: true, material: "gold" }, box: { color: "#ffffff", material: "glass" } },
        { kind: "text", text: "Small", font: "inter", size: 0.05, color: "#ffffff", x: 0.5, y: 0.7, w: 0.8, h: 0.1, text3d: true },
        { kind: "text", text: "Flat", font: "inter", size: 0.05, color: "#ffffff", x: 0.5, y: 0.8, w: 0.8, h: 0.1, text3d: "no" },
        { kind: "shape", shape: "rect", color: "#ffffff", x: 0.5, y: 0.5, w: 0.5, h: 0.2, material: "metal" },
        { kind: "shape", shape: "rect", color: "#ffffff", x: 0.5, y: 0.5, w: 0.5, h: 0.2, material: "wood" },
      ]),
      opts,
    );
    const [big, small, flat, metal, wood] = spec.scenes[0].layers as unknown as Record<string, unknown>[];
    expect(big.text3d).toEqual({ depth: 1, side: "#333333", bevel: false, spin: true, material: undefined });
    expect(big.box).toMatchObject({ material: "glass" });
    expect(small.text3d).toEqual({ depth: 0.5 });
    expect(flat.text3d).toBeNull();
    expect(metal.material).toBe("metal");
    expect(wood.material).toBeUndefined();
  });

  it("a turntable is clamped; shorthand true gives the defaults", () => {
    const spec = validateSpec(twoScenes([
      { kind: "photo", photo: 1, x: 0.5, y: 0.5, w: 0.6, h: 0.5, turntable: { spin: 99, angle: 2, reflection: -1, sweep: false } },
      { kind: "photo", photo: 1, x: 0.5, y: 0.5, w: 0.6, h: 0.5, turntable: true },
    ]), opts);
    expect(spec.scenes[0].layers[0]).toMatchObject({ turntable: { spin: 3, angle: 10, reflection: 0, sweep: false } });
    expect(spec.scenes[0].layers[1]).toMatchObject({ turntable: { spin: 1, angle: 35, reflection: 0.35, sweep: true } });
  });

  it("particles: unknown kind falls back to dust, numbers clamped, colours repaired, the whole frame by default", () => {
    const spec = validateSpec(twoScenes([
      { kind: "particles", particle: "fireworks", count: 500, size: 1, speed: -3, colors: ["#ff0000", "red", 7, "#00ff00", "#0000ff", "#ffffff", "#000000"], seed: 12.6 },
      { kind: "particles", particle: "confetti", x: 0.5, y: 0.3, w: 0.5, h: 0.4 },
    ]), opts);
    const [a, b] = spec.scenes[0].layers;
    expect(a).toMatchObject({ kind: "particles", particle: "dust", count: 80, size: 0.08, speed: 0, seed: 13, x: 0.5, y: 0.5, w: 1, h: 1 });
    expect((a as { colors: string[] }).colors).toEqual(["#ff0000", "#ffffff", "#ffffff", "#00ff00", "#0000ff"]);
    expect(b).toMatchObject({ particle: "confetti", count: 30, x: 0.5, y: 0.3, w: 0.5, h: 0.4, colors: undefined });
  });

  it("a 3D spec survives a round trip unchanged", () => {
    const spec = validateSpec(sampleSpec({ business: "B", product: "P", price: "1,000 RWF", photoCount: 2 }), { ratio: "9:16", photoCount: 2, seconds: 12 });
    expect(validateSpec(JSON.parse(JSON.stringify(spec)), { ratio: "9:16", photoCount: 2, seconds: 12 })).toEqual(spec);
    expect(spec.scenes.some((s) => s.light?.fog)).toBe(true);
    expect(spec.scenes.flatMap((s) => s.layers).some((l) => l.kind === "photo" && l.turntable)).toBe(true);
    expect(spec.scenes.flatMap((s) => s.layers).some((l) => l.kind === "text" && l.text3d?.material === "metal")).toBe(true);
  });
});

describe("3D maths", () => {
  const W = 1080;
  const H = 1920;
  const still = { orbit: 0, panX: 0, panY: 0 };

  it("the extrusion goes away from the light and towards the vanishing point", () => {
    const vp = vanishingPoint(still, W, H);
    // Light at the top left, text in the middle: the sides show down and to the right.
    const back = extrusion(W / 2, H * 0.42, vp, { x: 0, y: 0 }, 40);
    expect(back.dx).toBeGreaterThan(0);
    expect(back.dy).toBeGreaterThan(0);
    // Light at the top right: the sides show to the left.
    expect(extrusion(W / 2, H * 0.42, vp, { x: W, y: 0 }, 40).dx).toBeLessThan(0);
    // Text left of the vanishing point leans its sides right (towards it), text right of it leans left.
    const left = extrusion(W * 0.1, H * 0.42, vp, { x: W / 2, y: -H }, 40);
    const right = extrusion(W * 0.9, H * 0.42, vp, { x: W / 2, y: -H }, 40);
    expect(left.dx).toBeGreaterThan(0);
    expect(right.dx).toBeLessThan(0);
    // Its length stays near the asked length (0.7 to 1.4 times).
    const n = Math.hypot(back.dx, back.dy);
    expect(n).toBeGreaterThan(27.9);
    expect(n).toBeLessThan(56.1);
  });

  it("the camera's orbit moves the vanishing point, so the sides turn with the camera", () => {
    const a = vanishingPoint({ ...still, orbit: -0.1 }, W, H);
    const b = vanishingPoint({ ...still, orbit: 0.1 }, W, H);
    expect(a.x).toBeGreaterThan(W / 2);
    expect(b.x).toBeLessThan(W / 2);
    const light = { x: W / 2, y: -H };
    expect(extrusion(W / 2, H / 2, a, light, 40).dx).toBeGreaterThan(extrusion(W / 2, H / 2, b, light, 40).dx);
  });

  it("a spin-in starts turned and ends facing the camera; turned, the sides show sideways", () => {
    expect(spinAngle(0)).toBeCloseTo((85 * Math.PI) / 180);
    expect(spinAngle(1)).toBe(0);
    const vp = vanishingPoint(still, W, H);
    const facing = extrusion(W / 2, H * 0.42, vp, { x: W / 2, y: 0 }, 40, 0);
    const turned = extrusion(W / 2, H * 0.42, vp, { x: W / 2, y: 0 }, 40, spinAngle(0.2));
    expect(Math.abs(turned.dx)).toBeGreaterThan(Math.abs(facing.dx) + 20);
  });

  it("extrusion steps stay between 3 and 28", () => {
    expect(extrusionSteps(0, 1)).toBe(3);
    expect(extrusionSteps(24, 1)).toBe(20);
    expect(extrusionSteps(1000, 1)).toBe(28);
  });

  it("towardLight is a unit vector; fog fades far layers only", () => {
    const v = towardLight(500, 500, { x: 0, y: 0 }, W, H);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeLessThan(0);
    expect(fogAmount(0.5, 0)).toBeCloseTo(0.5);
    expect(fogAmount(0.5, 1)).toBe(0);
    expect(fogAmount(0.5, 0.2)).toBeGreaterThan(fogAmount(0.5, 0.8));
    expect(fogFilter(lightState({ fog: 0.6, fogColor: "#000000" }), 0)).toContain("brightness(");
    expect(fogFilter(lightState({ fog: 0.6 }), 1)).toBe("");
    expect(lightState(undefined)).toMatchObject({ set: false, fog: 0 });
  });

  it("a turntable swings between -angle and +angle and the shine glides across", () => {
    const t = { spin: 1, angle: 30 };
    expect(turntableAt(t, 0).yaw).toBe(0);
    const yaws = Array.from({ length: 41 }, (_, i) => turntableAt(t, i / 40).yaw);
    const max = (30 * Math.PI) / 180;
    expect(Math.max(...yaws)).toBeCloseTo(max, 5);
    expect(Math.min(...yaws)).toBeCloseTo(-max, 5);
    expect(turntableAt(t, 0.25).sweep).toBeLessThan(turntableAt(t, 0.75).sweep);
    for (const p of [0, 0.3, 0.6, 1]) {
      const s = turntableAt(t, p);
      expect(s.lift).toBeGreaterThanOrEqual(0);
      expect(s.lift).toBeLessThanOrEqual(1);
    }
  });

  it("turntable columns: flat at yaw 0; turned, the far side shrinks, columns stay in order and edges straight", () => {
    for (const u of [0, 0.25, 0.5, 1]) expect(turntableColumn(u, 0)).toEqual({ x: u - 0.5, scale: 1 });
    const yaw = 0.6;
    const cols = Array.from({ length: 11 }, (_, i) => turntableColumn(i / 10, yaw));
    expect(cols[10].scale).toBeLessThan(1);
    expect(cols[0].scale).toBeGreaterThan(1);
    for (let i = 1; i < cols.length; i++) expect(cols[i].x).toBeGreaterThan(cols[i - 1].x);
    // The top edge (x, -scale/2) is a straight line: every point on the line through the two ends.
    const [a, b] = [cols[0], cols[10]];
    for (const c of cols) {
      const expected = -a.scale / 2 + ((-b.scale / 2 + a.scale / 2) * (c.x - a.x)) / (b.x - a.x);
      expect(-c.scale / 2).toBeCloseTo(expected, 9);
    }
    expect(turntableColumn(1, -yaw).scale).toBeCloseTo(turntableColumn(0, yaw).scale);
  });

  it("particles are seeded: same frame, same particles; inside the box; near ones larger", () => {
    for (const kind of PARTICLE_KINDS) {
      for (const i of [0, 7, 31]) {
        const a = particleAt(kind, i, 3, 2.5);
        expect(particleAt(kind, i, 3, 2.5)).toEqual(a);
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThan(1);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeLessThan(1);
        expect(a.alpha).toBeGreaterThanOrEqual(0);
        expect(a.alpha).toBeLessThanOrEqual(1);
      }
    }
    expect(particleAt("dust", 4, 1, 1)).not.toEqual(particleAt("dust", 4, 2, 1));
    // Confetti falls, bubbles rise (over a short time, before wrapping round).
    const fall = particleAt("confetti", 2, 9, 0.2).y - particleAt("confetti", 2, 9, 0).y;
    const rise = particleAt("bubbles", 2, 9, 0.2).y - particleAt("bubbles", 2, 9, 0).y;
    expect(fall > 0 || fall < -0.5).toBe(true);
    expect(rise < 0 || rise > 0.5).toBe(true);
  });

  it("colours mix in rgb and read hex and rgba", () => {
    expect(rgba("#fff")).toEqual([255, 255, 255, 1]);
    expect(rgba("#00000080")[3]).toBeCloseTo(0.5, 2);
    expect(rgba("rgba(10, 20, 30, 0.25)")).toEqual([10, 20, 30, 0.25]);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("rgba(128,128,128,1)");
    expect(mix("#ff0000", "#ff0000", 0, 0.3)).toBe("rgba(255,0,0,0.3)");
  });
});

describe("drawing the 3D look", () => {
  /** A canvas that records every call and property set, numbers rounded, so two draws can be compared. */
  const recorder = () => {
    const log: string[] = [];
    const gradient = { addColorStop: (...a: unknown[]) => log.push(`stop:${a.join(",")}`) };
    const fmt = (a: unknown) => (typeof a === "number" ? a.toFixed(3) : typeof a === "object" && a !== null ? "obj" : String(a));
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => {
        if (prop in target) return target[prop];
        if (prop === "measureText") return (s: string) => ({ width: s.length * 20 });
        if (prop === "createLinearGradient" || prop === "createRadialGradient") return (...a: unknown[]) => (log.push(`${prop}:${a.map(fmt).join(",")}`), gradient);
        return (...args: unknown[]) => void log.push(`${prop}:${args.map(fmt).join(",")}`);
      },
      set: (target, prop: string, value) => {
        target[prop] = value;
        log.push(`${prop}=${fmt(value)}`);
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
  };
  const spec = validateSpec(sampleSpec({ business: "Nova Phones", product: "Galaxy A56", price: "420,000 RWF", photoCount: 2 }), { ratio: "9:16", photoCount: 2, seconds: 12 });
  const img = { width: 800, height: 600 } as unknown as CanvasImageSource & { width: number; height: number };
  const photos = new Map([[1, img], [2, img]]);

  it("the same frame draws exactly the same way twice (deterministic)", () => {
    for (const t of [300, 3500, 10_500]) {
      const a = recorder();
      const b = recorder();
      drawSpecFrame(a.ctx, spec, photos, t, { makeCanvas: null });
      drawSpecFrame(b.ctx, spec, photos, t, { makeCanvas: null });
      expect(a.log.length).toBeGreaterThan(100);
      expect(b.log).toEqual(a.log);
    }
  });

  it("3D text paints its sides before its face; the turntable draws its columns and reflection", () => {
    const hook = recorder();
    drawSpecFrame(hook.ctx, spec, photos, 2000, { makeCanvas: null });
    const product = hook.log.filter((l) => l.startsWith("fillText:GALAXY"));
    expect(product.length).toBeGreaterThan(10);
    const turn = recorder();
    drawSpecFrame(turn.ctx, spec, photos, 3900, { makeCanvas: null });
    expect(turn.log.filter((l) => l.startsWith("drawImage:")).length).toBeGreaterThan(48);
    expect(turn.log.some((l) => l.startsWith("scale:1.000,-1.000"))).toBe(true);
  });

  it("every frame of the 3D sample draws without throwing at every quality", () => {
    // A canvas that does nothing (the recorder is too slow for hundreds of frames).
    const gradient = { addColorStop: () => undefined };
    const noop = () => undefined;
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => (prop in target ? target[prop] : prop === "measureText" ? (s: string) => ({ width: s.length * 20 }) : prop.startsWith("create") ? () => gradient : noop),
      set: (target, prop: string, value) => ((target[prop] = value), true),
    }) as unknown as CanvasRenderingContext2D;
    for (const quality of ["480p", "720p", "1080p"] as const) {
      for (let t = 0; t < totalMs(spec); t += 500) drawSpecFrame(ctx, spec, photos, t, { makeCanvas: null, quality });
    }
  });
});

describe("templates and designer know the 3D look", () => {
  it("a 3D motion category with 3 to 5 templates that use the new fields", () => {
    expect(TEMPLATE_CATEGORIES.some((c) => c.id === "3d")).toBe(true);
    const three = VIDEO_TEMPLATES.filter((t) => t.category === "3d");
    expect(three.length).toBeGreaterThanOrEqual(3);
    expect(three.length).toBeLessThanOrEqual(6);
    for (const t of three) expect(/text3d|turntable|particles|material/.test(t.direction)).toBe(true);
  });

  it("the answer format names every new option, and the rules explain them", () => {
    for (const v of [...MATERIALS, ...PARTICLE_KINDS]) expect(SPEC_FORMAT).toContain(`"${v}"`);
    for (const key of ["light?:", "fog?:", "text3d?:", "turntable?:", '"particles"', "material?:"]) expect(SPEC_FORMAT).toContain(key);
    expect(systemPrompt()).toContain("3D look");
    expect(systemPrompt()).toContain("Voice-over");
  });
});

// ---- Voice-over ------------------------------------------------------------------------------------------------------

const scene = (seconds: number, say?: string) => ({ seconds, background: { kind: "solid" as const, colors: ["#000000"] }, layers: [], transition: "fade" as const, say });
const specOf = (...scenes: ReturnType<typeof scene>[]): MotionSpec => ({ version: 1, title: "T", ratio: "9:16", fps: 30, palette: { background: "#000000", primary: "#111111", accent: "#222222", text: "#ffffff" }, scenes, music: null, caption: "", hashtags: [] });

describe("voice lines", () => {
  it("one sentence per scene with a line, in order, with a full stop added", () => {
    const lines = voiceLines(specOf(scene(3, "Hello Kigali"), scene(3), scene(3, "Call us today!")));
    expect(lines).toEqual([{ scene: 0, text: "Hello Kigali." }, { scene: 2, text: "Call us today!" }]);
  });

  it("stops before the character limit", () => {
    const long = "word ".repeat(30).trim();
    const lines = voiceLines(specOf(...Array.from({ length: 8 }, () => scene(3, long))));
    expect(lines.reduce((s, l) => s + l.text.length + 1, -1)).toBeLessThanOrEqual(MAX_VOICE_CHARS);
    expect(lines.length).toBeLessThan(8);
  });

  it("costs $0.30 per 1,000 characters", () => {
    expect(voiceCostUsd(1000)).toBeCloseTo(0.3);
    expect(voiceCostUsd(84)).toBeCloseTo(0.0252);
  });
});

describe("fitSpecToVoice", () => {
  const line = (scene: number, startMs: number, endMs: number): SpokenLine => ({ scene, text: "x", startMs, endMs });

  it("stretches a scene shorter than its line, and plays each line a moment after its scene starts", () => {
    const spec = specOf(scene(2, "a"), scene(3), scene(2, "b"));
    const { spec: fitted, cues, fits } = fitSpecToVoice(spec, { lines: [line(0, 0, 2600), line(2, 2900, 4000)], durationMs: 4100 });
    expect(fits).toBe(true);
    expect(fitted.scenes[0].seconds).toBeGreaterThanOrEqual((VOICE_TIMING.firstLeadMs + 2720 + VOICE_TIMING.tailMs) / 1000);
    expect(fitted.scenes[1].seconds).toBe(3);
    expect(cues[0]).toMatchObject({ scene: 0, fromMs: 0, atMs: VOICE_TIMING.firstLeadMs });
    const scene2Start = Math.round(fitted.scenes[0].seconds * 1000) + 3000;
    expect(cues[1].atMs).toBe(scene2Start + VOICE_TIMING.leadMs);
    // The last line ends with a breath before the video does.
    expect(cues[1].atMs + (cues[1].toMs - cues[1].fromMs) + VOICE_TIMING.endTailMs).toBeLessThanOrEqual(totalMs(fitted) + 10);
    // The original spec is not changed.
    expect(spec.scenes[0].seconds).toBe(2);
  });

  it("pieces never overlap in the take or in the video", () => {
    const spec = specOf(scene(1.5, "a"), scene(1.5, "b"), scene(1.5, "c"), scene(1.5, "d"));
    const lines = [line(0, 0, 3000), line(1, 3200, 6500), line(2, 6600, 7000), line(3, 7300, 9000)];
    const { cues } = fitSpecToVoice(spec, { lines, durationMs: 9100 });
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].fromMs).toBeGreaterThanOrEqual(cues[i - 1].toMs);
      expect(cues[i].atMs).toBeGreaterThanOrEqual(cues[i - 1].atMs + (cues[i - 1].toMs - cues[i - 1].fromMs));
    }
  });

  it("never passes 30 seconds: shortens scenes without lines first, cuts the voice only as a last resort", () => {
    const spec = specOf(scene(8, "a"), scene(8), scene(8), scene(4, "b"));
    const fitted = fitSpecToVoice(spec, { lines: [line(0, 0, 2000), line(3, 2200, 9000)], durationMs: 9000 });
    expect(totalMs(fitted.spec)).toBeLessThanOrEqual(SPEC_LIMITS.maxTotalSeconds * 1000);
    expect(fitted.fits).toBe(true);
    expect(fitted.spec.scenes[1].seconds).toBeLessThan(8);
    expect(fitted.spec.scenes[3].seconds).toBeGreaterThan(7);
    const huge = fitSpecToVoice(specOf(scene(8, "a"), scene(8, "b"), scene(8, "c"), scene(8, "d")), { lines: [line(0, 0, 9000), line(1, 9000, 18000), line(2, 18000, 27000), line(3, 27000, 36000)], durationMs: 36000 });
    expect(huge.fits).toBe(false);
    expect(totalMs(huge.spec)).toBeLessThanOrEqual(30_000);
    for (const c of huge.cues) expect(c.atMs + (c.toMs - c.fromMs)).toBeLessThanOrEqual(totalMs(huge.spec));
  });

  it("no lines: the spec keeps its lengths and there are no cues", () => {
    const spec = specOf(scene(3), scene(3));
    expect(fitSpecToVoice(spec, { lines: [], durationMs: 0 })).toEqual({ spec, cues: [], fits: true });
  });
});

describe("mixing the voice-over", () => {
  it("places each cue's piece of the take at its moment, with short fades", () => {
    const rate = 1000;
    const take = [Float32Array.from({ length: 1000 }, (_, i) => (i >= 100 && i < 300 ? 0.5 : 0))];
    const [out] = placeVoice(take, [{ scene: 0, fromMs: 100, toMs: 300, atMs: 500 }], rate, 1000);
    expect(out.length).toBe(1000);
    expect(out[499]).toBe(0);
    expect(out[600]).toBeCloseTo(0.5);
    expect(out[500]).toBeLessThan(0.5);
    expect(out[699]).toBeLessThan(0.5);
    expect(out[700]).toBe(0);
  });

  it("the music is ducked under the voice and full between lines", () => {
    const rate = 1000;
    const totalMsV = 10_000;
    const cues = [{ scene: 0, fromMs: 0, toMs: 2000, atMs: 3000 }];
    const take = [new Float32Array(2000).fill(0.1)];
    const voice = placeVoice(take, cues, rate, totalMsV);
    const music = [new Float32Array(rate).fill(0.5)];
    const [mixed] = mixSamples({ voice, music, sampleRate: rate, totalMs: totalMsV, speech: cueTimings(cues) }) ?? [];
    // Alone (after the fade in): 0.85 of the music; under speech: 0.2 of it plus the voice.
    expect(mixed[2000]).toBeCloseTo(0.5 * 0.85, 2);
    expect(mixed[4000]).toBeCloseTo(0.5 * 0.2 + 0.1, 2);
    expect(mixed[7000]).toBeCloseTo(0.5 * 0.85, 2);
  });
});

describe("speakSpec (ElevenLabs, mocked)", () => {
  const alignment = (text: string) => ({ characters: [...text], character_start_times_seconds: [...text].map((_, i) => i * 0.06), character_end_times_seconds: [...text].map((_, i) => i * 0.06 + 0.05) });
  const ok = (text: string) => new Response(JSON.stringify({ audio_base64: Buffer.from("ID3fake").toString("base64"), alignment: alignment(text) }), { status: 200 });

  it("speaks all lines in one call with the default voice and model, and returns each line's timing", async () => {
    const spec = specOf(scene(3, "Hello Kigali"), scene(3), scene(3, "Call us"));
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => ok(JSON.parse(init.body as string).text));
    const voice = await speakSpec(spec, { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/text-to-speech/${DEFAULT_VOICE_ID}/with-timestamps`);
    expect(JSON.parse(init.body as string)).toMatchObject({ text: "Hello Kigali. Call us.", model_id: VOICE_MODEL });
    expect(voice?.lines.map((l) => [l.scene, l.startMs])).toEqual([[0, 0], [2, 840]]);
    expect(voice?.characters).toBe(22);
    expect(Buffer.from(voice!.audio).toString()).toBe("ID3fake");
  });

  it("no lines: no call; errors in plain words", async () => {
    const fetchImpl = vi.fn();
    expect(await speakSpec(specOf(scene(3), scene(3)), { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    const denied = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(speakSpec(specOf(scene(3, "Hi"), scene(3)), { apiKey: "k", fetchImpl: denied as unknown as typeof fetch })).rejects.toThrow("The ElevenLabs key is not valid.");
  });
});

describe("Video Lab voice-overs (makeVoiceForJob, mocked ElevenLabs)", () => {
  const cwd = process.cwd();
  const key = process.env.ELEVENLABS_API_KEY;
  let dir = "";
  beforeAll(async () => {
    // The lab keeps its files under video-lab/data of the working directory: a temporary one here.
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "voice-lab-"));
    process.chdir(dir);
    process.env.ELEVENLABS_API_KEY = "test-key";
    vi.resetModules();
  });
  afterAll(async () => {
    process.chdir(cwd);
    if (key === undefined) Reflect.deleteProperty(process.env, "ELEVENLABS_API_KEY");
    else process.env.ELEVENLABS_API_KEY = key;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("pays once, records the cost in the ledger, then serves the same take from the cache", async () => {
    const { makeVoiceForJob, readVoiceMp3 } = await import("@/video-lab/voice");
    const spec = specOf(scene(2, "Hello Kigali"), scene(3, "Call us today"));
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const text = JSON.parse(init.body as string).text as string;
      return new Response(JSON.stringify({ audio_base64: Buffer.from("ID3audio").toString("base64"), alignment: { character_start_times_seconds: [...text].map((_, i) => i * 0.07), character_end_times_seconds: [...text].map((_, i) => i * 0.07 + 0.06) } }), { status: 200 });
    });
    const first = await makeVoiceForJob(spec, "20261017-aaaaaaaa", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(first).toMatchObject({ cached: false, characters: 28, voiceId: DEFAULT_VOICE_ID });
    expect(first?.costUsd).toBeCloseTo(0.0084);
    expect(first?.url).toMatch(/^\/api\/voice\/[0-9a-f]{40}\.mp3$/);
    expect(first?.cues).toHaveLength(2);
    const ledger = (await fs.readFile(path.join(dir, "video-lab/data/ledger.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(ledger).toMatchObject([{ jobId: "20261017-aaaaaaaa", kind: "elevenlabs-voice", model: VOICE_MODEL, inputTokens: 28 }]);
    const again = await makeVoiceForJob(spec, "20261017-bbbbbbbb", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(again).toMatchObject({ cached: true, costUsd: 0, hash: first?.hash });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await readVoiceMp3(first!.hash))?.toString()).toBe("ID3audio");
    expect(await readVoiceMp3("../../etc/passwd")).toBeNull();
    expect(await makeVoiceForJob(specOf(scene(3), scene(3)), "20261017-cccccccc", { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    // A Kinyarwanda business: English lines are spoken (cached take) and the page is told why.
    const rw = await makeVoiceForJob(spec, "20261017-dddddddd", { language: "Kinyarwanda", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(rw).toMatchObject({ cached: true, spokenLanguage: "English" });
    expect(rw?.note).toContain("Kinyarwanda");
    expect(first).toMatchObject({ spokenLanguage: "English", note: null });
    // Kinyarwanda lines (a design from before the rule) are refused before anything is paid.
    const kin = specOf(scene(3, "Telefoni nshya ya Samsung, igiciro cyiza cyane"), scene(3, "Murakaza neza kuri Nova Phones"));
    await expect(makeVoiceForJob(kin, "20261017-eeeeeeee", { language: "Kinyarwanda", fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow("cannot speak");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("turntable fit", () => {
  it("the turned picture never leaves its box, at any swing, float or photo shape", () => {
    const box = { w: 700, h: 960 };
    for (const [iw, ih] of [[1280, 1280], [1280, 720], [720, 1280], [400, 1600]]) {
      for (const angle of [10, 35, 60]) {
        const { w, h, centre } = turntableFit(box, iw, ih, angle);
        expect(w).toBeLessThanOrEqual(box.w);
        const tallest = h * turntableColumn(0, (angle * Math.PI) / 180).scale;
        // The near edge at the widest swing, floated up 2.5% of the box: still inside the top.
        expect(centre - tallest / 2 - box.h * 0.025).toBeGreaterThanOrEqual(0);
        // The floor (the picture's foot) leaves room in the box for the reflection.
        expect(centre + h / 2).toBeLessThan(box.h * 0.85);
      }
    }
  });
});

describe("voice-over language (Kinyarwanda)", () => {
  it("speaks the content language when the voice can, English otherwise, and says so", () => {
    expect(voiceLanguage("English")).toEqual({ spokenLanguage: "English", captionLanguage: "English", note: null });
    expect(voiceLanguage("French")).toMatchObject({ spokenLanguage: "French", note: null });
    expect(voiceLanguage("Spanish")).toMatchObject({ spokenLanguage: "Spanish", note: null });
    const rw = voiceLanguage("Kinyarwanda");
    expect(rw).toMatchObject({ spokenLanguage: "English", captionLanguage: "Kinyarwanda" });
    expect(rw.note).toContain("Kinyarwanda");
    expect(voiceLanguage(" rw ")).toMatchObject({ spokenLanguage: "English", captionLanguage: "Kinyarwanda" });
    expect(voiceLanguage("Swahili").spokenLanguage).toBe("English");
    expect(voiceLanguage(null)).toMatchObject({ spokenLanguage: "English", note: null });
  });

  it("recognises Kinyarwanda lines, not English or French ones", () => {
    for (const rw of ["Telefoni nshya ya Samsung, igiciro cyiza cyane.", "Murakaza neza kuri Nova Phones.", "Ishyura na MoMo, garanti y'amezi 12 kandi ni nziza."]) expect(looksKinyarwanda(rw)).toBe(true);
    for (const other of ["The Samsung Galaxy A56 5G has arrived in Kigali!", "Order on WhatsApp from Nova Phones Kigali.", "Commandez sur WhatsApp chez Nova Phones à Kigali.", "A banana a day, in Rwanda."]) expect(looksKinyarwanda(other)).toBe(false);
  });

  it("the brief asks for English voice lines and Kinyarwanda captions; other briefs name their language", () => {
    const brief: DesignBrief = { business: { name: "Nova Phones", language: "Kinyarwanda" }, product: { name: "Galaxy A56" }, photos: [], styleId: "3d-title-drop", hookId: "auto", ratio: "9:16", seconds: 12 };
    const rw = briefText(brief);
    expect(rw).toContain("Voice-over language: English");
    expect(rw).toContain("keep all on-screen text and the caption in Kinyarwanda");
    expect(briefText({ ...brief, business: { name: "B", language: "French" } })).toContain("Voice-over language: French\n");
    expect(systemPrompt()).toContain("say lines in the voice-over language");
  });
});
