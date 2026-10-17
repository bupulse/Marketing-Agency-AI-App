import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAIN, FORMATS, PLATFORMS, RESEARCH_SOURCES, SECTORS, checkBrain, checkLanguage, languageTextsOf, safeAreaFor, type BrainBrief, type BrainData, type Engine } from "@/lib/video-engine/brain";
import { evidenceFromRows, looksLikeScam, parseCount, parseDate, parseJsonl, rowKey, rowStrength, tiktokDate, variantsLive } from "@/lib/video-engine/brain/ingest";
import { SAFE_AREAS, amounts, hasKinyarwanda, scoreCaption, scoreDesign, scoreSeedancePrompt, templateStyle, type ScoreBrief } from "@/lib/video-engine/brain/score";
import { CONTEXT_MAX_CHARS, ENGINE_SECONDS, brainBriefFromDesign, brainBriefFromPrompt, brainContext, brainFor, formatFromTemplate, scaleTimeline, sectorFromText } from "@/lib/video-engine/brain/select";
import type { DesignBrief } from "@/lib/video-engine/designer";
import { BUSINESS_KINDS, SEEDANCE_FORMATS, SEEDANCE_TEMPLATES, planSeedanceShots } from "@/lib/video-engine/seedance-brain";
import { sampleSpec } from "@/lib/video-engine/sample";
import type { MotionSpec, Scene } from "@/lib/video-engine/spec";
import type { PromptBrief } from "@/lib/video-engine/seedance-prompt";
import { VIDEO_TEMPLATES, templateById } from "@/lib/video-engine/templates";

const REELS = path.join(process.cwd(), "docs/research/reels");
const refs = { claudeTemplates: VIDEO_TEMPLATES.map((t) => t.id), seedanceFormats: SEEDANCE_FORMATS.map((f) => f.id), seedanceKinds: BUSINESS_KINDS.map((k) => k.id) };
const base: BrainBrief = { platform: "tiktok", sector: "shop", format: null, engine: "claude", language: "English", hasPrice: true, hasPhone: true, seconds: 15 };

describe("the brain database", () => {
  it("every file parses and every reference resolves", () => {
    expect(checkBrain(BRAIN, refs)).toEqual([]);
  });

  it("has every format and sector, and enough hooks and rules", () => {
    expect(BRAIN.formats.map((f) => f.id).sort()).toEqual([...FORMATS].sort());
    expect(BRAIN.sectors.map((s) => s.id).sort()).toEqual([...SECTORS].sort());
    expect(BRAIN.hooks.length).toBeGreaterThanOrEqual(30);
    expect(BRAIN.rules.filter((r) => r.kind === "do").length).toBeGreaterThanOrEqual(30);
    expect(BRAIN.rules.filter((r) => r.kind === "dont").length).toBeGreaterThanOrEqual(10);
    expect(BRAIN.captions.platforms.map((p) => p.platform).sort()).toEqual([...PLATFORMS].sort());
  });

  it("every evidence row points at the researcher's row it came from", () => {
    for (const source of RESEARCH_SOURCES) {
      const file = path.join(REELS, `${source}.jsonl`);
      const index = BRAIN.evidence.filter((e) => e.source === source);
      if (!fs.existsSync(file)) {
        expect(index).toEqual([]);
        continue;
      }
      const rows = parseJsonl(fs.readFileSync(file, "utf8"));
      for (const e of index) {
        // The row at its line, or (when the file was reordered) the row with its key: run ingest.ts to refresh lines.
        const row = rows[e.line - 1];
        // A row whose hook was filled in since is still found by its URL (run ingest.ts to refresh the key).
        const found = row && (rowKey(row) === e.key || (e.url && row.url === e.url)) ? row : rows.find((r) => rowKey(r) === e.key || (e.url && r.url === e.url));
        expect(found, `${e.id} (${source} line ${e.line}) no longer matches a research row`).toBeTruthy();
      }
    }
  });

  it("the checker catches broken data", () => {
    const broken: BrainData = structuredClone(BRAIN);
    broken.hooks[0].evidence.push("tt-999999");
    broken.sectors[0].hooks.push("no-such-hook");
    broken.rules[0].engine = "robot" as never;
    broken.formats[0].timeline[1].from = 99;
    const problems = checkBrain(broken, refs);
    expect(problems.some((p) => p.includes('"tt-999999"'))).toBe(true);
    expect(problems.some((p) => p.includes('"no-such-hook"'))).toBe(true);
    expect(problems.some((p) => p.includes('engine "robot"'))).toBe(true);
    expect(problems.some((p) => p.includes("does not start where"))).toBe(true);
  });

  it("the do-not-copy list is in: fake income SMS, invented facts, body before/after", () => {
    const donts = BRAIN.rules.filter((r) => r.kind === "dont").map((r) => r.id);
    expect(donts).toEqual(expect.arrayContaining(["no-fake-income", "no-invented-facts", "no-body-before-after", "no-fake-customers", "no-made-up-superlative"]));
    expect(BRAIN.rules.find((r) => r.id === "no-fake-income")!.evidence).toEqual(expect.arrayContaining(["tt-085", "tt-087"]));
  });
});

describe("ingest (research rows to the evidence index)", () => {
  it("reads counts, TikTok upload dates and Ad Library dates", () => {
    expect(parseCount("16.6K")).toBe(16_600);
    expect(parseCount("1.1M")).toBe(1_100_000);
    expect(parseCount("1615")).toBe(1615);
    expect(parseCount(null)).toBeNull();
    expect(tiktokDate("https://www.tiktok.com/@x/video/7675433491580095765")).toBe("2026-08-18");
    expect(tiktokDate(null)).toBeNull();
    expect(parseDate("Jul 6, 2025")).toBe("2025-07-06");
    expect(parseDate("2026-03-09")).toBe("2026-03-09");
  });

  it("keeps ids when rows move and numbers new rows after the last id", () => {
    const a = { url: "https://www.tiktok.com/@a/video/7600000000000000000", author: "@a", hook: "first", watched: true, stats_as_reported: { likes: "10K" } };
    const b = { url: null, author: "@b", hook: "second", watched: true, language: "rw" };
    const first = evidenceFromRows("tiktok", [a, b]);
    expect(first.map((e) => e.id)).toEqual(["tt-001", "tt-002"]);
    expect(first[1].country).toBe("RW");
    const c = { url: null, author: "@c", hook: "third", secondary: true };
    const again = evidenceFromRows("tiktok", [c, b, a], first);
    expect(again.map((e) => e.id)).toEqual(["tt-003", "tt-002", "tt-001"]);
    expect(again[2].line).toBe(3);
    expect(again[0].strength).toBe(0.3);
  });
});

describe("income-chain and scam rows", () => {
  it("are flagged, their age and variants do not count, and only the fake-income don'ts may cite them", () => {
    const chain = { url: "https://www.facebook.com/ads/library/?id=1", page: "Akayabo Network", caption: "Tajyira Akakanya Gukorere Akayabo Kama Faranga! Earn 30K a day", running_days: 120, watched: true };
    const shop = { url: "https://www.facebook.com/ads/library/?id=2", page: "Shop", caption: "Galaxy A56 420,000 RWF", running_days: 120, watched: true };
    expect(looksLikeScam(chain)).toBe(true);
    expect(looksLikeScam(shop)).toBe(false);
    const [c, s2] = evidenceFromRows("facebook", [chain, shop]);
    expect(c.scam).toBe(true);
    expect(c.strength).toBe(0.2);
    expect(s2.scam).toBeUndefined();
    expect(s2.strength).toBeGreaterThan(0.3);
    const scam = BRAIN.evidence.find((e) => e.scam)!;
    const broken: BrainData = structuredClone(BRAIN);
    broken.hooks[0].evidence.push(scam.id);
    expect(checkBrain(broken, refs).some((p) => p.includes(`"${scam.id}" is an income-chain`))).toBe(true);
  });

  it("keeps a row's id when its hook is filled in later (found by its URL), and --no-new leaves new rows out", () => {
    const row = { url: "https://www.facebook.com/ads/library/?id=9", page: "Salon", hook: null, caption: "Book your braids" };
    const [first] = evidenceFromRows("facebook", [row]);
    const again = evidenceFromRows("facebook", [{ ...row, hook: "Braids in progress, price on screen" }, { url: "https://www.facebook.com/ads/library/?id=10", page: "New" }], [first], { addNew: false });
    expect(again.map((e) => e.id)).toEqual([first.id]);
    expect(again[0].key).not.toBe(first.key);
  });
});

