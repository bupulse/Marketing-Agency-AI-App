import { describe, expect, it } from "vitest";
import { checkLanguage } from "@/lib/video-engine/brain/language";
import { AVOID_PENALTY, LAB_BONUS, VIRAL, pickViral, scoreViral, seededRandom, viralRecipe, type RecipeInput } from "@/lib/video-engine/brain/viral";
import type { ViralVideo } from "@/lib/video-engine/brain/viral-ingest";

const input = (over: Partial<RecipeInput> = {}): RecipeInput => ({ sector: "agriculture", product: "Hydro Tower", platform: "instagram", country: "Rwanda", language: "English", purpose: "ad", seconds: 30, hasPrice: true, hasPhone: true, footage: { generated: true }, seed: "job-1", ...over });
const labRow = (over: Partial<ViralVideo> = {}): ViralVideo => ({ ...VIRAL[0], id: "lab:one", sector: "agriculture", country: "RW", region: "east-africa", platform: "instagram", strength: 0.5, group: "lab:one", hookType: "curiosity", needs: ["filmed"], ...over });

describe("viral recipe without a Lab", () => {
  it("is the same recipe with no lab, an empty lab and an empty avoid list", () => {
    const today = viralRecipe(input());
    expect(viralRecipe(input({ lab: [], avoid: [] }))).toEqual(today);
    for (const seed of ["a", "b", "c"]) expect(viralRecipe(input({ seed, lab: [] }))).toEqual(viralRecipe(input({ seed })));
  });
  it("keeps the curated scores and order when a Lab row joins", () => {
    const base = scoreViral(input());
    const withLab = scoreViral(input({ lab: [labRow()] }));
    const curated = withLab.filter((s) => !s.v.id.startsWith("lab:"));
    expect(curated.map((s) => [s.v.id, s.score])).toEqual(base.map((s) => [s.v.id, s.score]));
  });
});

describe("a Lab reel in the pool", () => {
  it("scores with a bonus of at most 15, and keeps feasible and the opening rules", () => {
    expect(LAB_BONUS).toBeLessThanOrEqual(15);
    const plain = scoreViral(input({ lab: [labRow()] })).find((s) => s.v.id === "lab:one")!;
    expect(plain.why).toContain("BuPulse's Training Lab");
    const person = labRow({ id: "lab:two", group: "lab:two", needs: ["person"] });
    const out = pickViral(input({ footage: { phoneClips: 0 }, lab: [person] }), seededRandom("job-1"));
    expect(out.some((s) => s.v.id === "lab:two")).toBe(false);
  });
  it("can be picked, and then appears in the recipe sources", () => {
    const strong = Array.from({ length: 6 }, (_, i) => labRow({ id: `lab:s${i}`, group: `lab:s${i}`, hookType: ["question", "pov", "reveal", "demo", "problem", "announcement"][i], strength: 1 }));
    let found = false;
    for (let i = 0; i < 20 && !found; i++) found = viralRecipe(input({ seed: `p${i}`, lab: strong })).sources.some((s) => s.id.startsWith("lab:"));
    expect(found).toBe(true);
  });
  it("is not drawn again right after use (recent works with lab ids)", () => {
    const rows = [labRow()];
    const first = scoreViral(input({ lab: rows })).find((s) => s.v.id === "lab:one")!;
    const recent = [{ ...viralRecipe(input({ lab: rows })), sources: [{ id: "lab:one", used: ["opening"] }] }] as unknown as RecipeInput["recent"];
    const again = scoreViral(input({ lab: rows, recent })).find((s) => s.v.id === "lab:one")!;
    expect(again.score).toBeLessThan(first.score);
  });
});

describe("avoid", () => {
  it("subtracts for a matching id or opening type, and filters nothing out", () => {
    const base = scoreViral(input());
    const target = base[0].v;
    const byId = scoreViral(input({ avoid: [target.id] }));
    expect(byId).toHaveLength(base.length);
    expect(byId.find((s) => s.v.id === target.id)!.score).toBe(Math.round((base[0].score - AVOID_PENALTY) * 10) / 10);
    const sameType = base.filter((s) => s.v.hookType === target.hookType);
    const byType = scoreViral(input({ avoid: [target.hookType] }));
    for (const s of sameType) expect(byType.find((x) => x.v.id === s.v.id)!.score).toBeLessThan(s.score);
    const other = base.find((s) => s.v.hookType !== target.hookType)!;
    expect(byType.find((x) => x.v.id === other.v.id)!.score).toBe(other.score);
  });
  it("applies to Lab rows too", () => {
    const a = scoreViral(input({ lab: [labRow()] })).find((s) => s.v.id === "lab:one")!;
    const b = scoreViral(input({ lab: [labRow()], avoid: ["lab:one"] })).find((s) => s.v.id === "lab:one")!;
    expect(b.score).toBeCloseTo(a.score - AVOID_PENALTY, 5);
    expect(viralRecipe(input({ avoid: VIRAL.map((v) => v.id) })).sources.length).toBeGreaterThan(0);
  });
});

describe("checkLanguage extras", () => {
  const text = [{ where: "caption", text: "Call now for the Hydro Tower", kind: "caption" as const }];
  it("is unchanged without extras", () => {
    expect(checkLanguage(text, "Kinyarwanda", {})).toEqual(checkLanguage(text, "Kinyarwanda"));
  });
  it("drops an issue only for the exact approved word", () => {
    const base = checkLanguage(text, "Kinyarwanda");
    expect(base.some((i) => i.code === "english-cta")).toBe(true);
    expect(checkLanguage(text, "Kinyarwanda", { words: ["Call Now"] }).some((i) => i.code === "english-cta")).toBe(false);
    expect(checkLanguage(text, "Kinyarwanda", { words: ["call"] })).toEqual(base);
  });
  it("adds the owner's wrong spellings in the same shape, whole words only", () => {
    const t = [{ where: "scene 2 text", text: "Murakaza neza, igiciro kiri hasi", kind: "screen" as const }, { where: "scene 2 voice", text: "igiciro", kind: "voice" as const }];
    const out = checkLanguage(t, "Kinyarwanda", { wrong: [{ word: "igiciro", fix: "igiciro:" }, { word: "kiri hasi" }, { word: "cir" }] });
    const mine = out.filter((i) => i.code === "owner-spelling");
    expect(mine).toEqual([
      { code: "owner-spelling", where: "scene 2 text", found: "igiciro", message: '"igiciro" is a spelling you marked wrong; write "igiciro:" instead.', suggestion: "igiciro:" },
      { code: "owner-spelling", where: "scene 2 text", found: "kiri hasi", message: '"kiri hasi" is a spelling you marked wrong.', suggestion: null },
    ]);
  });
  it("does not change the texts or the extras", () => {
    const extra = Object.freeze({ words: Object.freeze(["x"]) as unknown as string[], wrong: Object.freeze([Object.freeze({ word: "y" })]) as unknown as { word: string }[] });
    expect(() => checkLanguage(Object.freeze(text) as never, "English", extra)).not.toThrow();
  });
});
