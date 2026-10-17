import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAIN, FORMATS, PLATFORMS, SECTORS, checkBrain, type BrainBrief, type BrainData, type Engine } from "@/lib/video-engine/brain";
import { evidenceFromRows, parseCount, parseDate, parseJsonl, rowKey, tiktokDate } from "@/lib/video-engine/brain/ingest";
import { CONTEXT_MAX_CHARS, ENGINE_SECONDS, brainBriefFromDesign, brainBriefFromPrompt, brainContext, brainFor, formatFromTemplate, scaleTimeline, sectorFromText } from "@/lib/video-engine/brain/select";
import type { DesignBrief } from "@/lib/video-engine/designer";
import { BUSINESS_KINDS, SEEDANCE_FORMATS } from "@/lib/video-engine/seedance-brain";
import type { PromptBrief } from "@/lib/video-engine/seedance-prompt";
import { VIDEO_TEMPLATES } from "@/lib/video-engine/templates";

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
    for (const source of ["tiktok", "facebook", "instagram"] as const) {
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
        const found = row && rowKey(row) === e.key ? row : rows.find((r) => rowKey(r) === e.key);
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
              expect(text).toContain("Timeline to follow");
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
    expect(phone.hooks.map((h) => h.id)).toEqual(["number-in-hand", "spec-words", "price-banner"]);
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