describe("variants live (Facebook)", () => {
  it("counts rows sharing an advertiser, or the researchers' stated count, and raises strength with it", () => {
    const rows = [{ page: "Shop A" }, { page: "shop a" }, { page: "Elohome" }, { page: "Solo" }];
    expect(variantsLive("facebook", rows[0], rows)).toBe(2);
    expect(variantsLive("facebook", rows[2], rows)).toBe(8);
    expect(variantsLive("facebook", rows[3], rows)).toBe(1);
    expect(variantsLive("tiktok", rows[0], rows)).toBeNull();
    expect(rowStrength("facebook", {}, null, 5, 8)).toBeGreaterThan(rowStrength("facebook", {}, null, 5, 1));
    expect(rowStrength("facebook", {}, null, 5, 15)).toBe(1);
    expect(BRAIN.evidence.find((e) => e.who === "Derma Skin Clinic Rwanda")!.variantsLive).toBe(15);
    expect(BRAIN.evidence.filter((e) => e.source !== "facebook").every((e) => e.variantsLive === null)).toBe(true);
  });
});

describe("brainFor", () => {
  it("is deterministic", () => {
    expect(brainFor(base)).toEqual(brainFor(base));
    expect(brainContext(base)).toBe(brainContext(base));
  });

  it("never offers a hook whose facts the brief lacks, or that the engine cannot make", () => {
    for (const sector of SECTORS)
      for (const engine of ["claude", "seedance"] as Engine[]) {
        const pick = brainFor({ ...base, sector, engine, hasPrice: false, hasPhone: false });
        expect(pick.hooks.length).toBeGreaterThan(0);
        for (const h of pick.hooks) {
          expect(h.needs).not.toContain("price");
          expect(h.needs).not.toContain("phone");
          expect(h.engines).toContain(engine);
        }
        for (const r of [...pick.rules, ...pick.donts]) expect(["both", engine]).toContain(r.engine);
        expect(pick.rules.map((r) => r.id)).not.toContain("phone-bar");
        expect(pick.rules.map((r) => r.id)).not.toContain("price-first-frame");
      }
  });

  it("puts the price and phone rules in when the brief has them", () => {
    const ids = brainFor(base).rules.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["price-first-frame", "phone-bar", "cta-route"]));
    expect(brainFor({ ...base, engine: "seedance" }).rules.map((r) => r.id)).toContain("seedance-clean-frames");
  });

  it("keeps the engines' lengths and a timeline from 0 to the end with the hook first and the call to action last", () => {
    for (const format of FORMATS)
      for (const seconds of [4, 6, 8, 10, 12, 15, 20, 25, 30, 45])
        for (const engine of ["claude", "seedance"] as Engine[]) {
          const pick = brainFor({ ...base, format, engine, seconds });
          const [lo, hi] = ENGINE_SECONDS[engine];
          expect(pick.seconds).toBeGreaterThanOrEqual(lo);
          expect(pick.seconds).toBeLessThanOrEqual(hi);
          const t = pick.timeline;
          expect(t[0].from).toBe(0);
          expect(t[0].role).toBe("hook");
          expect(t[t.length - 1].role).toBe("cta");
          expect(t[t.length - 1].to).toBe(pick.seconds);
          t.forEach((b, i) => {
            expect(b.to).toBeGreaterThan(b.from);
            if (i) expect(b.from).toBe(t[i - 1].to);
          });
        }
  });

  it("scales a format's beats to the length", () => {
    const tour = BRAIN.formats.find((f) => f.id === "tour")!;
    expect(scaleTimeline(tour, tour.refSeconds).map((b) => [b.from, b.to])).toEqual(tour.timeline.map((b) => [b.from, b.to]));
    const short = scaleTimeline(tour, 6);
    expect(short[0].to).toBeLessThanOrEqual(2);
    expect(short.length).toBeLessThanOrEqual(tour.timeline.length);
  });

  it("a short before/after keeps its before beat", () => {
    const ba = BRAIN.formats.find((f) => f.id === "before-after")!;
    expect(scaleTimeline(ba, 10).map((b) => b.beat)).toContain(ba.timeline[1].beat);
  });

  it("offers only hooks made for the sector when it has enough of its own", () => {
    for (const sector of SECTORS) {
      const s = BRAIN.sectors.find((x) => x.id === sector)!;
      for (const h of brainFor({ ...base, sector, hasLocation: true } as BrainBrief).hooks) expect(h.sectors.includes(sector) || h.sectors.includes("any") || s.hooks.includes(h.id), `${sector}: ${h.id}`).toBe(true);
    }
  });

  it("falls back to the sector's best format for the engine", () => {
    expect(brainFor({ ...base, sector: "real-estate", format: null }).format.id).toBe("tour");
    // Seedance cannot make kinetic typography: the sector's first Seedance format is used.
    expect(brainFor({ ...base, sector: "restaurant", format: "kinetic-typography", engine: "seedance" }).format.engines).toContain("seedance");
  });

  it("names the voice language for Kinyarwanda businesses", () => {
    const claude = brainFor({ ...base, language: "Kinyarwanda" });
    expect(claude.language).toMatchObject({ screen: "Kinyarwanda", voice: "English" });
    expect(brainFor({ ...base, language: "Kinyarwanda", engine: "seedance" }).language.voice).toMatch(/^none/);
  });
});

describe("brainContext", () => {
  it("stays under about 900 tokens for every kind of brief", () => {
    for (const sector of SECTORS)
      for (const format of [...FORMATS, null])
        for (const engine of ["claude", "seedance"] as Engine[])
          for (const platform of ["tiktok", "facebook", "any"] as const)
            for (const facts of [true, false]) {
              const text = brainContext({ ...base, sector, format, engine, platform, hasPrice: facts, hasPhone: facts, language: facts ? "English" : "Kinyarwanda" });
              expect(text.length, `${sector} ${format} ${engine} ${platform}`).toBeLessThanOrEqual(CONTEXT_MAX_CHARS);
              expect(text).toMatch(/Hook (options|ideas)/);
              expect(text).toContain("Timeline (");
              expect(text).toContain("Call to action");
              expect(text).toContain("Don't:");
            }
  }, 30_000);

  it("tells Seedance the text is an overlay, and Claude what goes on screen and in the caption", () => {
    const seedance = brainContext({ ...base, engine: "seedance" });
    expect(seedance).toContain("No text in the clip");
    expect(seedance).toContain("BuPulse overlays");
    const claude = brainContext(base);
    expect(claude).toContain("On screen:");
    expect(claude).toContain("Caption:");
    expect(brainContext(base, { ownerHook: true })).toContain("the owner chose the opener");
  });

  it("the worked examples of BRAIN.md: a Kigali phone shop and a Kibagabaga house", () => {
    const phone = brainFor({ platform: "facebook", sector: sectorFromText("Kigali Phones, iPhone 13 and Samsung Galaxy"), format: null, engine: "claude", language: "Kinyarwanda", hasPrice: true, hasPhone: true, seconds: 15 });
    expect(phone.sector).toBe("phone-shop");
    expect(phone.format.id).toBe("product-reveal");
    expect(phone.hooks.map((h) => h.id)).toEqual(["number-in-hand", "counter-price-bar", "price-banner"]);
    const house = brainFor({ platform: "tiktok", sector: sectorFromText("4 bedroom house for sale in Kibagabaga"), format: null, engine: "seedance", language: "English", hasPrice: true, hasPhone: true, hasLocation: true, seconds: 15 });
    expect(house.sector).toBe("real-estate");
    expect(house.format.id).toBe("tour");
    expect(house.hooks.map((h) => h.id)).toEqual(["location-stack", "price-banner", "whip-in-tour"]);
  });
});

