import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { carriesCta, ctaById, ctaOf, CTAS, pickCta } from "@/lib/ad-brain/ctas";
import { pickEffects, seededRandom } from "@/lib/ad-brain/effects";
import { validateEdl } from "@/lib/ad-brain/edl";
import { wallFixture } from "@/lib/ad-brain/fixtures";
import { assetNeeds, buildEdl, type AssetNeed, type Concept, type MadeAsset, type ScreenCapture } from "@/lib/ad-brain/plan";
import { hasSlopWords, REAL_PERSON_PHOTO, realistic } from "@/lib/ad-brain/realism";
import { pickRecipe, recipeById, recipeEffects, recipesOfKind, RECIPES, type AdKind } from "@/lib/ad-brain/recipes";
import { checkScript, type Script } from "@/lib/ad-brain/script-rules";
import { alternativeCtas, cleanVariantSpec, hookBeatOf, planVariants } from "@/lib/ad-brain/variants";

const brand = { name: "BuPulse", url: "bupulse.com", primary: "#2f6bff", accent: "#7b5cff", logoRef: "repo:public/icon.png" };
const screens: ScreenCapture[] = ["posts", "cards", "calendar", "home", "brand"].map((id) => ({ id, page: "Posts", label: id, capturedAt: "2026-11-10", ref: `ad:${id}`, crop: [0, 0, 1, 1] }));
const words = (text: string, start: number) => text.split(" ").map((w, i) => ({ w, s: start + i * 0.4, e: start + i * 0.4 + 0.35 }));

/** Every asset the planner asked for, "made" with believable timings (no paid call). */
function makeAll(needs: AssetNeed[]): Record<string, MadeAsset> {
  const made: Record<string, MadeAsset> = {};
  for (const n of needs) {
    if (n.kind === "frame") made[n.key] = { key: n.key, ref: `ad:${n.key}`, kind: "image" };
    else if (n.kind === "clip") made[n.key] = { key: n.key, ref: `ad:${n.key}`, kind: "video", seconds: 8, ...(n.speech ? { words: words(n.speech, 0.6) } : {}) };
    else if (n.kind === "voice") made[n.key] = { key: n.key, ref: `ad:${n.key}`, kind: "audio", seconds: n.text.split(" ").length * 0.4 + 0.3, words: words(n.text, 0.1) };
    else made[n.key] = { key: n.key, ref: `ad:${n.key}`, kind: "audio", seconds: 30.7, bpm: 120, firstBeat: 0.4 };
  }
  return made;
}

function conceptFor(id: string, kind: AdKind = "ad", ctaId?: string): Concept {
  const recipe = recipeById(id)!;
  const effects = pickEffects({ allowed: recipeEffects(recipe), required: recipe.required, recent: [], rng: seededRandom(id) });
  return { recipe: id, effects, kind, ...(ctaId ? { ctaId } : {}), captionStyle: recipe.captionStyles[0], titleStyle: recipe.titleStyles[0], musicMood: recipe.musicMoods[0], line: "A test concept." };
}

const person = [{ id: "aline", gender: "woman" as const, look: "A Rwandan woman, early 30s, short braids, faded green t-shirt, in her tin-roofed Kigali shop" }];
const tail = { caption: "A week of posts, planned.", hashtags: ["BuPulse"], endCard: { headline: "Your week, planned", button: "Try it", sub: "" } };

