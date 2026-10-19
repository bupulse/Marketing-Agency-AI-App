import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildIndex, captionShape, namesToScrub, needsOf, parseRows, scrub, strengthOf, textPattern, viralFromRow } from "@/lib/video-engine/brain/viral-ingest";
import { VIRAL, bandY, describeViral, feasible, pickViral, recipeText, recipeWhy, seededRandom, viralById, viralRecipe, withoutFigures, type RecipeInput, type ViralRecipe } from "@/lib/video-engine/brain/viral";
import { SAFE_AREAS, scoreDesign, type ScoreBrief } from "@/lib/video-engine/brain/score";
import { briefText, clipsText, designVideo, placeClips, recipeForBrief, type ClaudeTransport, type DesignBrief } from "@/lib/video-engine/designer";
import { sampleSpec } from "@/lib/video-engine/sample";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { VIRAL_STYLE_ID } from "@/lib/video-engine/templates";

const VIRAL_DIR = path.join(process.cwd(), "docs/research/viral");
const rawRows = () => ["tiktok", "instagram", "facebook", "youtube"].flatMap((p) => (fs.existsSync(path.join(VIRAL_DIR, `${p}.jsonl`)) ? parseRows(fs.readFileSync(path.join(VIRAL_DIR, `${p}.jsonl`), "utf8")).rows : []));

const row = (over: Record<string, unknown> = {}) => ({
  id: "vt-tt-900",
  platform: "tiktok",
  url: "https://www.tiktok.com/@nova_shop_rw/video/1",
  account: "@nova_shop_rw",
  account_name: "Novashop Kigali",
  followers: 1000,
  country: "RW",
  city: "Kigali",
  language: "en",
  sector: "phone-shop",
  kind: "business",
  is_ad: false,
  duration_s: 15,
  views: 120000,
  likes: 3000,
  viral_ratio: 120,
  viral_basis: "views 120x followers",
  caption: "Galaxy A56 kuri 420k gusa 🔥\n📍 Kigali, next to Simba\nWhatsApp 0788 123 456 #kigali #phones",
  hashtags: ["kigali", "phones"],
  hook_text: "Galaxy A56 at 420k, Novashop Kigali",
  hook_type: "price-banner",
  first_3s: "Hand holds the phone to camera at Novashop; title with the price 420k at the top; call 0788 123 456",
  structure: [
    { from: 0, to: 3, beat: "hook", what: "phone held up, price in a yellow box" },
    { from: 3, to: 11, beat: "demo", what: "three features, one cut each, www.novashop.rw on screen" },
    { from: 11, to: 15, beat: "cta", what: "WhatsApp 0788 123 456, shop sign" },
  ],
  cuts_per_10s: 5,
  camera: "handheld phone",
  visual_style: "shop counter, daylight",
  on_screen_text: ["Galaxy A56 420k", "WhatsApp 0788 123 456", "@nova_shop_rw"],
  text_style: "white bold in a yellow box at the top; phone number strip at the bottom the whole clip",
  voice: "none, music only",
  music_mood: "afro, mid-tempo",
  price_shown: true,
  phone_shown: true,
  location_shown: true,
  cta: "WhatsApp 0788 123 456",
  format: "offer",
  why_viral: "Novashop shows the price first; the video loops back to the phone.",
  lesson_for_engine: "Price in frame 1.",
  top_comments: [{ text: "Angahe kuri iyi ya blue?", likes: 3, category: "price-question" }],
  frames: ["video-lab/data/viral/frames/tiktok/vt-tt-900/f1.jpg"],
  watched: true,
  scam: false,
  notes: "",
  ...over,
});