describe("reading briefs", () => {
  it("finds the sector from the business and product words", () => {
    expect(sectorFromText("Nova Phones Kigali, Galaxy A56 5G phone")).toBe("phone-shop");
    expect(sectorFromText("House for rent in Kibagabaga, 3 bedrooms")).toBe("real-estate");
    expect(sectorFromText("Muhazi tilapia fish, restaurant in Kicukiro")).toBe("restaurant");
    expect(sectorFromText("Braids and nails salon")).toBe("salon");
    expect(sectorFromText("Rent a car with driver")).toBe("car-rental");
    expect(sectorFromText("")).toBe("shop");
  });

  it("maps Claude templates, Seedance templates and Seedance formats to brain formats", () => {
    expect(formatFromTemplate("ugc-before-after")).toBe("before-after");
    expect(formatFromTemplate("3d-title-drop")).toBe("3d-motion");
    expect(formatFromTemplate("kinetic-type")).toBe("kinetic-typography");
    expect(formatFromTemplate("realestate-tour")).toBe("tour");
    expect(formatFromTemplate("offer")).toBe("offer");
    expect(formatFromTemplate("nope")).toBeNull();
  });

  it("builds a BrainBrief from the designer's brief and the Seedance brief", () => {
    const design: DesignBrief = {
      business: { name: "Nova Phones Kigali", language: "English", phone: "+250 788 000 000" },
      product: { name: "Galaxy A56", summary: "5G phone", price: "Was 450,000 RWF, now 420,000 RWF", usps: ["Big battery"] },
      photos: [{ base64: "AAAA", mediaType: "image/jpeg", width: 800, height: 800 }],
      styleId: "price-drop",
      hookId: "auto",
      ratio: "9:16",
      seconds: 15,
      note: "Weekend offer, free delivery in Kigali",
    };
    expect(brainBriefFromDesign(design, "tiktok")).toMatchObject({ platform: "tiktok", sector: "phone-shop", format: "offer", engine: "claude", hasPrice: true, hasPhone: true, hasOffer: true, hasOldPrice: true, hasLocation: true });
    expect(brainFor(brainBriefFromDesign(design, "facebook")).hooks.map((h) => h.id)).toContain("was-now");
    expect(brainBriefFromDesign({ ...design, platform: "youtube" }).platform).toBe("shorts");
    expect(formatFromTemplate("kigali-price-first")).toBe("product-reveal");
    expect(formatFromTemplate("floating-product-reveal")).toBe("3d-motion");

    const prompt: PromptBrief = { business: { name: "Bright Academy", language: "French" }, product: { name: "English course" }, references: [], templateId: "education-tour", seconds: 10, ratio: "9:16", audio: true, businessKind: "education" };
    expect(brainBriefFromPrompt(prompt)).toMatchObject({ sector: "school", format: "tour", engine: "seedance", hasPrice: false, hasPhone: false });
    expect(brainBriefFromPrompt(prompt, { platform: "youtube", hasPhone: true })).toMatchObject({ platform: "shorts", hasPhone: true });
  });
});

describe("scoring a design", () => {
  const brief: ScoreBrief = { business: { name: "Nova Phones", phone: "0788 300 400", language: "English" }, product: { name: "Galaxy A56", price: "420,000 RWF", usps: ["Big battery"] }, styleId: "kigali-price-first", platform: "facebook" };
  const bar = { kind: "text" as const, text: "WhatsApp 0788 300 400", font: "inter" as const, size: 0.045, color: "#ffffff", x: 0.5, y: 0.72, w: 0.8, h: 0.06, box: { color: "#16a34a" } };
  const scene = (seconds: number, layers: Scene["layers"], say: string, extra: Partial<Scene> = {}): Scene => ({ seconds, background: { kind: "solid", colors: ["#111111"] }, layers, say, camera: { move: "dollyIn", intensity: 0.4 }, ...extra });
  const good: MotionSpec = {
    version: 1, title: "Galaxy A56", ratio: "9:16", fps: 30, music: "upbeat", look: { grade: "vivid" },
    palette: { background: "#111111", primary: "#2f6bff", accent: "#f5b700", text: "#ffffff" },
    scenes: [
      scene(2, [{ kind: "text", text: "Galaxy A56: 420,000 RWF", font: "anton", size: 0.09, color: "#ffffff", x: 0.5, y: 0.22, w: 0.84, h: 0.14, animate: "pop" }, bar], "Galaxy A56, four hundred twenty thousand francs."),
      scene(3, [{ kind: "photo", photo: 1, x: 0.5, y: 0.45, w: 0.7, h: 0.4, fit: "contain", zoomTo: 1.1 }, { kind: "text", text: "Big battery", font: "inter", size: 0.06, color: "#ffffff", x: 0.5, y: 0.2, w: 0.7, h: 0.08, animate: "rise" }, bar], "A big battery for the whole day."),
      scene(4, [{ kind: "photo", photo: 1, x: 0.5, y: 0.45, w: 0.7, h: 0.4, fit: "contain", turntable: { spin: 1 } }, { kind: "text", text: "420,000 RWF", font: "anton", size: 0.08, color: "#f5b700", x: 0.5, y: 0.2, w: 0.7, h: 0.1, animate: "pop" }, bar], "Four hundred twenty thousand francs at Nova Phones."),
      scene(3, [{ kind: "text", text: "Order on WhatsApp", font: "poppins", size: 0.07, color: "#ffffff", x: 0.5, y: 0.4, w: 0.8, h: 0.1, animate: "wordsPop" }, bar], "Order on WhatsApp: 0788 300 400.", { camera: { move: "orbitRight" } }),
      scene(3, [{ kind: "text", text: "Nova Phones", font: "poppins", size: 0.07, color: "#ffffff", x: 0.5, y: 0.4, w: 0.8, h: 0.1, animate: "rise" }, bar], "Nova Phones. Order now."),
    ],
    caption: "Galaxy A56 PRICE: 420,000 RWF TEL: 0788 300 400. WhatsApp 0788 300 400.",
    hashtags: ["Kigali", "KigaliRwanda", "Rwanda"],
  };
  const bad: MotionSpec = {
    ...good,
    scenes: [
      { seconds: 2, background: { kind: "solid", colors: ["#000000"] }, layers: [{ kind: "text", text: "You have received 85000 RWF", font: "inter", size: 0.05, color: "#ffffff", x: 0.5, y: 0.93, w: 0.8, h: 0.06, from: 0.9 }] },
      { seconds: 2, background: { kind: "solid", colors: ["#000000"] }, layers: [{ kind: "text", text: "Only 3 left, 50% off today", font: "inter", size: 0.05, color: "#ffffff", x: 0.5, y: 0.5, w: 0.8, h: 0.06 }] },
    ],
    caption: "",
    hashtags: [],
  };

  it("a good design passes every check", () => {
    const r = scoreDesign(good, brief, { voice: true });
    expect(r.failed).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.passed.map((p) => p.id)).toEqual(expect.arrayContaining(["hook-text", "price-shown", "price-early", "contact-last", "phone-bar", "cta", "motion", "safe-area", "length", "scene-count", "say-lines", "caption", "do-not-copy", "facts"]));
  });

  it("a bad design fails with the rule, a plain reason and the scene", () => {
    const r = scoreDesign(bad, brief, { voice: true });
    expect(r.score).toBeLessThan(20);
    const failed = Object.fromEntries(r.failed.map((f) => [f.id, f]));
    expect(Object.keys(failed)).toEqual(expect.arrayContaining(["hook-text", "price-shown", "contact-last", "phone-bar", "cta", "motion", "safe-area", "length", "say-lines", "caption", "do-not-copy", "facts"]));
    expect(failed["do-not-copy"]).toMatchObject({ rule: "no-fake-income", scene: 0 });
    expect(failed["do-not-copy"].reason).toContain("You have received");
    expect(failed.facts).toMatchObject({ rule: "no-invented-facts", scene: 0 });
    expect(failed["safe-area"]).toMatchObject({ rule: "text-placement", scene: 0 });
    expect(failed.motion.reason).toContain("Scenes 1, 2");
    for (const f of r.failed) expect(f.reason.length).toBeGreaterThan(10);
  });

  it("scores the committed sample spec, and leaves out checks that do not apply", () => {
    const spec = sampleSpec({ business: "Nova Phones", product: "Galaxy A56", price: "420,000 RWF", photoCount: 2 });
    const r = scoreDesign(spec, { business: { name: "Nova Phones" }, product: { name: "Galaxy A56", price: "420,000 RWF" } }, { voice: true });
    expect(r.failed.map((f) => f.id).sort()).toEqual(["caption", "price-early", "safe-area"]);
    expect(r.failed.find((f) => f.id === "safe-area")!.scene).toBe(1);
    expect(r.score).toBe(90);
    const noPrice = scoreDesign(spec, { business: { name: "Nova Phones" }, product: { name: "Galaxy A56" } });
    expect([...noPrice.passed, ...noPrice.failed].map((c) => c.id)).not.toContain("price-shown");
    expect([...noPrice.passed, ...noPrice.failed].map((c) => c.id)).not.toContain("say-lines");
  });

  it("model numbers, bullets and phone numbers are not read as invented amounts", () => {
    const withBullets: MotionSpec = { ...good, scenes: good.scenes.map((sc, i) => (i === 4 ? { ...sc, layers: [...sc.layers, { kind: "text" as const, text: "Samsung Galaxy A56 • 420,000 RWF", font: "inter" as const, size: 0.05, color: "#ffffff", x: 0.5, y: 0.6, w: 0.8, h: 0.06 }] } : sc)) };
    expect(scoreDesign(withBullets, brief).failed.map((f) => f.id)).not.toContain("facts");
  });

  it("a giant background word behind the product is not a safe-area miss", () => {
    const word = (depth: number) => ({ kind: "text" as const, text: "GALAXY", font: "anton" as const, size: 0.3, depth, color: "#ffffff", x: 0.5, y: 0.5, w: 0.98, h: 0.3 });
    const withWord = (depth: number): MotionSpec => ({ ...good, scenes: good.scenes.map((sc, i) => (i === 1 ? { ...sc, layers: [word(depth), ...sc.layers] } : sc)) });
    expect(scoreDesign(withWord(0.2), brief).failed.map((f) => f.id)).not.toContain("safe-area");
    expect(scoreDesign(withWord(0.9), brief).failed.map((f) => f.id)).toContain("safe-area");
  });

  it("a small quiet phone line counts as the number on screen (luxury templates)", () => {
    const quiet = { kind: "text" as const, text: "0788 300 400", font: "inter" as const, size: 0.03, color: "#cccccc", x: 0.5, y: 0.74, w: 0.4, h: 0.03 };
    const luxe: MotionSpec = { ...good, scenes: good.scenes.map((sc) => ({ ...sc, layers: [...sc.layers.filter((l) => !(l.kind === "text" && l.text.includes("0788"))), quiet] })) };
    const r = scoreDesign(luxe, { ...brief, styleId: "dark-minimal" });
    expect(r.passed.map((p) => p.id)).toContain("phone-bar");
    expect(scoreDesign({ ...luxe, scenes: luxe.scenes.map((sc, i) => (i === 1 ? { ...sc, layers: sc.layers.filter((l) => l !== quiet) } : sc)) }, { ...brief, styleId: "dark-minimal" }).failed.map((f) => f.id)).toContain("phone-bar");
  });

  it("exports the safe areas per platform (youtube is Shorts)", () => {
    expect(safeAreaFor("youtube")).toEqual(SAFE_AREAS.shorts);
    expect(safeAreaFor("tiktok")).toEqual({ top: 0.12, bottom: 0.78, left: 0.07, right: 0.85 });
    expect(safeAreaFor(null)).toEqual(SAFE_AREAS.any);
    expect(safeAreaFor("myspace")).toEqual(SAFE_AREAS.any);
  });

  it("a superlative or a delivery promise passes only when the brief says it", () => {
    const withClaim: MotionSpec = { ...good, scenes: good.scenes.map((s, i) => (i === 1 ? { ...s, layers: [...s.layers, { kind: "text" as const, text: "Free delivery in Kigali", font: "inter" as const, size: 0.05, color: "#ffffff", x: 0.5, y: 0.6, w: 0.8, h: 0.06 }] } : s)) };
    expect(scoreDesign(withClaim, brief).failed.map((f) => f.id)).toContain("facts");
    expect(scoreDesign(withClaim, { ...brief, note: "free delivery in Kigali this week" }).failed).toEqual([]);
  });

  it("reads amounts and skips phone numbers", () => {
    expect(amounts("420K, 420,000 RWF, 1.2M, 15%")).toEqual([420_000, 420_000, 1_200_000, 15]);
    expect(amounts("Call 0788 300 400 or +250 788 300 400")).toEqual([]);
    expect(amounts("WhatsApp 0788 300 400\n420,000 RWF")).toEqual([420_000]);
    expect(amounts("Samsung Galaxy A56 420,000 RWF")).toEqual([420_000]);
    expect(amounts("Samsung Galaxy A56 • 420,000 RWF · 5G · 8 GB")).toEqual([420_000, 8]);
    expect(amounts("+250-739-095040 or (+250)788861575")).toEqual([250]);
  });
});