describe("the CTA list", () => {
  it("matches the research file, one CTA each", () => {
    const research = JSON.parse(readFileSync("docs/research/ad-formats.json", "utf8")) as { ctas: { text: string }[] };
    expect(CTAS.map((c) => c.text)).toEqual(research.ctas.map((c) => c.text));
    // Each spoken line carries its own CTA, so the checks recognise what the actor says.
    for (const c of CTAS) expect(ctaOf(c.spoken)?.id).toBe(c.id);
  });

  it("rotates: never one of the last three, soft only for content", () => {
    for (let i = 0; i < 40; i++) {
      const rng = seededRandom(`cta${i}`);
      const ad = pickCta({ kind: "ad", recent: ["link-in-bio", "request-quote", "whatsapp"], rng });
      expect(["link-in-bio", "request-quote", "whatsapp"]).not.toContain(ad.id);
      expect(pickCta({ kind: "content", recent: [], rng }).tone).toBe("soft");
    }
    // A format's own CTAs come first.
    expect(pickCta({ kind: "ad", recent: [], rng: () => 0.5, preferred: ["comment-ad"] }).id).toBe("comment-ad");
    // When every one was used lately, it still answers.
    expect(pickCta({ kind: "content", recent: CTAS.map((c) => c.id), rng: () => 0.1 }).tone).toBe("soft");
  });

  it("recognises a CTA said in the actor's own words", () => {
    expect(carriesCta("If you want one, click the link in my bio.", ctaById("link-in-bio")!)).toBe(true);
    expect(carriesCta("Go to BuPulse dot com.", ctaById("save-this")!)).toBe(false);
  });
});

describe("real-looking people", () => {
  it("cleans slop words out of what the brain writes", () => {
    const cleaned = realistic("A stunning, cinematic portrait of a woman, flawless skin, studio lighting, in her shop");
    expect(hasSlopWords(cleaned)).toBe(false);
    expect(cleaned).toMatch(/portrait of a woman/);
    expect(cleaned).toMatch(/in her shop/);
  });

  it("uses the owner's proven prompt for every person picture", () => {
    const needs = assetNeeds(recipeById("split_reveal")!, { characters: [{ ...person[0], look: `${person[0].look}, cinematic` }], beats: [], cta: { speaker: "aline", text: "Click the link in bio.", source: "omni" }, ...tail }, conceptFor("split_reveal"));
    const portrait = needs.find((n) => n.key === "char:aline");
    expect(portrait?.kind === "frame" && portrait.prompt).toContain(REAL_PERSON_PHOTO);
    expect(portrait?.kind === "frame" && hasSlopWords(portrait.prompt.replace(REAL_PERSON_PHOTO, ""))).toBe(false);
  });

  it("adds the real product photo as a reference when a beat shows a product", () => {
    const recipe = recipeById("behind_scenes")!;
    const stillBeat = recipe.beats.find((b) => b.picture === "still" || b.picture === "clip")!;
    const script: Script = { characters: person, beats: [{ beat: stillBeat.id, scene: "She holds up the new bag at the counter.", product: "p1", line: stillBeat.speech === "line" ? { speaker: "aline", text: "This one sold out in a day.", source: "omni" } : null }], cta: { speaker: "aline", text: "Save this for later.", source: "omni" }, ...tail };
    const needs = assetNeeds(recipe, script, conceptFor("behind_scenes", "content"), [{ id: "p1", name: "Woven bag", path: "biz/p1.jpg" }]);
    const frame = needs.find((n) => n.kind === "frame" && n.product);
    expect(frame?.kind === "frame" && frame.product).toEqual({ name: "Woven bag", path: "biz/p1.jpg" });
  });
});

describe("recipes by kind", () => {
  it("tags every recipe and keeps each kind's own formats", () => {
    for (const r of RECIPES) expect(r.kinds.length).toBeGreaterThan(0);
    expect(recipesOfKind("content").map((r) => r.id)).toEqual(expect.arrayContaining(["things_i_wish", "behind_scenes", "day_in_life"]));
    expect(recipesOfKind("ad").map((r) => r.id)).toEqual(expect.arrayContaining(["twist", "split_reveal", "sixty_second", "identity_reveal", "poster_wall"]));
    for (let i = 0; i < 30; i++) expect(pickRecipe({ recent: [], rng: seededRandom(`k${i}`), kind: "content" }).kinds).toContain("content");
  });

  it("every recipe's CTAs and effects exist", () => {
    for (const r of RECIPES) for (const id of r.ctas ?? []) expect(ctaById(id), `${r.id}: ${id}`).toBeDefined();
  });
});