describe("the viral index (viral-ingest.ts)", () => {
  it("keeps how the video was made and leaves out the caption, the account, the frames and the comments", () => {
    const r = row();
    const v = viralFromRow(r, namesToScrub([r]))!;
    const all = JSON.stringify(v);
    expect(v).toMatchObject({ id: "vt-tt-900", platform: "tiktok", country: "RW", region: "east-africa", sector: "phone-shop", hookType: "price-banner", format: "offer", priceShown: true, phoneShown: true, loop: true, cutsPer10s: 5 });
    for (const gone of ["Novashop", "nova_shop_rw", "0788 123 456", "novashop.rw", "Angahe", "f1.jpg", "next to Simba", "tiktok.com"]) expect(all).not.toContain(gone);
    expect(v.textPatterns).toEqual(["Galaxy A56 {price}", "WhatsApp {phone}", "{business}"]);
    expect(v.caption).toMatchObject({ lines: 3, hashtags: 2, price: true, phone: true, place: true, emoji: true });
    expect(v.beats.map((b) => b.role)).toEqual(["hook", "show", "cta"]);
  });

  it("takes out phone numbers, web addresses, @mentions and named people, and keeps product brands other accounts use", () => {
    const other = { hook_text: "A phone", why_viral: "Price first.", structure: [] };
    const names = namesToScrub([row(), row({ ...other, id: "vt-tt-901", account: "@other", account_name: "Other Phones", first_3s: "A Samsung Galaxy in hand" }), row({ ...other, id: "vt-tt-902", account: "@third", account_name: "Third", first_3s: "a Samsung box" })]);
    expect(scrub("Call +250 788 123 456 or visit https://nova.rw, @someone", names)).toBe("Call the number or visit the website the business");
    expect(scrub("DR. BOSCO explains", names)).toBe("the doctor explains");
    expect(textPattern("DR. BOSCO / Clinic", names)).toBe("DR. {name} / Clinic");
    expect(names).not.toContain("Samsung");
    expect(scrub("A Samsung Galaxy at Novashop", names)).toBe("A Samsung Galaxy at the business");
  });

  it("reads what remaking a video needs", () => {
    expect(needsOf({ camera: "none, graphic poster with a slow push", first_3s: "poster frame", structure: [] })).toEqual(["photos"]);
    expect(needsOf({ camera: "handheld", first_3s: "a hand turns the shoe", structure: [], format: "product-reveal" })).toEqual(["filmed", "ai-ok"]);
    expect(needsOf({ camera: "gimbal walk", first_3s: "the door opens", structure: [], format: "tour" })).toEqual(["filmed"]);
    expect(needsOf({ camera: "selfie, talking to camera", first_3s: "owner talks", structure: [] })).toEqual(["filmed", "person"]);
  });

  it("weighs how viral a video was, and says it in plain words", () => {
    expect(strengthOf({ views: 1_200_000, viral_ratio: 300 })).toMatchObject({ strength: 0.99, reach: "1.2M views, 300x the account's followers" });
    expect(strengthOf({ viral_basis: "ad running 614 days (since 2025-02-12); 13 live ads from this page" })).toMatchObject({ strength: 1, reach: "an ad running 614 days, 13 versions live" });
    expect(strengthOf({}).strength).toBe(0.2);
    expect(captionShape("", [])).toMatchObject({ lines: 0, price: false, phone: false });
  });

  it("refreshes cleanly: bad lines are skipped, ids are unique and sorted, scams are left out", () => {
    const { rows, bad } = parseRows(`${JSON.stringify(row({ id: "vt-tt-905" }))}\n{"half":\n\n${JSON.stringify(row({ id: "vt-tt-903" }))}\n${JSON.stringify(row({ id: "vt-tt-904", scam: true }))}\n${JSON.stringify(row({ id: "vt-tt-903", sector: "fashion" }))}`);
    expect(bad).toEqual([2]);
    const index = buildIndex(rows);
    expect(index.map((v) => v.id)).toEqual(["vt-tt-903", "vt-tt-905"]);
    expect(index[0].sector).toBe("fashion");
  });

  it("the shipped index holds every library row, with no account names, captions or comments", () => {
    const rows = rawRows();
    const ids = new Set(rows.filter((r) => r.scam !== true).map((r) => r.id));
    expect(VIRAL.length).toBeGreaterThanOrEqual(300);
    // Every indexed id is a library row (TikTok rows still being collected may not be indexed yet).
    for (const v of VIRAL) expect(ids.has(v.id)).toBe(true);
    const all = JSON.stringify(VIRAL).toLowerCase();
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const r of rows) {
      for (const name of [String(r.account_name ?? ""), String(r.account ?? "").replace(/^@/, "")]) {
        if (name.length >= 4) expect(new RegExp(`(?<![\\p{L}\\p{N}])${esc(name.toLowerCase())}(?![\\p{L}\\p{N}])`, "u").test(all), `${r.id} name`).toBe(false);
      }
      for (const c of (r.top_comments as { text?: string }[] | undefined) ?? []) if ((c.text ?? "").length > 15) expect(all.includes(c.text!.toLowerCase()), `${r.id} comment`).toBe(false);
      const caption = String(r.caption ?? "");
      if (caption.length > 80) expect(all.includes(caption.toLowerCase())).toBe(false);
    }
    expect(all).not.toMatch(/\.jpg|https?:\/\//);
  });
});

