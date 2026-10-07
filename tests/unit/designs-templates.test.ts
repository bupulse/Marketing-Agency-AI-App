import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { ASPECT_RATIOS, ASPECT_SIZES, buildTheme, clampText, estimateLines, fitFontSize, orientationOf, type TemplateInput } from "@/lib/designs/layout";
import { buildImagePrompt } from "@/lib/designs/prompt";
import { buildSceneBrief } from "@/lib/designs/photo-scene";
import { defaultKicker } from "@/lib/designs/labels";
import { PACKS, recommendPack, type PackId } from "@/lib/designs/packs";
import { buildTemplateElement, renderTemplate, TEMPLATES, templatesForProjectType } from "@/lib/designs/templates";

const IDS = ["new-arrival", "offer", "event", "just-listed", "project-done", "quote", "announcement"];

describe("template registry", () => {
  it("has the seven templates with fields and project types", () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual([...IDS].sort());
    for (const t of TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.suits.length).toBeGreaterThan(0);
      expect(t.fields.headline.label).toBeTruthy();
    }
  });

  it("orders templates by project type, keeping all of them", () => {
    const order = templatesForProjectType("event");
    expect(order[0]).toBe("event");
    expect(order).toHaveLength(IDS.length);
  });
});

describe("layout helpers", () => {
  it("defines the four sizes", () => {
    expect(ASPECT_SIZES).toEqual({
      "1:1": { width: 1080, height: 1080 },
      "4:5": { width: 1080, height: 1350 },
      "9:16": { width: 1080, height: 1920 },
      "16:9": { width: 1920, height: 1080 },
    });
    expect(orientationOf("9:16")).toBe("tall");
    expect(orientationOf("16:9")).toBe("wide");
    expect(orientationOf("1:1")).toBe("square");
  });

  it("shrinks long headlines but never below the minimum", () => {
    const short = fitFontSize("Big sale", 900, 400, { maxSize: 110, minSize: 44 });
    const long = fitFontSize("Our biggest summer clearance sale of the whole year starts this weekend only", 900, 400, { maxSize: 110, minSize: 44 });
    expect(short).toBe(110);
    expect(long).toBeLessThan(short);
    expect(fitFontSize("x ".repeat(500), 900, 100, { maxSize: 110, minSize: 44 })).toBe(44);
  });

  it("counts wrapped lines, breaking over-long words", () => {
    expect(estimateLines("one two", 100, 2000)).toBe(1);
    expect(estimateLines("a".repeat(100), 100, 600)).toBeGreaterThan(1);
  });

  it("clamps text on a word boundary", () => {
    expect(clampText("short", 20)).toBe("short");
    expect(clampText("one two three four five six", 15).endsWith("…")).toBe(true);
    expect(clampText("one two three four five six", 15).length).toBeLessThanOrEqual(15);
  });

  it("builds a readable theme from one colour or none", () => {
    expect(buildTheme(null).primary).toBe("#2F6BFF");
    const light = buildTheme(["#FFEE88"]);
    expect(light.text).toBe("#0B0B0F");
    expect(light.secondary).not.toBe(light.primary);
    expect(buildTheme(["#101030"]).text).toBe("#FFFFFF");
  });
});

const base: TemplateInput = {
  businessName: "Sunrise Bakery",
  colors: ["#E4572E", "#F3A712"],
  headline: "Fresh sourdough every morning",
  subline: "Baked slowly, sold warm",
  chip: "From $8",
};