describe("variants", () => {
  const recipe = recipeById("split_reveal")!;
  const script: Script = {
    characters: person,
    beats: [
      { beat: "hook", line: { speaker: "aline", text: "Watch this. I'm not touching anything.", source: "omni" }, screens: [{ id: "posts", title: "WATCH" }] },
      { beat: "demo", line: { speaker: "aline", text: "It writes the posts in my voice.", source: "omni" }, screens: [{ id: "cards", title: "" }] },
      { beat: "payoff", line: { speaker: "aline", text: "One tap and the week is planned.", source: "omni" }, screens: [{ id: "calendar", title: "" }] },
    ],
    cta: { speaker: "aline", text: "Click the link in bio to try BuPulse.", source: "omni" },
    ...tail,
  };

  it("keeps the request inside the limits", () => {
    expect(cleanVariantSpec({ hooks: 9, ctas: 9 })).toEqual({ hooks: 3, ctas: 2 });
    expect(cleanVariantSpec({ hooks: 1, ctas: 1 })).toBeNull();
    expect(cleanVariantSpec("nonsense")).toBeNull();
  });

  it("makes every other hook and CTA combination, changing only those lines", () => {
    const own = ctaById("link-in-bio")!;
    const v = planVariants({ script, recipe, spec: { hooks: 3, ctas: 2 }, hooks: ["Nobody plans my posts anymore.", "Is this cheating?"], ownCta: own, ctas: alternativeCtas(own, 1, "ad") });
    expect(v).toHaveLength(5);
    expect(v.map((x) => x.label)).toEqual(["hook 1 · CTA 2", "hook 2 · CTA 1", "hook 2 · CTA 2", "hook 3 · CTA 1", "hook 3 · CTA 2"]);
    expect(hookBeatOf(recipe)).toBe("hook");
    const h2c2 = v[2];
    expect(h2c2.script.beats[0].line?.text).toBe("Nobody plans my posts anymore.");
    expect(h2c2.script.beats.slice(1)).toEqual(script.beats.slice(1));
    expect(h2c2.script.cta.text).not.toBe(script.cta.text);
    expect(ctaOf(h2c2.script.cta.text)?.id).toBe(h2c2.ctaId);
    // The original combination is never made again.
    expect(v.some((x) => x.hook === 0 && x.cta === 0)).toBe(false);
  });

  it("keeps content variants to soft CTAs", () => {
    expect(alternativeCtas(ctaById("save-this"), 5, "content").every((c) => c.tone === "soft" && c.id !== "save-this")).toBe(true);
  });
});