describe("scoring a Seedance prompt", () => {
  const brief = { business: { name: "Nova Phones", language: "English" }, product: { name: "Galaxy A56", price: "420,000 RWF", summary: "5G phone" }, references: ["Image 1: the product photo"], seconds: 10, audio: true, templateId: "phone-hero", ratio: "9:16" };

  it("BuPulse's own shot plan scores 100", () => {
    const r = scoreSeedancePrompt(planSeedanceShots(brief).prompt, brief);
    expect(r.failed).toEqual([]);
    expect(r.score).toBe(100);
  });

  it("a bad prompt fails the time codes, hook, fidelity, people, facts, length and text checks", () => {
    const r = scoreSeedancePrompt("A famous footballer holds the phone in a shop with the text SALE on screen. Only 2 left at 300,000 RWF, free delivery.", brief);
    expect(r.failed.map((f) => f.id)).toEqual(expect.arrayContaining(["timecodes", "hook-shot", "fidelity", "people", "facts", "length-words", "clean-frames", "hero-end"]));
    expect(r.score).toBeLessThan(25);
    expect(r.failed.find((f) => f.id === "facts")!.reason).toContain("300000");
  });

  it("a before/after opens on the result (held still is fine), a tour may end on the view", () => {
    const ba = (first: string) => `A vertical 9:16 before-and-after ad for a salon in Kigali. The braids must look exactly as in Image 1: same shape, colours.\n0-3s: ${first}\n3-6s: Close-up, slow push-in: the stylist braids, hands moving quickly.\n6-10s: Clean hero shot, subject centred: the finished braids, space above. Music: a light beat. Clean frames with no on-screen text, captions or added logos. Warm salon light, a ring light, a mirror behind the chair, the stylist smiling at the client.`;
    const brief2 = { business: { name: "Amahoro Braids", language: "English" }, product: { name: "Knotless braids" }, references: ["Image 1: the braids"], seconds: 10, audio: true, templateId: "salon-transformation" };
    const held = scoreSeedancePrompt(ba("Medium shot, locked-off static camera: the result first: the finished braids, bright and still."), brief2);
    expect(held.failed.map((f) => f.id)).not.toContain("hook-shot");
    expect(held.passed.map((f) => f.id)).toContain("result-first");
    expect(scoreSeedancePrompt(ba("Medium shot, locked-off static camera: the client with untidy hair before the visit."), brief2).failed.map((f) => f.id)).toContain("result-first");
    const tour = "A vertical 9:16 walk-through tour of a house in Kibagabaga, Kigali, exactly as in Image 1: same shape, colours.\n0-4s: Wide establishing shot, slow aerial drone shot towards the house on the green hillside.\n4-9s: Smooth gimbal walk-through of the living room and the kitchen, warm morning light.\n9-12s: Wide shot, slow pull-back out onto the balcony as the view opens up. Music: calm piano. Clean frames with no on-screen text, captions or added logos.";
    const t = scoreSeedancePrompt(tour, { business: { name: "Ikaze Homes" }, product: { name: "4 bedroom house" }, references: ["Image 1: the house"], seconds: 12, audio: true, templateId: "realestate-tour" });
    expect(t.failed.map((f) => f.id)).not.toContain("hero-end");
    expect(t.failed.map((f) => f.id)).not.toContain("hook-shot");
    expect(scoreSeedancePrompt(tour, { business: { name: "Ikaze Homes" }, product: { name: "4 bedroom house" }, references: ["Image 1: the house"], seconds: 20, audio: true, templateId: "realestate-tour" }).failed.map((f) => f.id)).toContain("clip-length");
  });

  it("refuses a spoken line for Kinyarwanda", () => {
    const rw = { ...brief, business: { ...brief.business, language: "Kinyarwanda" } };
    const prompt = planSeedanceShots({ ...brief }).prompt;
    expect(scoreSeedancePrompt(prompt, rw).failed.map((f) => f.id)).toContain("sound");
  });
});