describe("template rendering", () => {
  it("builds an element tree for every template and ratio", () => {
    for (const id of IDS) for (const ratio of ASPECT_RATIOS) expect(buildTemplateElement(id, base, ratio)).toBeTruthy();
  });

  it("rejects an unknown template", () => {
    expect(() => buildTemplateElement("nope", base, "1:1")).toThrow(/Unknown template/);
  });

  // next/og runs in vitest's node env; fonts come from a CDN and fall back to the built-in one offline.
  it("renders PNG bytes for 5 packs x 7 templates x 4 ratios, with and without a photo", async () => {
    const photoPng = await new ImageResponse(
      createElement("div", { style: { display: "flex", width: "100%", height: "100%", backgroundImage: "radial-gradient(circle at 30% 35%, #f4d35e 0%, rgba(244,211,94,0) 28%), radial-gradient(circle at 75% 70%, #ee964b 0%, rgba(238,150,75,0) 30%), linear-gradient(160deg, #1d3557, #e63946 60%, #f1faee)" } }),
      { width: 800, height: 800 },
    ).arrayBuffer();
    const photoDataUrl = `data:image/png;base64,${Buffer.from(photoPng).toString("base64")}`;
    const out = process.env.DESIGNS_OUT;
    if (out) mkdirSync(out, { recursive: true });

    for (const pack of PACKS.map((p) => p.id)) for (const id of IDS) {
      for (const ratio of ASPECT_RATIOS) {
        for (const withPhoto of ratio === "1:1" || ratio === "9:16" || out ? [false, true] : [false]) {
          const bytes = await renderTemplate(id, { ...base, pack, photoDataUrl: withPhoto ? photoDataUrl : null }, ratio);
          const buf = Buffer.from(bytes);
          expect(buf.length).toBeGreaterThan(2000);
          expect(buf.subarray(1, 4).toString()).toBe("PNG");
          const { width, height } = ASPECT_SIZES[ratio];
          expect(buf.readUInt32BE(16)).toBe(width);
          expect(buf.readUInt32BE(20)).toBe(height);
          if (out) writeFileSync(join(out, `${pack}-${id}-${ratio.replace(":", "x")}-${withPhoto ? "photo" : "plain"}.png`), buf);
        }
      }
    }
  }, 600_000);

  it("copes with very long text, missing chip and a single brand colour", async () => {
    const bytes = await renderTemplate(
      "offer",
      { businessName: "A very long business name that keeps going and going", colors: ["#00AA66"], headline: "Supercalifragilisticexpialidocious ".repeat(8), subline: "x ".repeat(200), chip: null },
      "4:5",
    );
    expect(bytes.byteLength).toBeGreaterThan(2000);
  }, 30_000);

  it("documents that Satori cannot decode WebP (the service rejects WebP template photos)", async () => {
    const webp = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
    await expect(renderTemplate("offer", { ...base, photoDataUrl: webp }, "1:1")).rejects.toThrow();
  }, 30_000);

  it("renders Cyrillic and Arabic text without failing", async () => {
    for (const headline of ["Свежий хлеб каждое утро", "خبز طازج كل صباح"]) {
      const bytes = await renderTemplate("new-arrival", { ...base, headline, subline: headline, chip: null }, "1:1");
      expect(bytes.byteLength).toBeGreaterThan(2000);
      if (process.env.DESIGNS_OUT) writeFileSync(join(process.env.DESIGNS_OUT, `lang-${headline.length}.png`), Buffer.from(bytes));
    }
  }, 60_000);
});

describe("style packs", () => {
  it("lists five packs", () => {
    expect(PACKS.map((p) => p.id).sort()).toEqual(["bold", "clean", "elegant", "playful", "warm"]);
  });

  it("picks the pack from the brand voice first", () => {
    expect(recommendPack({ tone: "luxury", industry: "Gyms & fitness" })).toBe("elegant");
    expect(recommendPack({ tone: "caring" })).toBe("elegant");
    expect(recommendPack({ tone: "bold", industry: "Salons & beauty" })).toBe("bold");
    expect(recommendPack({ tone: "playful", industry: "Professional services" })).toBe("playful");
  });

  it("falls back to the industry, then to the generic voices", () => {
    expect(recommendPack({ tone: "friendly", industry: "Salons & beauty" })).toBe("elegant");
    expect(recommendPack({ tone: "professional", industry: "Gyms & fitness" })).toBe("bold");
    expect(recommendPack({ tone: null, industry: "Restaurants & cafés" })).toBe("warm");
    expect(recommendPack({ tone: "friendly", industry: "Shops & retail" })).toBe("warm");
    expect(recommendPack({ tone: "professional", industry: "Phones & electronics" })).toBe("clean");
    expect(recommendPack({})).toBe("clean");
  });

  it("follows the content language for default labels, falling back to English", () => {
    expect(defaultKicker("new-arrival", "French")).toBe("Nouveauté");
    expect(defaultKicker("offer", "Spanish")).toBe("Oferta especial");
    expect(defaultKicker("offer", "English")).toBe("Special offer");
    expect(defaultKicker("offer", "Japanese")).toBe("Special offer");
    expect(defaultKicker("offer", null)).toBe("Special offer");
    expect(defaultKicker("quote", "French")).toBe("");
  });

  it("uses the translated label unless the user gave one", () => {
    const element = (kicker?: string | null) => JSON.stringify(buildTemplateElement("announcement", { ...base, language: "French", kicker }, "1:1"));
    expect(element()).toContain("Annonce");
    expect(element("Nouveau")).not.toContain("Annonce");
    expect(element("")).not.toContain("Annonce");
  });

  it("builds every pack with a long headline and no chip without throwing", () => {
    for (const pack of PACKS.map((p): PackId => p.id)) for (const ratio of ASPECT_RATIOS) expect(buildTemplateElement("event", { ...base, pack, chip: null, headline: "word ".repeat(40) }, ratio)).toBeTruthy();
  });

  it("keeps prices, percentages, dates and quoted text out of the image prompt", () => {
    const scene = buildSceneBrief({ template: "offer", aspectRatio: "1:1", headline: 'Fresh bread: 50% OFF $20 this Friday "Buy 2"' });
    const prompt = buildImagePrompt({ business: { name: "Sunrise Bakery", industry: "Bakery" }, prompt: scene, aspectRatio: "1:1" });
    expect(prompt).toContain("Fresh bread");
    expect(prompt).not.toMatch(/[\d%$€£]|friday|off\b|buy/i);
    expect(prompt).toContain("Do not put any text");
  });

  it("falls back to English labels for Arabic", () => {
    expect(defaultKicker("offer", "Arabic")).toBe("Special offer");
  });
});
