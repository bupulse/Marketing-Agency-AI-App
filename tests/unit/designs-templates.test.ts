import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { ASPECT_RATIOS, ASPECT_SIZES, buildTheme, clampText, estimateLines, fitFontSize, orientationOf, type TemplateInput } from "@/lib/designs/layout";
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
  it("renders PNG bytes for 7 templates x 4 ratios, with and without a photo", async () => {
    const photoPng = await new ImageResponse(
      createElement("div", { style: { display: "flex", width: "100%", height: "100%", backgroundImage: "linear-gradient(160deg, #1d3557, #e63946 60%, #f1faee)" } }),
      { width: 800, height: 800 },
    ).arrayBuffer();
    const photoDataUrl = `data:image/png;base64,${Buffer.from(photoPng).toString("base64")}`;
    const out = process.env.DESIGNS_OUT;
    if (out) mkdirSync(out, { recursive: true });

    for (const id of IDS) {
      for (const ratio of ASPECT_RATIOS) {
        for (const withPhoto of [false, true]) {
          const bytes = await renderTemplate(id, { ...base, photoDataUrl: withPhoto ? photoDataUrl : null }, ratio);
          const buf = Buffer.from(bytes);
          expect(buf.length).toBeGreaterThan(2000);
          expect(buf.subarray(1, 4).toString()).toBe("PNG");
          const { width, height } = ASPECT_SIZES[ratio];
          expect(buf.readUInt32BE(16)).toBe(width);
          expect(buf.readUInt32BE(20)).toBe(height);
          if (out) writeFileSync(join(out, `${id}-${ratio.replace(":", "x")}-${withPhoto ? "photo" : "plain"}.png`), buf);
        }
      }
    }
  }, 120_000);

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