describe("scoring a caption", () => {
  const brief: ScoreBrief = { business: { name: "Nova Phones", description: "Phone shop in Kigali", phone: "0788 300 400", language: "English" }, product: { name: "Samsung Galaxy A56", price: "420,000 RWF", usps: ["Cover and charger included"] } };
  const good = "Samsung Galaxy A56 is here at Nova Phones 📱 420,000 RWF, cover and charger included. WhatsApp 0788 300 400 📍 Makuza Peace Plaza, Kigali";

  it("a good TikTok caption passes every check", () => {
    const r = scoreCaption(good, ["KigaliTikTok", "RwandaTikTok", "#KigaliBusiness", "fyp"], { ...brief, platform: "tiktok" });
    expect(r.missed).toEqual([]);
    expect(r.score).toBe(100);
  });

  it("a bad caption lists what it misses in plain English", () => {
    const r = scoreCaption("BEST phones in town!!! Only 2 left, 50% off", ["fyp", "viral", "trending", "foryou", "explore", "tiktokshop", "xyzbca"], { ...brief, platform: "tiktok" });
    const ids = r.failed.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["first-line", "caption-cta", "caption-phone", "caption-price", "caption-place", "hashtag-count", "hashtag-mix", "caption-do-not-copy", "caption-facts"]));
    expect(r.score).toBeLessThan(25);
    expect(r.missed.join(" ")).toContain("0788 300 400");
    expect(r.failed.find((f) => f.id === "caption-do-not-copy")!.rule).toBe("no-made-up-superlative");
  });

  it("Facebook: 0 to 3 hashtags (most Rwandan ads use none), never a stack", () => {
    const fb = { ...brief, platform: "facebook" };
    expect(scoreCaption(good, [], fb).failed).toEqual([]);
    expect(scoreCaption(good, ["Kigali", "KigaliRwanda"], fb).failed).toEqual([]);
    expect(scoreCaption(good, ["Kigali", "KigaliRwanda", "Rwanda", "phones", "samsung", "deals"], fb).failed.map((f) => f.id)).toEqual(["hashtag-count"]);
    expect(scoreCaption(good, ["phones", "samsung"], fb).failed.map((f) => f.id)).toEqual(["hashtag-mix"]);
  });

  it("delivery, Kinyarwanda calls to action and #MadeInRwanda", () => {
    const delivers = { ...brief, note: "Free delivery in Kigali", platform: "facebook" };
    expect(scoreCaption(good, [], delivers).failed.map((f) => f.id)).toEqual(["caption-delivery"]);
    expect(scoreCaption(`${good}. Free delivery in Kigali`, [], delivers).failed).toEqual([]);
    expect(scoreCaption("Samsung Galaxy A56 kuri 420,000 RWF gusa. Duhamagare 0788 300 400, Kigali", [], { ...brief, platform: "facebook" }).passed.map((p) => p.id)).toContain("caption-cta");
    expect(scoreCaption(good, ["Kigali", "MadeInRwanda"], { ...brief, platform: "facebook" }).failed.map((f) => f.id)).toEqual(["caption-facts"]);
  });

  it("a Kinyarwanda business gets a Kinyarwanda caption", () => {
    const rw = { ...brief, business: { ...brief.business, language: "Kinyarwanda" }, platform: "facebook" };
    const kin = "Samsung Galaxy A56 iraboneka kuri Nova Phones! Igiciro: 420,000 RWF. Hamagara cyangwa ukandikire kuri WhatsApp 0788 300 400. Turi i Kigali, Makuza Peace Plaza. Twandikire 0788 300 400.";
    expect(scoreCaption(kin, ["Kigali", "KigaliRwanda", "Rwanda"], rw).failed.map((f) => f.id)).not.toContain("caption-language");
    expect(scoreCaption(good, ["Kigali", "KigaliRwanda", "Rwanda"], rw).failed.map((f) => f.id)).toContain("caption-language");
  });

  it("a Short's title: the product first, under 100 characters, no 'subscribe'", () => {
    const shorts = { ...brief, platform: "youtube" };
    const title = "Samsung Galaxy A56 in Kigali: 420,000 RWF | Nova Phones WhatsApp 0788 300 400 #shorts #kigali";
    expect(scoreCaption(title, [], shorts).failed).toEqual([]);
    const ids = scoreCaption(`Wait till the end, you will not believe this: ${title} Subscribe for more!`, [], shorts).failed.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["first-line", "caption-length", "caption-do-not-copy"]));
  });
});

describe("the caption check against the caption corpus", () => {
  const rows = parseJsonl(fs.readFileSync(path.join(REELS, "captions.jsonl"), "utf8")) as Record<string, unknown>[];
  const rwanda = rows.filter((r) => r.country === "RW");

  it("finds Kinyarwanda the way the researcher labelled it", () => {
    const share = (lang: string, expected: boolean) => {
      const sel = rwanda.filter((r) => r.language_mix === lang);
      return sel.filter((r) => hasKinyarwanda(String(r.caption)) === expected).length / sel.length;
    };
    expect(share("rw", true)).toBeGreaterThanOrEqual(0.9);
    expect(share("mixed", true)).toBeGreaterThanOrEqual(0.85);
    expect(share("en", false)).toBeGreaterThanOrEqual(0.95);
  });

  it("finds the number in every caption that has one, however it is written", () => {
    const withPhone = rows.filter((r) => r.has_phone === true && (r.phones_as_written as string[]).length);
    expect(withPhone.length).toBeGreaterThan(60);
    for (const r of withPhone) {
      const phone = (r.phones_as_written as string[])[0];
      const res = scoreCaption(String(r.caption), r.hashtags as string[], { business: { name: String(r.page_or_account), phone }, product: { name: "item" } });
      expect(res.passed.map((p) => p.id), `${r.page_or_account}: ${phone}`).toContain("caption-phone");
    }
  });

  it("reads every price form the corpus uses", () => {
    expect(amounts("20,000 RWF 48,000RWF 38000FRW 18k gusa Price:3.5M 35K → 27K 12,000 rfw RWF 20K/month")).toEqual([20_000, 48_000, 38_000, 18_000, 3_500_000, 35_000, 27_000, 12_000, 20_000]);
  });

  it("the hashtag ranges hold the corpus medians", () => {
    const median = (xs: number[]) => [...xs].sort((a, z) => a - z)[Math.floor(xs.length / 2)];
    const count = (platform: string) => median(rows.filter((r) => r.platform === platform).map((r) => Number(r.hashtag_count)));
    const range = (p: string) => BRAIN.captions.platforms.find((x) => x.platform === p)!.hashtags.count;
    const [fbLo, fbHi] = range("facebook");
    const [ttLo, ttHi] = range("tiktok");
    expect(count("facebook_ad")).toBeGreaterThanOrEqual(fbLo);
    expect(count("facebook_ad")).toBeLessThanOrEqual(fbHi);
    expect(count("tiktok")).toBeGreaterThanOrEqual(ttLo);
    expect(count("tiktok")).toBeLessThanOrEqual(ttHi);
  });

  it("the strongest Rwandan captions (price, phone, place and a call to action) score well", () => {
    const full = rwanda.filter((r) => r.has_phone && r.has_price && r.has_location && r.has_cta && r.platform === "facebook_ad" && (r.phones_as_written as string[]).length);
    expect(full.length).toBeGreaterThan(10);
    const scores = full.map((r) => scoreCaption(String(r.caption), r.hashtags as string[], { business: { name: String(r.page_or_account), phone: (r.phones_as_written as string[])[0], language: r.language_mix === "rw" ? "Kinyarwanda" : "English" }, product: { name: String(r.caption).split(/\s+/).slice(0, 3).join(" ") } }, { platform: "facebook" }).score);
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeGreaterThanOrEqual(75);
  });
});

// The one corpus caption the language check flags: "Website design Rwanda", labelled French in captions.jsonl although
// its caption is English, so its "Send us a message" reads as an English call to action in a French caption.
const MAX_CORPUS_FLAGS = 1;