describe("the planner for the new formats", () => {
  it("split reveal: a person above a real screen, the CTA full frame", () => {
    const recipe = recipeById("split_reveal")!;
    const concept = conceptFor("split_reveal", "ad", "link-in-bio");
    const script: Script = {
      characters: person,
      beats: [
        { beat: "hook", line: { speaker: "aline", text: "Watch this. I'm not touching anything.", source: "omni" }, title: "NOT TOUCHING IT", screens: [{ id: "posts", title: "" }] },
        { beat: "demo", line: { speaker: "aline", text: "It writes the posts in my voice.", source: "omni" }, screens: [{ id: "cards", title: "" }] },
        { beat: "payoff", line: { speaker: "aline", text: "One tap and the week is planned.", source: "omni" }, screens: [{ id: "calendar", title: "" }] },
      ],
      cta: { speaker: "aline", text: "Click the link in bio to try BuPulse.", source: "omni" },
      ...tail,
    };
    expect(checkScript(script, { brandName: "BuPulse", url: "bupulse.com", facts: "", beats: recipe.beats.map((b) => ({ id: b.id, speech: b.speech, picture: b.picture, titleWords: b.titleWords, screens: b.screens })), screenIds: screens.map((s) => s.id), cta: ctaById("link-in-bio") })).toEqual([]);
    const needs = assetNeeds(recipe, script, concept);
    const edl = buildEdl({ recipe, script, concept, made: makeAll(needs), screens, brand });
    const check = validateEdl(edl);
    expect(check.errors).toEqual([]);
    expect(edl.kind).toBe("ad");
    expect(edl.ctaId).toBe("link-in-bio");
    expect(edl.segments.filter((s) => s.source === "split")).toHaveLength(3);
    expect(edl.voice.at(-1)?.cta).toBe(true);
  });

  it("60-second challenge: an honest clock over the real screens", () => {
    const recipe = recipeById("sixty_second")!;
    const concept = conceptFor("sixty_second", "ad", "tap-link");
    expect(concept.effects).toContain("timer");
    const script: Script = {
      characters: person,
      beats: [
        { beat: "hook", line: { speaker: "aline", text: "One minute. A full week of posts for my shop. Go.", source: "omni" }, title: "ONE MINUTE" },
        { beat: "race", screens: [{ id: "posts", title: "CAPTIONS" }, { id: "cards", title: "DESIGNS" }, { id: "calendar", title: "SCHEDULED" }] },
        { beat: "finish", line: { speaker: "aline", text: "Done. Time check, still under a minute.", source: "omni" } },
      ],
      cta: { speaker: "aline", text: "Tap the link, it takes a minute.", source: "tts" },
      ...tail,
    };
    const needs = assetNeeds(recipe, script, concept);
    const edl = buildEdl({ recipe, script, concept, made: makeAll(needs), screens, brand });
    expect(validateEdl(edl).errors).toEqual([]);
    const race = edl.segments.filter((s) => s.source === "real_screen");
    expect(race.length).toBe(3);
    expect(race.some((s) => s.effects.some((e) => e.id === "timer"))).toBe(true);
  });

  it("things I wish I knew: content, the tips said over real screens with numbered titles", () => {
    const recipe = recipeById("things_i_wish")!;
    const concept = conceptFor("things_i_wish", "content", "save-this");
    const script: Script = {
      characters: person,
      beats: [
        { beat: "hook", line: { speaker: "aline", text: "Three things I wish somebody told me about posting for my shop.", source: "omni" }, title: "3 THINGS I WISH" },
        { beat: "tips", line: { speaker: "aline", text: "Post every week, use your own photos, and answer every comment the same day.", source: "tts" }, screens: [{ id: "calendar", title: "1. POST EVERY WEEK" }, { id: "brand", title: "2. YOUR OWN PHOTOS" }, { id: "home", title: "3. ANSWER FAST" }] },
      ],
      cta: { speaker: "aline", text: "Save this for later.", source: "tts" },
      ...tail,
    };
    const needs = assetNeeds(recipe, script, concept);
    const edl = buildEdl({ recipe, script, concept, made: makeAll(needs), screens, brand });
    expect(validateEdl(edl).errors).toEqual([]);
    expect(edl.kind).toBe("content");
    const tips = edl.segments.filter((s) => s.source === "real_screen");
    expect(tips).toHaveLength(3);
    // The narration covers the screens.
    const narration = edl.voice.find((v) => v.text.startsWith("Post every week"))!;
    expect(narration.at).toBeGreaterThanOrEqual(tips[0].start - 0.01);
    expect(narration.at).toBeLessThan(tips[2].end);
  });

  it("poster wall: the cached plan passes every check", () => {
    const check = validateEdl(wallFixture());
    expect(check.errors).toEqual([]);
    expect(check.edl!.wall?.picks.length).toBeGreaterThanOrEqual(3);
    expect(check.edl!.segments.some((s) => s.source === "wall")).toBe(true);
    expect(check.edl!.voice.at(-1)?.cta).toBe(true);
  });
});
