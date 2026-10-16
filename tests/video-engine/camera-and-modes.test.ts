import { describe, expect, it, vi } from "vitest";
import { cameraAt, noise, parallax } from "@/lib/video-engine/animate";
import { GRADE_FILTERS, transitionTransforms } from "@/lib/video-engine/draw";
import { briefText, designVideo, type DesignBrief } from "@/lib/video-engine/designer";
import { CAMERA_MOVES, GRADES, QUALITIES, RATIOS, TRANSITIONS, canvasSize, totalMs } from "@/lib/video-engine/spec";
import { VIDEO_HOOKS } from "@/lib/video-engine/styles";
import { TEMPLATE_CATEGORIES, VIDEO_TEMPLATES, templateById } from "@/lib/video-engine/templates";
import { validateSpec } from "@/lib/video-engine/validate";
import { sampleSpec } from "@/lib/video-engine/sample";

describe("camera", () => {
  it("static and no camera leave the scene still", () => {
    for (const cam of [undefined, { move: "static" as const }]) {
      expect(cameraAt(cam, 0.5, 1000)).toMatchObject({ zoom: 1, panX: 0, panY: 0, roll: 0, orbit: 0, moving: false });
    }
  });

  it("every move is finite at the start, middle and end", () => {
    for (const move of CAMERA_MOVES) {
      for (const p of [0, 0.5, 1]) {
        const c = cameraAt({ move, intensity: 1, shake: 1, focusFrom: 0, focusTo: 1 }, p, 1234);
        for (const v of [c.zoom, c.panX, c.panY, c.roll, c.orbit, c.dollyZoom, c.shakeX, c.shakeY]) expect(Number.isFinite(v)).toBe(true);
        expect(c.zoom).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("a dolly in zooms in over the scene; a crash zoom is done in the first fifth", () => {
    expect(cameraAt({ move: "dollyIn", intensity: 1 }, 1, 0).zoom).toBeCloseTo(1.28);
    expect(cameraAt({ move: "crashZoom", intensity: 1 }, 0.2, 0).zoom).toBeCloseTo(1.5);
  });

  it("near layers move more than far ones (parallax)", () => {
    const cam = cameraAt({ move: "panLeft", intensity: 1 }, 1, 0);
    expect(Math.abs(parallax(cam, 1).dx)).toBeGreaterThan(Math.abs(parallax(cam, 0).dx));
    const orbit = cameraAt({ move: "orbitLeft", intensity: 1 }, 1, 0);
    expect(Math.sign(parallax(orbit, 0).dx)).toBe(-Math.sign(parallax(orbit, 1).dx));
  });

  it("a focus pull moves the focus from one depth to another", () => {
    expect(cameraAt({ move: "static", focusFrom: 0, focusTo: 1 }, 0, 0).focus).toBe(0);
    expect(cameraAt({ move: "static", focusFrom: 0, focusTo: 1 }, 1, 0).focus).toBe(1);
  });

  it("shake is deterministic: the same frame always shakes the same way", () => {
    expect(noise(1.5, 3)).toBe(noise(1.5, 3));
    expect(cameraAt({ move: "handheld" }, 0.4, 900)).toEqual(cameraAt({ move: "handheld" }, 0.4, 900));
  });
});

describe("transitions and looks", () => {
  it("every transition ends with the new scene in place and fully visible", () => {
    for (const kind of TRANSITIONS) {
      const { cur } = transitionTransforms(kind, 1, 1080, 1920);
      expect(cur).toMatchObject({ dx: 0, dy: 0, scale: 1, alpha: 1 });
      expect(cur.blur).toBeLessThan(0.5);
    }
  });

  it("every grade has a filter entry", () => {
    for (const g of GRADES) expect(GRADE_FILTERS[g]).toBeTypeOf("string");
  });
});

describe("shapes and quality", () => {
  it("every shape and quality gives even canvas sizes; 1080p keeps the short side at 1080", () => {
    for (const ratio of Object.keys(RATIOS) as (keyof typeof RATIOS)[]) {
      for (const q of Object.keys(QUALITIES) as (keyof typeof QUALITIES)[]) {
        const { width, height } = canvasSize({ ratio }, q);
        expect(width % 2).toBe(0);
        expect(height % 2).toBe(0);
        expect(Math.min(width, height)).toBe(QUALITIES[q]);
      }
    }
  });
});

describe("validation of camera and look", () => {
  const raw = {
    palette: {},
    scenes: [
      { seconds: 3, background: {}, layers: [], camera: { move: "teleport", intensity: 9, shake: -1 } },
      { seconds: 3, background: {}, layers: [{ kind: "text", text: "Hi", font: "inter", size: 0.1, color: "#fff", x: 0.5, y: 0.5, w: 0.5, h: 0.1, depth: 7 }], camera: { move: "orbitLeft", focusFrom: 0.2, focusTo: 0.8 } },
    ],
    look: { grade: "sepia-ish", glow: 3, letterbox: "yes" },
  };

  it("repairs unknown moves and clamps values", () => {
    const spec = validateSpec(raw, { ratio: "9:16", photoCount: 0, seconds: 6 });
    expect(spec.scenes[0].camera).toMatchObject({ move: "static", intensity: 1, shake: 0 });
    expect(spec.scenes[1].camera).toMatchObject({ move: "orbitLeft", focusFrom: 0.2, focusTo: 0.8 });
    expect(spec.scenes[1].layers[0].depth).toBe(1);
    expect(spec.look).toEqual({ grade: "none", grain: undefined, vignette: undefined, glow: 1, lightLeak: undefined, letterbox: false });
  });

  it("fixed lens turns every camera move off", () => {
    const spec = validateSpec(raw, { ratio: "9:16", photoCount: 0, seconds: 6, fixedLens: true });
    expect(spec.scenes.map((s) => s.camera?.move)).toEqual(["static", "static"]);
  });
});

describe("templates and hooks", () => {
  it("unique ids, known categories, and a template in every category", () => {
    expect(new Set(VIDEO_TEMPLATES.map((t) => t.id)).size).toBe(VIDEO_TEMPLATES.length);
    const cats = new Set<string>(TEMPLATE_CATEGORIES.map((c) => c.id));
    for (const t of VIDEO_TEMPLATES) expect(cats.has(t.category)).toBe(true);
    for (const c of cats) expect(VIDEO_TEMPLATES.some((t) => t.category === c)).toBe(true);
    expect(VIDEO_TEMPLATES.length).toBeGreaterThanOrEqual(24);
  });

  it("template hooks exist, and unknown ids fall back", () => {
    const hooks = new Set(VIDEO_HOOKS.map((h) => h.id));
    for (const t of VIDEO_TEMPLATES) if (t.hook) expect(hooks.has(t.hook)).toBe(true);
    expect(templateById("nope").id).toBe(VIDEO_TEMPLATES[0].id);
  });
});

describe("modes", () => {
  const brief: DesignBrief = {
    business: { name: "Urugo Homes" },
    product: { name: "3-bedroom house" },
    photos: [{ base64: "A", mediaType: "image/jpeg", width: 10, height: 10 }, { base64: "B", mediaType: "image/jpeg", width: 10, height: 10 }],
    styleId: "story-cinematic",
    hookId: "auto",
    ratio: "9:16",
    seconds: 15,
  };

  it("each mode adds its instruction", () => {
    expect(briefText({ ...brief, mode: "text" })).toContain("TEXT TO VIDEO");
    expect(briefText({ ...brief, mode: "image" })).toContain("IMAGE TO VIDEO");
    expect(briefText({ ...brief, mode: "firstLast" })).toContain("FIRST AND LAST FRAME");
    expect(briefText({ ...brief, fixedLens: true })).toContain("Fixed lens");
    expect(briefText({ ...brief, variation: { index: 2, of: 3 } })).toContain("version 2 of 3");
  });

  it("edit sends the current design and the change; extend asks for new scenes after it", () => {
    const base = validateSpec(sampleSpec({ business: "B", product: "P", photoCount: 2 }), { ratio: "9:16", photoCount: 2, seconds: 12 });
    const edit = briefText({ ...brief, mode: "edit", base, note: "bigger price" });
    expect(edit).toContain("EDIT an existing video");
    expect(edit).toContain("<<<DESIGN");
    expect(edit).toContain("bigger price");
    expect(edit).not.toContain('Template "');
    expect(briefText({ ...brief, mode: "extend", base, seconds: 5 })).toContain("EXTEND an existing video by about 5 seconds");
  });

  it("an edit keeps Claude's new length; an extend adds the asked seconds", async () => {
    const base = validateSpec(sampleSpec({ business: "B", product: "P", photoCount: 2 }), { ratio: "9:16", photoCount: 2, seconds: 12 });
    const longer = { ...base, scenes: [...base.scenes, { ...base.scenes[0], seconds: 6 }] };
    const answer = (spec: unknown) => async () => new Response(JSON.stringify({ model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(spec) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    const edited = await designVideo({ ...brief, mode: "edit", base, note: "longer" }, { apiKey: "k", fetchImpl: vi.fn(answer(longer)) as unknown as typeof fetch });
    expect(totalMs(edited.spec)).toBe(18_000);
    const extended = await designVideo({ ...brief, mode: "extend", base, seconds: 5 }, { apiKey: "k", fetchImpl: vi.fn(answer(longer)) as unknown as typeof fetch });
    expect(totalMs(extended.spec)).toBe(17_000);
  });
});