describe("the language check", () => {
  const codes = (texts: Parameters<typeof checkLanguage>[0], language: string) => checkLanguage(texts, language).map((x) => x.code);

  it("flags price forms the corpus never writes, on screen and in the caption only", () => {
    expect(codes([{ where: "caption", text: "Galaxy A56 kuri 420.000 RWF gusa", kind: "caption" }], "Kinyarwanda")).toEqual(["price-format"]);
    expect(codes([{ where: "scene 1 text", text: "420,000 francs", kind: "screen" }], "English")).toEqual(["price-format"]);
    expect(codes([{ where: "scene 1 voice", text: "Four hundred twenty thousand francs.", kind: "voice" }], "English")).toEqual([]);
    expect(codes([{ where: "caption", text: "Igiciro: 420,000 RWF. Jumpsuit kuri 18k gusa. Price: 3.5M Frw", kind: "caption" }], "Kinyarwanda")).toEqual([]);
    const issue = checkLanguage([{ where: "caption", text: "Galaxy A56 kuri 420.000 RWF gusa", kind: "caption" }], "Kinyarwanda")[0];
    expect(issue.suggestion).toBe("420,000 RWF");
  });

  it("flags an English call to action in a Kinyarwanda or French caption, not in an English one", () => {
    const rw = checkLanguage([{ where: "caption", text: "Samsung Galaxy A56 iraboneka kuri Nova Phones! Call now 0788 300 400", kind: "caption" }], "Kinyarwanda");
    expect(rw.map((x) => x.code)).toEqual(["english-cta"]);
    expect(rw[0].suggestion).toContain("Duhamagare");
    expect(codes([{ where: "caption", text: "Samsung Galaxy A56 kuri 420k gusa. Call/WhatsApp: 0788 300 400", kind: "caption" }], "Kinyarwanda")).toEqual([]);
    expect(codes([{ where: "caption", text: "Galaxy A56 at Nova Phones. Call now 0788 300 400", kind: "caption" }], "English")).toEqual([]);
    expect(codes([{ where: "caption", text: "Galaxy A56 disponible chez Nova Phones. Order now!", kind: "caption" }], "French")).toEqual(["english-cta"]);
  });

  it("flags one sentence built from two languages' grammar, not a product name or 'free delivery' inside Kinyarwanda", () => {
    expect(codes([{ where: "caption", text: "Gura the best phone kuri iyi price for you", kind: "caption" }], "Kinyarwanda")).toEqual(["mixed-line"]);
    expect(codes([{ where: "caption", text: "GURA NAWE ni free delivery twandikire cg uduhamagare 0790 583 341", kind: "caption" }], "Kinyarwanda")).toEqual([]);
    expect(codes([{ where: "caption", text: "Samsung Galaxy A56 kuri 420k gusa. Different sizes and colours available.", kind: "caption" }], "Kinyarwanda")).toEqual([]);
  });

  it("flags web words on a video frame and the literal translations it knows", () => {
    expect(codes([{ where: "scene 5 text", text: "Kanda hano", kind: "screen" }], "Kinyarwanda")).toEqual(["not-clickable"]);
    expect(codes([{ where: "caption", text: "Kanda kuri link iri muri bio", kind: "caption" }], "Kinyarwanda")).toEqual([]);
    expect(codes([{ where: "caption", text: "Igiciro: 420,000 amafaranga y'u Rwanda", kind: "caption" }], "Kinyarwanda")).toEqual(["price-format", "literal-translation"]);
  });

  it("checks a Kinyarwanda business's voice lines only when the voice speaks Kinyarwanda (it speaks English)", () => {
    expect(codes([{ where: "scene 1 voice", text: "Call now on 0788 300 400", kind: "voice" }], "Kinyarwanda")).toEqual([]);
    const spec = sampleSpec({ business: "Nova Phones", product: "Galaxy A56", price: "420,000 RWF", photoCount: 1 });
    const kinds = languageTextsOf(spec).map((t) => t.kind);
    expect(kinds).toContain("screen");
    expect(kinds).toContain("voice");
    expect(kinds[kinds.length - 1]).toBe("caption");
  });

  it("raises almost no false alarms on the 111 real Rwandan captions", () => {
    const rows = parseJsonl(fs.readFileSync(path.join(REELS, "captions.jsonl"), "utf8")).filter((r) => r.country === "RW");
    const flagged = rows.filter((r) => checkLanguage([{ where: "caption", text: String(r.caption), kind: "caption" }], r.language_mix === "en" ? "English" : r.language_mix === "fr" ? "French" : "Kinyarwanda").length);
    expect(flagged.length).toBeLessThanOrEqual(MAX_CORPUS_FLAGS);
  });
});

// Writes docs/research/brain-samples.md (what Claude is told for six briefs). Run after changing the brain data:
//   BRAIN_SAMPLES=1 npx vitest run tests/video-engine/brain.test.ts -t "brain samples"
describe.runIf(process.env.BRAIN_SAMPLES)("brain samples", () => {
  it("writes docs/research/brain-samples.md", () => {
    const photo = [{ base64: "", mediaType: "image/jpeg" as const, width: 1080, height: 1080 }];
    const design = (b: Partial<DesignBrief> & Pick<DesignBrief, "business" | "product" | "styleId" | "seconds">): DesignBrief => ({ photos: photo, hookId: "auto", ratio: "9:16", ...b });
    const phoneShop = { name: "Nova Phones Kigali", description: "Phone shop in Kigali: Samsung and iPhone, accessories", phone: "0788 300 400", country: "Rwanda" };
    const galaxy = { name: "Samsung Galaxy A56", summary: "5G phone, 256 GB", price: "420,000 RWF", usps: ["Big battery", "Cover and charger included"] };
    const house = { name: "4 bedroom house for sale in Kibagabaga", summary: "4 bedrooms, 3 bathrooms, garden, parking for 2 cars", price: "180,000,000 RWF" };
    const realtor = { name: "Ikaze Homes", description: "Real estate agency, Gasabo, Kigali", language: "English" };
    const samples: { title: string; brief: string; text: string }[] = [
      { title: "1. Kigali phone shop on TikTok (Claude motion engine)", brief: "Nova Phones Kigali, Samsung Galaxy A56, 420,000 RWF, WhatsApp 0788 300 400, English, template Kigali price-first, 15 s.",
        text: brainContext(brainBriefFromDesign(design({ business: { ...phoneShop, language: "English" }, product: galaxy, styleId: "kigali-price-first", seconds: 15, platform: "tiktok" }))) },
      { title: "2. Kigali phone shop on Facebook (Claude motion engine, Kinyarwanda)", brief: "The same shop and phone, content in Kinyarwanda (the voice speaks English), Facebook, 15 s.",
        text: brainContext(brainBriefFromDesign(design({ business: { ...phoneShop, language: "Kinyarwanda" }, product: galaxy, styleId: "kigali-price-first", seconds: 15, platform: "facebook" }))) },
      { title: "3a. Kibagabaga house on Instagram (Seedance)", brief: "Ikaze Homes, 4 bedroom house in Kibagabaga, 180,000,000 RWF, Seedance tour, 15 s, with sound. The phone is overlaid by BuPulse.",
        text: brainContext(brainBriefFromPrompt({ business: realtor, product: house, references: ["Image 1: the front of the house"], templateId: "realestate-tour", seconds: 15, ratio: "9:16", audio: true, businessKind: "real-estate" }, { platform: "instagram", hasPhone: true })) },
      { title: "3b. Kibagabaga house on Instagram (Claude motion engine, from photos)", brief: "The same house, made from the listing photos, template Brand story (a tour), 20 s.",
        text: brainContext(brainBriefFromDesign(design({ business: { ...realtor, phone: "0788 111 222" }, product: house, styleId: "brand-story", seconds: 20, platform: "instagram" }))) },
      { title: "4. Restaurant offer on Facebook (Claude motion engine)", brief: "Cave Kitchen Kicukiro, 'Buy one pizza, get one free every Tuesday', pizza 12,000 RWF, call 0791 000 111, template Offer flash, 15 s.",
        text: brainContext(brainBriefFromDesign(design({ business: { name: "Cave Kitchen", description: "Pizza restaurant in Kicukiro, Kigali, with delivery", language: "English", phone: "0791 000 111" }, product: { name: "Pepperoni pizza", price: "12,000 RWF" }, note: "Buy one pizza, get one free every Tuesday", styleId: "offer-flash", seconds: 15, platform: "facebook" }))) },
      { title: "5. Salon on TikTok (Seedance, before and after)", brief: "Amahoro Braids, knotless braids, from 25,000 RWF, Seedance transformation, 10 s, with sound. The phone is overlaid by BuPulse.",
        text: brainContext(brainBriefFromPrompt({ business: { name: "Amahoro Braids", description: "Braids and hair salon in Remera, Kigali", language: "English" }, product: { name: "Knotless braids", price: "from 25,000 RWF" }, references: [], templateId: "salon-transformation", seconds: 10, ratio: "9:16", audio: true, businessKind: "salon" }, { platform: "tiktok", hasPhone: true })) },
      { title: "6. School on YouTube Shorts (Claude motion engine)", brief: "Bright Future Academy, evening English course, 30,000 RWF a month, WhatsApp 0782 000 333, template 3 reasons, 15 s.",
        text: brainContext(brainBriefFromDesign(design({ business: { name: "Bright Future Academy", description: "English and computer school in Nyarugenge, Kigali", language: "English", phone: "0782 000 333" }, product: { name: "Evening English course", price: "30,000 RWF a month", usps: ["Small classes", "Certificate"] }, styleId: "tiktok-3-reasons", seconds: 15, platform: "youtube" }))) },
    ];
    const doc = [
      "# What Claude is told: brain samples",
      "",
      "The exact research block (`brainContext`, `lib/video-engine/brain/select.ts`) that goes into Claude's brief for six example",
      "briefs. It sits inside the brief as data, after the template and before the business facts; Claude still sees the photos",
      "and the system prompt (which already covers the scroll-stopping opening, only-true facts, the safe area and the voice",
      "language, so the block does not repeat them). Placeholders like {phone} are filled by Claude from the brief's facts.",
      "",
      "Made by `BRAIN_SAMPLES=1 npx vitest run tests/video-engine/brain.test.ts -t \"brain samples\"`; rerun it after the brain",
      "data changes.",
      "",
      ...samples.flatMap((s) => [`## ${s.title}`, "", `Brief: ${s.brief}`, "", `${s.text.length} characters, about ${Math.round(s.text.length / 4)} tokens.`, "", "```text", s.text, "```", ""]),
    ].join("\n");
    fs.writeFileSync(path.join(process.cwd(), "docs/research/brain-samples.md"), doc);
    for (const s of samples) expect(s.text.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS);
  });
});