const leaf: RecipeInput = { sector: "agriculture", product: "LEAF Hydro Tower", platform: "instagram", country: "Rwanda", language: "English", purpose: "ad", seconds: 15, hasPrice: true, hasPhone: true, seed: "job-1" };
const opening = (r: ViralRecipe) => viralById(r.opening.source)!;

describe("the viral recipe (viral.ts)", () => {
  it("is the same for the same seed, and different for another seed", () => {
    expect(viralRecipe(leaf)).toEqual(viralRecipe(leaf));
    const many = Array.from({ length: 8 }, (_, i) => viralRecipe({ ...leaf, seed: `job-${i}` }));
    expect(new Set(many.map((r) => r.sources.map((s) => s.id).sort().join())).size).toBeGreaterThanOrEqual(6);
    expect(new Set(many.map((r) => r.opening.source)).size).toBeGreaterThanOrEqual(4);
  });

  it("picks 3 to 5 videos from different accounts, close sectors first, East Africa first", () => {
    for (let i = 0; i < 10; i++) {
      const picks = pickViral({ ...leaf, seed: `s${i}` }, seededRandom(`s${i}`));
      expect(picks.length).toBeGreaterThanOrEqual(3);
      expect(picks.length).toBeLessThanOrEqual(5);
      expect(new Set(picks.map((p) => p.v.group)).size).toBe(picks.length);
    }
    const phone = pickViral({ ...leaf, sector: "phone-shop", seed: "p" }, seededRandom("p"));
    expect(phone.filter((p) => p.v.sector === "phone-shop" || p.v.sector === "shop").length).toBeGreaterThanOrEqual(2);
    const all = Array.from({ length: 10 }, (_, i) => pickViral({ ...leaf, seed: `e${i}` }, seededRandom(`e${i}`))).flat();
    expect(all.filter((p) => p.v.region === "east-africa").length / all.length).toBeGreaterThan(0.6);
  });

  it("mixes techniques: never the opening and the beats of one video, and every pick lends something", () => {
    for (let i = 0; i < 12; i++) {
      const r = viralRecipe({ ...leaf, seed: `m${i}` });
      expect(r.sources.length).toBeGreaterThanOrEqual(3);
      expect(r.sources.flatMap((s) => s.uses)).toEqual(expect.arrayContaining(["opening", "beats", "pace", "text", "camera", "caption"]));
      expect(r.sources.find((s) => s.uses.includes("opening"))!.id).not.toBe(r.sources.find((s) => s.uses.includes("beats"))!.id);
      for (const s of r.sources) expect(viralById(s.id)).not.toBeNull();
    }
  });

  it("scales the beats to the length: from 0 to the end, in order, opening first, how to order last", () => {
    for (const seconds of [8, 15, 30]) {
      const r = viralRecipe({ ...leaf, seconds, seed: `b${seconds}` });
      expect(r.beats[0]).toMatchObject({ from: 0, role: "hook" });
      expect(r.beats[r.beats.length - 1]).toMatchObject({ to: seconds, role: "cta" });
      r.beats.slice(1).forEach((b, i) => expect(b.from).toBe(r.beats[i].to));
      for (const b of r.beats) expect(b.to - b.from).toBeGreaterThanOrEqual(1.5);
      expect(r.order).toBe(r.beats.map((b) => b.role).join("-"));
    }
  });

  it("avoids the business's recent recipes: another opening, and another layout or beat order", () => {
    let recent: ViralRecipe[] = [];
    for (let i = 0; i < 5; i++) {
      const r = viralRecipe({ ...leaf, seed: `r${i}`, recent });
      for (const old of recent.slice(0, 1)) {
        expect(r.opening.hookType).not.toBe(old.opening.hookType);
        expect(r.layout !== old.layout || r.order !== old.order).toBe(true);
      }
      recent = [r, ...recent];
    }
  });

  it("with photos only, opens and builds from videos photos can remake; phone clips and AI clips open the rest", () => {
    for (let i = 0; i < 8; i++) {
      const r = viralRecipe({ ...leaf, seed: `f${i}` });
      expect(opening(r).needs).toContain("photos");
      expect(r.clipNeeds).toEqual([]);
      expect(r.beats.every((b) => b.footage === "photo")).toBe(true);
    }
    const phone = viralRecipe({ ...leaf, seed: "clips", footage: { phoneClips: 3 } });
    expect(phone.clipNeeds.filter((n) => n.source === "phone").length).toBe(3);
    expect(phone.clipNeeds.every((n) => n.source === "phone" && [4, 6, 8].includes(n.seconds) && n.shot.includes("LEAF Hydro Tower"))).toBe(true);
    const ai = viralRecipe({ ...leaf, seed: "ai", footage: { aiClips: true } });
    expect(feasible(opening(ai), { aiClips: true })).toBe(true);
    expect(ai.clipNeeds.filter((n) => n.source === "ai").length).toBeLessThanOrEqual(3);
    for (const n of ai.clipNeeds) expect(ai.beats[n.beat - 1].footage).toBe("ai");
  });

  it("only uses facts the brief has: no price opening without a price, no price or contact push in a page post", () => {
    for (let i = 0; i < 8; i++) {
      const none = viralRecipe({ ...leaf, hasPrice: false, seed: `n${i}` });
      expect(none.price.at).toBe("none");
      expect(none.opening.check).not.toBe("price");
      expect(["price-banner", "number-in-hand", "price-on-each", "price-pill", "was-now"]).not.toContain(none.opening.hookType);
      const post = viralRecipe({ ...leaf, purpose: "post", seed: `p${i}` });
      expect(post).toMatchObject({ purpose: "post", price: { at: "none" }, phone: { at: "none" }, caption: { price: false, phone: false } });
    }
  });

  it("keeps text and the price inside the platform's safe area (Shorts: the price in the middle band)", () => {
    for (const platform of ["tiktok", "instagram", "facebook", "youtube"] as const) {
      const area = SAFE_AREAS[platform];
      for (const band of ["top", "middle", "bottom"] as const) {
        const [y0, y1] = bandY(band, platform);
        expect(y0).toBeGreaterThanOrEqual(area.top);
        expect(y1).toBeLessThanOrEqual(area.bottom);
      }
      const r = viralRecipe({ ...leaf, platform, seed: `sa-${platform}` });
      if (platform === "youtube") expect(r.price.band).toBe("middle");
      expect(r.caption.hashtags).toEqual({ tiktok: [4, 6], instagram: [3, 6], facebook: [0, 3], youtube: [1, 3] }[platform]);
    }
  });

  it("tells Claude the techniques and their sources, and the client why, never another business's name or prices", () => {
    const r = viralRecipe({ ...leaf, seed: "text" });
    const text = recipeText(r);
    expect(text).toMatch(/^Viral recipe/);
    for (const s of r.sources) expect(text).toContain(s.id);
    expect(text).toContain("every fact comes from the brief");
    const why = recipeWhy(r);
    expect(why[0]).toMatch(/^Opens like an? .+ with .+: /);
    expect(why.join(" ")).not.toMatch(/vt-|@|https?:/);
    expect(withoutFigures("plan table: 60 Mbps 25,000 Rwf, RWF 20K, 12k")).toBe("plan table: 60 Mbps [price], [price], [price]");
    expect(describeViral({ ...VIRAL[0], city: "Kigali", region: "east-africa", sector: "fashion", platform: "tiktok" })).toBe("a Kigali fashion TikTok");
  });
});

