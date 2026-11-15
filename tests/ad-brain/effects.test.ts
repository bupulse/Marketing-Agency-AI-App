import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkParams, comboSimilarity, COMBO_TOO_CLOSE, EFFECTS, effectById, pickEffects, seededRandom, withDefaults } from "@/lib/ad-brain/effects";
import { pickRecipe, RECIPES, recipeEffects } from "@/lib/ad-brain/recipes";

describe("the effects library", () => {
  it("has the core effects ported from the prototypes, each with sane defaults", () => {
    expect(EFFECTS.filter((e) => e.core).length).toBeGreaterThanOrEqual(12);
    for (const e of EFFECTS) expect(checkParams(e.id, withDefaults(e.id)), e.id).toEqual([]);
  });

  it("matches the renderer's registry (tools/ad-render), so the brain never picks an effect the renderer cannot draw", () => {
    const py = ["adr/fx.py", "adr/text.py", "adr/wall.py"].map((f) => readFileSync(join(process.cwd(), "tools/ad-render", f), "utf8")).join("\n");
    const drawn = new Set([...py.matchAll(/@(?:segment_fx|transition_fx|screen_fx|title_style)\("([a-z_]+)"\)/g)].map((m) => m[1]));
    for (const e of EFFECTS.filter((x) => ["segment", "transition", "screen", "title"].includes(x.kind))) expect(drawn.has(e.id), e.id).toBe(true);
    for (const id of drawn) expect(effectById(id), id).toBeDefined();
    // Captions and sounds are drawn by the renderer's own code paths.
    const render = readFileSync(join(process.cwd(), "tools/ad-render/render.py"), "utf8") + readFileSync(join(process.cwd(), "tools/ad-render/adr/audio.py"), "utf8");
    for (const id of ["karaoke", "one_word", "robot_voice"]) expect(render).toContain(id);
  });

  it("checks settings", () => {
    expect(checkParams("rgb_split", { amount: 12 })).toEqual([]);
    expect(checkParams("rgb_split", { amount: 100 })).toHaveLength(1);
    expect(checkParams("rgb_split", { volume: 1 })[0]).toMatch(/not one of its settings/);
    expect(checkParams("scan_wipe", { direction: "sideways" })[0]).toMatch(/one of down, up/);
    expect(checkParams("nope", {})[0]).toMatch(/not an effect/);
  });

  it("measures how alike two combinations are", () => {
    expect(comboSimilarity(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(comboSimilarity(["a", "b"], ["c", "d"])).toBe(0);
    expect(comboSimilarity(["a", "b", "c", "d"], ["a", "b", "e", "f"])).toBeCloseTo(2 / 6);
  });

  it("picks 3 to 5 signature effects the recipe can place, with the recipe's own, deterministically", () => {
    const twist = RECIPES.find((r) => r.id === "twist")!;
    const a = pickEffects({ allowed: recipeEffects(twist), required: twist.required, recent: [], rng: seededRandom("job1") });
    const b = pickEffects({ allowed: recipeEffects(twist), required: twist.required, recent: [], rng: seededRandom("job1") });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a.length).toBeLessThanOrEqual(5);
    for (const id of twist.required) expect(a).toContain(id);
    for (const id of a) expect(recipeEffects(twist)).toContain(id);
  });

  it("never repeats a recent look", () => {
    const r = RECIPES.find((x) => x.id === "testimonial_screens")!;
    const recent: string[][] = [];
    for (let i = 0; i < 8; i++) {
      const pick = pickEffects({ allowed: recipeEffects(r), required: r.required, recent, rng: seededRandom(`ad${i}`) });
      for (const old of recent) expect(comboSimilarity(pick, old)).toBeLessThan(COMBO_TOO_CLOSE);
      recent.unshift(pick);
    }
  });

  it("says so when no new combination is left", () => {
    expect(() => pickEffects({ allowed: ["slam", "punch_in", "rgb_split"], recent: [["slam", "punch_in", "rgb_split"]], rng: seededRandom(1) })).toThrow(/No new effect combination/);
  });
});

describe("choosing the format", () => {
  it("never uses the last ad's format twice in a row, and favours the best scored", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const r = pickRecipe({ recent: ["loop_story"], rng: seededRandom(i) });
      expect(r.id).not.toBe("loop_story");
      counts[r.id] = (counts[r.id] ?? 0) + 1;
    }
    expect(counts.twist).toBeGreaterThan(counts.testimonial_screens ?? 0);
  });
});