// The judgement part of docs/research/brain-audit.md (17 October 2026), kept with the generator so a rerun keeps it.
const AUDIT_FINDINGS = `## Whose fault (17 October 2026)

### The designer's (for the motion engine: designer.ts and the templates)

1. **The platform never reached the designer.** The sweep briefs had no platform field, so the designer used its default safe area
   (bottom 0.82, right 0.93): phone bars end at y 0.82 to 0.83 and text reaches x 0.90 to 0.93. Instagram and TikTok cover
   the bottom 20%, and TikTok and Shorts cover the right edge, so 27 of 33 designs put the price, the number or the call to
   action under the app's buttons. Fixes: pass the platform field in every brief (DesignBrief already has it); when none is given,
   make the default the strictest common box (y 0.12 to 0.78, x 0.07 to 0.85) and say "the phone bar ends at y 0.78 at the
   latest". Text outside even the designer's own default box (the "outside own box" column: kinetic-type 10, macro-detail 9,
   product-hero 9, showroom-turntable 8, colour-options 8) is a plain miss; validate.ts could pull such boxes inside.
2. **Voice lines too long for their scenes** (15 of 33): 8 to 13 words for 1.3 to 3 s. The prompt says about 2.5 words a
   second; it should give the counts outright ("2 s: at most 5 words; 3 s: at most 7") or the validator should stretch the
   scene or flag the line.
3. **Captions:** start with the product and the price (5 of 33 did not); always include the price when the brief has one
   (dark-minimal, hypermotion left it out); always say how to order (offer-flash did not); hashtags by platform: Facebook 0
   to 3, TikTok and Instagram 4 to 6, Shorts 1 to 3 (all six Facebook designs wrote 5 or 6).
4. **offer-flash** is a direct offer ad but dropped the number in scenes 2 to 4: its template direction should ask for the
   phone bar from the first frame to the last, as kigali-price-first does.
5. **Few words where the template says so:** golden-hour put four lines in one scene; luxury and cinematic directions should
   say "at most two short lines per scene; the features go in the voice". Showcase templates stacked three features and a
   tagline in one scene (ice-splash, ugc-before-after): one feature per scene.
6. **Template lengths** (templates.ts seconds, an owner decision): colour-options 10 s, tiktok-secret 10 s, marketplace-listing,
   offer-flash, tiktok-gadget and ugc-pov 12 s are below the research range for their platform (15 to 25 s for products,
   offers and UGC on TikTok and Facebook). The scorer no longer counts this against a design that keeps the requested length.

### The scorer's (fixed in brain/score.ts)

Before these fixes the same 33 designs averaged 89.3 (design) and 96.3 (caption).

1. **The number in every scene:** owner decision (17 October): every template keeps the number on screen in every scene;
   luxury, cinematic and minimal templates (dark-minimal, chrome-luxe, golden-hour, story-cinematic, brand-story, tv-spot,
   kigali-market) as a small quiet line (size about 0.03) with the full contact at the end. The check accepts any size, so
   a quiet line passes; until the templates change, these designs still miss it (the misses below are real for now).
2. **Lines per scene** by style: luxury 2, direct, brand and showcase 3, list, poster and card templates 5 (glass-cards,
   typography-poster, event-poster, product-hero, tiktok-3-reasons, the marketplace templates).
3. **The price early** follows the format: in the hook only when the format's first beat carries it (1.5 s on Facebook for
   direct ads), otherwise by the beat that shows it (a before/after shows it after the result); luxury and brand templates
   may keep it for the end.
4. **Length:** a design that keeps the requested length passes; the research range is a template question, not the design's.
5. **Scene count** follows the format's cut rhythm (kinetic typography may use up to 8 scenes in 10 s).
6. **Safe area** is split: the price, the number or the call to action under the app's buttons costs 7 points; other text 3;
   a giant word that runs off the canvas on purpose, or a giant background word behind the product (size above 0.22, depth
   0.35 or less: "GALAXY", "5G"), is not counted.
7. **Reading numbers** the way factcheck.ts does: "Samsung Galaxy A56 • 420,000 RWF" was read as 56,420,000, and a phone
   number on one line swallowed the price on the next (the "0" in showroom-turntable). A space or a bullet never joins two
   numbers now, phone numbers are taken out first, and digits glued to letters (A56, 5G) are model names, not amounts.
`;

/** The Seedance part of the audit: the 12 gallery examples and the starting shot plan of every Seedance template. */
function seedanceAudit(): string {
  const nova = { business: { name: "Nova Phones Kigali", description: "We sell new and refurbished smartphones, chargers and accessories in Kigali, with a one-year warranty.", language: "English", country: "Rwanda" }, product: { name: "Samsung Galaxy A56", summary: "Samsung Galaxy A56 5G, 8 GB RAM, 256 GB, in stock now in black, light blue and pink.", price: "420,000 RWF", usps: ["Genuine with 12-month warranty", "Pay with MoMo, instalments available"], features: ["6.7-inch AMOLED screen", "50 MP camera", "5,000 mAh battery"] } };
  const kitenge = { business: { name: "Kitenge Corner Kigali", description: "Fashion boutique in Kigali: kitenge dresses and shirts", language: "Kinyarwanda", country: "Rwanda" }, product: { name: "Kitenge summer dress", summary: "Light cotton kitenge dress, sizes S to XL", price: "25,000 RWF", usps: ["Made to measure in 3 days"] } };
  const dir = path.join(process.cwd(), "video-lab/seedance-mock/examples");
  const examples = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const language = d.notes.some((n: string) => /Kinyarwanda/.test(n)) ? "Kinyarwanda" : "English";
      const facts = d.source.businessName === "Nova Phones Kigali" ? nova : { business: { name: d.source.businessName }, product: { name: d.source.productName } };
      const r = scoreSeedancePrompt(d.prompt, { ...facts, business: { ...facts.business, language }, references: (d.storyboard.references ?? []).map((x: { label: string }) => x.label), seconds: d.seconds, audio: d.storyboard.audio !== false, templateId: d.templateId });
      return { id: d.id as string, template: d.templateId as string, seconds: d.seconds as number, words: String(d.prompt).split(/\s+/).length, r };
    });
  const plans = SEEDANCE_TEMPLATES.map((t) => {
    const score = (b: typeof nova | typeof kitenge) => {
      const brief = { ...b, references: ["Image 1: the product photo"], templateId: t.id, seconds: t.seconds, ratio: "9:16", audio: true };
      const plan = planSeedanceShots(brief);
      return { words: plan.words, r: scoreSeedancePrompt(plan.prompt, brief) };
    };
    return { t, nova: score(nova), kitenge: score(kitenge) };
  });
  const all = [...examples.map((e) => e.r), ...plans.flatMap((p) => [p.nova.r, p.kitenge.r])];
  const counts = new Map<string, { n: number; reason: string }>();
  for (const r of all) for (const f of r.failed) counts.set(f.id, { n: (counts.get(f.id)?.n ?? 0) + 1, reason: counts.get(f.id)?.reason ?? f.reason });
  const top = [...counts.entries()].sort((a, z) => z[1].n - a[1].n || a[0].localeCompare(z[0]));
  const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  return [
    "## Seedance",
    "",
    `\`scoreSeedancePrompt\` over the ${examples.length} gallery examples (video-lab/seedance-mock/examples, scored with their own references) and the`,
    `starting shot plan \`planSeedanceShots\` makes for each of the ${SEEDANCE_TEMPLATES.length} Seedance templates, for the Samsung Galaxy A56 at Nova Phones Kigali`,
    "(English, 420,000 RWF) and a Kitenge summer dress (Kitenge Corner Kigali, Kinyarwanda, 25,000 RWF, a sample brief), with one product",
    "photo and sound on. A Seedance prompt has no on-screen text (BuPulse overlays the price, the number and the caption, in the",
    "platform's safe area), so nothing in it depends on the platform: each prompt's score is the same for TikTok, Instagram and",
    `Facebook, and is listed once. Means: examples ${mean(examples.map((e) => e.r.score))}, plans ${mean(plans.flatMap((p) => [p.nova.r.score, p.kitenge.r.score]))}.`,
    "",
    "| Example | Template | Seconds | Words | Score | Misses |",
    "| --- | --- | --- | --- | --- | --- |",
    ...examples.map((e) => `| ${e.id.replace(/^ex-/, "")} | ${e.template} | ${e.seconds} | ${e.words} | ${e.r.score} | ${e.r.failed.map((f) => f.id).join(", ") || "none"} |`),
    "",
    "| Template | Format | Seconds | Galaxy A56 (words) | Kitenge dress (words) | Misses |",
    "| --- | --- | --- | --- | --- | --- |",
    ...plans.map((p) => `| ${p.t.id} | ${p.t.format} | ${p.t.seconds} | ${p.nova.r.score} (${p.nova.words}) | ${p.kitenge.r.score} (${p.kitenge.words}) | ${[...new Set([...p.nova.r.failed, ...p.kitenge.r.failed].map((f) => f.id))].join(", ") || "none"} |`),
    "",
    "### The most common misses",
    "",
    ...(top.length ? top.slice(0, 3).map(([id, m], i) => `${i + 1}. **${id}** in ${m.n} of ${all.length} prompts. Example: ${m.reason}`) : [`None: all ${all.length} prompts pass every check.`]),
    "",
    SEEDANCE_FINDINGS,
  ].join("\n");
}