// ---- The designer and the score

const brief = (over: Partial<DesignBrief> = {}): DesignBrief => ({
  business: { name: "LEAF Rwanda", description: "Hydroponic farming kits in Kigali", language: "English", phone: "0788 300 400", country: "Rwanda" },
  product: { name: "LEAF Hydro Tower", summary: "A vertical hydroponic tower for 32 plants", price: "250,000 RWF", usps: ["Grows 32 plants in 1 square metre"] },
  photos: [{ base64: "", mediaType: "image/jpeg", width: 1080, height: 1350, note: "the tower on a balcony" }],
  styleId: VIRAL_STYLE_ID,
  hookId: "auto",
  ratio: "9:16",
  seconds: 15,
  platform: "instagram",
  ...over,
});
const answer = (spec: unknown): ClaudeTransport => async () => ({ text: JSON.stringify(spec), usage: { model: "claude-sonnet-5-5", inputTokens: 1, outputTokens: 1, costUsd: 0 }, stop: "end_turn" });
const sample = () => sampleSpec({ business: "LEAF Rwanda", product: "LEAF Hydro Tower", price: "250,000 RWF", photoCount: 1 }) as unknown as MotionSpec;

describe("designing from a viral recipe", () => {
  it("sends the recipe in place of the template line, with the research block's hooks as wording only", () => {
    const b = brief();
    const recipe = recipeForBrief(b, { seed: "d1" });
    const text = briefText({ ...b, recipe });
    expect(text).toContain("Viral recipe:");
    expect(text).not.toContain('Template "');
    expect(text).not.toContain("Opening hook:");
    expect(text).toContain("Hook wording ideas (the viral recipe sets the opening");
    expect(text).not.toMatch(/^Timeline \(/m);
    // A hook the owner picked still goes in.
    expect(briefText({ ...b, recipe, hookId: "question" })).toContain("Opening hook:");
  });

  it("leaves template videos exactly as they were", () => {
    const t = brief({ styleId: "product-hero" });
    const text = briefText(t);
    expect(text).toContain('Template "Product hero":');
    expect(text).not.toContain("Viral recipe");
    expect(briefText({ ...t, recipe: recipeForBrief(t, { seed: "x" }) })).toBe(text);
    const score = scoreDesign(sample(), t as ScoreBrief, { platform: "instagram" });
    expect([...score.passed, ...score.failed].some((c) => c.id.startsWith("recipe-"))).toBe(false);
  });

  it("reads the brief's facts into the recipe: sector, price, phone, place, length and footage", () => {
    const r = recipeForBrief(brief({ clips: [{ path: "/api/clip/abc1234567", source: "phone", seconds: 7, width: 1080, height: 1920 }] }), { seed: "facts", aiClips: true });
    expect(r).toMatchObject({ seconds: 15, platform: "instagram" });
    expect(r.clipNeeds.some((n) => n.source === "phone")).toBe(true);
    expect(recipeForBrief(brief({ product: { name: "LEAF Hydro Tower", price: null } }), { seed: "facts" }).price.at).toBe("none");
  });

  it("makes a recipe when the caller gave none, returns it, and scores the design against it", async () => {
    const out = await designVideo(brief(), { transport: answer(sample()) });
    expect(out.recipe?.version).toBe(1);
    const ids = [...out.score.passed, ...out.score.failed].map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["recipe-opening", "recipe-pace", "recipe-price", "recipe-phone", "recipe-length"]));
  });

  it("checks the opening, the pace, the price's place and the length", () => {
    const b = brief();
    const spec = sample();
    const base = recipeForBrief(b, { seed: "score" });
    const check = (recipe: ViralRecipe) => {
      const s = scoreDesign(spec, { ...b, recipe } as ScoreBrief, { platform: "instagram" });
      return Object.fromEntries([...s.passed.map((c) => [c.id, true]), ...s.failed.map((c) => [c.id, false])]);
    };
    const total = spec.scenes.reduce((n, sc) => n + sc.seconds, 0);
    const rate = (spec.scenes.length / total) * 10;
    expect(check({ ...base, seconds: Math.round(total), cuts: { ...base.cuts, per10s: [rate - 0.2, rate + 0.2] } })).toMatchObject({ "recipe-pace": true, "recipe-length": true });
    expect(check({ ...base, seconds: 30, cuts: { ...base.cuts, per10s: [rate + 3, rate + 4] } })).toMatchObject({ "recipe-pace": false, "recipe-length": false });
    expect(check({ ...base, opening: { ...base.opening, check: "question" } })["recipe-opening"]).toBe(spec.scenes[0].layers.some((l) => l.kind === "text" && l.text.includes("?")));
    expect(check({ ...base, opening: { ...base.opening, check: "text" } })["recipe-opening"]).toBe(true);
  });
});

describe("clips in a design", () => {
  const clips = [
    { path: "/api/clip/abc1234567", source: "phone" as const, seconds: 7.2, width: 1080, height: 1920, note: "the shop counter" },
    { path: "/videos/veo/vc-0123456789ab.mp4", source: "ai" as const, seconds: 6, width: 720, height: 1280 },
  ];

  it("tells Claude which clips there are and how to place one", () => {
    const text = clipsText(clips);
    expect(text).toContain("Clip 1 is a 7.2 s phone clip the owner filmed, 1080x1920 (the shop counter)");
    expect(text).toContain("Clip 2 is a 6 s AI clip");
    expect(text).toContain('kind: "video"; clip: number');
    expect(briefText(brief({ clips }))).toContain("Clips (real video you can place");
    expect(briefText(brief())).not.toContain("Clips (real video");
  });

  it("turns clip numbers into the clips' paths and drops clips the brief did not give", () => {
    const raw = { scenes: [{ layers: [{ kind: "video", clip: 1, start: 30, sound: true }, { kind: "text", text: "Hi" }] }, { layers: [{ kind: "video", clip: 3 }, { kind: "video", url: "https://evil.example/x.mp4" }, { kind: "video", clip: 2, start: 1 }] }] };
    placeClips(raw, clips);
    expect(raw.scenes[0].layers).toEqual([{ kind: "video", url: "/api/clip/abc1234567", start: 6.2, sound: false, clip: undefined }, { kind: "text", text: "Hi" }]);
    expect(raw.scenes[1].layers).toEqual([{ kind: "video", url: "/videos/veo/vc-0123456789ab.mp4", start: 1, sound: false, clip: undefined }]);
  });

  it("a design that places a clip keeps it as a video layer", async () => {
    const spec = sample() as unknown as { scenes: { layers: unknown[] }[] };
    spec.scenes[1].layers.unshift({ kind: "video", clip: 1, x: 0.5, y: 0.5, w: 1, h: 1 });
    const out = await designVideo(brief({ clips }), { transport: answer(spec) });
    expect(out.spec.scenes[1].layers.find((l) => l.kind === "video")).toMatchObject({ kind: "video", url: "/api/clip/abc1234567" });
  });
});