const SEEDANCE_FINDINGS = `### Whose fault (17 October 2026)

Both prompt-writer issues below were fixed by the Seedance agent on 17 October (commit db5fe6d: prompts within 160 words
with every shot, before/after opens on the result, examples regenerated); this audit was rerun after it.

**The prompt writer's** (the Seedance agent's files: seedance-brain.ts planSeedanceShots and its templates, seedance-prompt.ts
SEEDANCE_SYSTEM and writeSeedancePrompt):

1. **Too long.** The Seedance rule (SEEDANCE_RULES "length") says 60 to 160 words, but the planner does not enforce it: every
   presenter and UGC template runs over (shop-ugc-find 205 words, phone-ugc-review 199, fashion-try-on 198,
   restaurant-ugc-taste 193, salon-transformation 182, any-ugc-review 170, education-ugc 168). The words come from the
   presenter description, two spoken lines, "with the product from Image 1 in view" on several shots and the closing
   clean-frames sentence. Trim to 160 in the planner, and make lintSeedancePrompt warn above 160 words (it warns above
   300 today). writeSeedancePrompt cuts Claude's answer at 1,800 characters (about 300 words), not at 160 words.
2. **fashion-outfit-switch opens on the "before"** (plain clothes, then the spin, then the dress). SEEDANCE_RULES "hook" and
   the research say a before/after shows the result first: open on the dress, then the plain clothes, the spin, the dress.
3. Kinyarwanda briefs are handled correctly: no spoken lines, music and ambience only.

**The scorer's** (fixed in brain/score.ts):

1. A before/after may open on the result held still ("Wait for it..."): that is the hook, not a missing motion. A new
   check asks that the result comes first.
2. More action verbs count as motion in the first shot (a hand places the parcel, the presenter shrugs, a rug unrolls).
3. The first shot may last up to 4 s (Seedance's rule is a shot every 2 to 4 s); the hook is motion in the first frame.
4. A tour may end on a wide reveal of the place (the balcony view, the front) instead of a product hero shot.
5. New checks from the Seedance rules: a length Seedance films (4 to 15 whole seconds) and a real place (a Kigali shop,
   a salon, a home, a street; a studio only for a product reveal's hero shots).
`;

// Writes docs/research/brain-audit.md: the brain's scorers over the motion engine's template sweep. Run with the sweep:
//   BRAIN_AUDIT=/path/to/quality/sweep/final npx vitest run tests/video-engine/brain.test.ts -t "brain audit"
describe.runIf(process.env.BRAIN_AUDIT)("brain audit", () => {
  it("writes docs/research/brain-audit.md", () => {
    const dir = process.env.BRAIN_AUDIT!;
    // The brief the sweep used (Nova Phones Kigali, Galaxy A56; quality/score-entry.ts).
    const nova = {
      business: { name: "Nova Phones Kigali", description: "We sell new and refurbished smartphones, chargers and accessories in Kigali, with a one-year warranty.", language: "English", phone: "+250 788 300 400", country: "Rwanda" },
      product: { name: "Samsung Galaxy A56", summary: "Samsung Galaxy A56 5G, 8 GB RAM, 256 GB, in stock now in black, light blue and pink.", price: "420,000 RWF", usps: ["Genuine with 12-month warranty", "Pay with MoMo, instalments available"], features: ["6.7-inch AMOLED screen", "50 MP camera", "5,000 mAh battery"] },
    };
    const platformOf = (category: string) => (category === "tiktok" ? "tiktok" : category === "marketplace" || category === "ads" ? "facebook" : "instagram");
    const any = SAFE_AREAS.any;
    const rows = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { spec: MotionSpec; template: string; category: string };
        const platform = platformOf(d.category);
        const brief: ScoreBrief = { ...nova, styleId: d.template, seconds: templateById(d.template).seconds ?? 12, platform };
        const design = scoreDesign(d.spec, brief, { voice: true });
        const caption = scoreCaption(d.spec.caption, d.spec.hashtags, brief);
        // Text outside the designer's own default box (no platform given), whatever the platform.
        const ownBox = d.spec.scenes.flatMap((sc) => sc.layers).filter((l) => l.kind === "text" && (l.y - l.h / 2 < any.top - 0.01 || l.y + l.h / 2 > any.bottom + 0.01 || l.x - l.w / 2 < any.left - 0.01 || l.x + l.w / 2 > any.right + 0.01) && l.x - l.w / 2 >= 0 && l.x + l.w / 2 <= 1).length;
        return { template: d.template, category: d.category, platform, style: templateStyle(d.template), design, caption, ownBox };
      })
      .sort((a, z) => a.design.score - z.design.score || a.template.localeCompare(z.template));
    const misses = new Map<string, { n: number; reason: string; where: string[] }>();
    for (const r of rows)
      for (const f of [...r.design.failed.map((x) => ({ ...x, kind: "design" })), ...r.caption.failed.map((x) => ({ ...x, kind: "caption" }))]) {
        const key = `${f.kind} ${f.id}`;
        const m = misses.get(key) ?? { n: 0, reason: f.reason, where: [] };
        m.n++;
        m.where.push(r.template);
        misses.set(key, m);
      }
    const top = [...misses.entries()].sort((a, z) => z[1].n - a[1].n || a[0].localeCompare(z[0]));
    const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
    const doc = [
      "# Brain audit of the 33-template sweep",
      "",
      "The motion engine's sweep (every template once, Samsung Galaxy A56 at Nova Phones Kigali, 420,000 RWF, WhatsApp, the brain's",
      "research block on) scored with the brain's own scorers (`lib/video-engine/brain/score.ts`): `scoreDesign` with the voice on, and",
      "`scoreCaption`. Platform by template category: TikTok for the TikTok templates, Facebook for marketplace and ads, Instagram",
      "otherwise. **The sweep briefs carried no platform**, so the designer used its default safe area (y 0.12 to 0.82, x 0.07 to 0.93)",
      "and default hashtags; the column \"outside own box\" counts text outside that default, which is the designer's own rule.",
      "",
      `Made by \`BRAIN_AUDIT=<sweep dir> npx vitest run tests/video-engine/brain.test.ts -t "brain audit"\`. Means: design ${mean(rows.map((r) => r.design.score))}, caption ${mean(rows.map((r) => r.caption.score))}.`,
      "",
      "| Template | Category | Platform | Style | Design | Caption | Outside own box | Design misses | Caption misses |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...[...rows].sort((a, z) => a.template.localeCompare(z.template)).map((r) => `| ${r.template} | ${r.category} | ${r.platform} | ${r.style} | ${r.design.score} | ${r.caption.score} | ${r.ownBox} | ${r.design.failed.map((f) => f.id).join(", ") || "none"} | ${r.caption.failed.map((f) => f.id).join(", ") || "none"} |`),
      "",
      "## The three most common misses",
      "",
      ...top.slice(0, 3).map(([key, m], i) => `${i + 1}. **${key}** in ${m.n} of ${rows.length} designs. Example: ${m.reason}`),
      "",
      "All misses by count: " + top.map(([key, m]) => `${key} ${m.n}`).join(", ") + ".",
      "",
      "## The five lowest designs",
      "",
      ...rows.slice(0, 5).flatMap((r) => [`**${r.template}** (${r.category}, ${r.platform}, ${r.style}): design ${r.design.score}, caption ${r.caption.score}.`, "", ...[...r.design.failed, ...r.caption.failed].map((f) => `- ${f.id}${f.scene !== null ? ` (scene ${f.scene + 1})` : ""}: ${f.reason}`), ""]),
      AUDIT_FINDINGS,
      seedanceAudit(),
    ].join("\n");
    fs.writeFileSync(path.join(process.cwd(), "docs/research/brain-audit.md"), `${doc}\n`);
    expect(rows.length).toBe(33);
  });
});
