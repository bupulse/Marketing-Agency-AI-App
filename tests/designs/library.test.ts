// The design library (docs/DESIGNS.md, "Design library"). Rendering every design in every aspect takes a while (about a
// second each), so CI renders 48 (every family in several styles, aspects and variants, photo on and off) and builds the
// element tree of every design in every aspect. DESIGNS_FULL=1 renders all of them in all four aspects; DESIGNS_OUT=/dir also writes the PNGs to look at.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { ImageResponse } from "next/og";
import { contrastRatio } from "@/lib/color-contrast";
import { ASPECT_RATIOS, ASPECT_SIZES } from "@/lib/designs/layout";
import { PACKS, recommendPack } from "@/lib/designs/packs";
import { ANGLES, chooseDesign, DESIGNS, designCounts, designWithoutPhoto, FAMILIES, getDesign, isDesignId, VARIANTS_PER_FAMILY, type Knobs } from "@/lib/designs/library/catalog";
import { palette } from "@/lib/designs/library/kit";
import { buildDesignElement, renderDesign } from "@/lib/designs/library/render";
import { SAMPLE_PHOTO_STYLE, sampleInput } from "@/lib/designs/library/samples";
import { STYLES } from "@/lib/designs/library/styles";
import { featureItems } from "@/lib/designs/library/families/text";

const FULL = process.env.DESIGNS_FULL === "1";
const OUT = process.env.DESIGNS_OUT;

describe("catalogue", () => {
  it("has 12 styles with 14 families x 7 variants each, ids unique and stable", () => {
    expect(PACKS).toHaveLength(12);
    const counts = designCounts();
    for (const p of PACKS) expect(counts[p.id]).toBe(FAMILIES.length * VARIANTS_PER_FAMILY);
    expect(FAMILIES).toHaveLength(14);
    expect(new Set(DESIGNS.map((d) => d.id)).size).toBe(DESIGNS.length);
    for (const d of DESIGNS) expect(d.id).toMatch(new RegExp(`^${d.style}/${d.family}-0[1-7]$`));
    expect(getDesign("warm/split-03")?.family).toBe("split");
    expect(isDesignId("warm/split-99")).toBe(false);
  });

  it("makes neighbouring variants differ in at least two knobs", () => {
    const keys: (keyof Knobs)[] = ["tone", "motif", "flip", "shape", "accent", "scale", "center"];
    for (const p of PACKS) {
      for (const f of FAMILIES) {
        const list = DESIGNS.filter((d) => d.style === p.id && d.family === f.id);
        for (let i = 1; i < list.length; i++) {
          const diff = keys.filter((k) => list[i].knobs[k] !== list[i - 1].knobs[k]).length;
          expect(diff, `${list[i].id}`).toBeGreaterThanOrEqual(2);
        }
        expect(new Set(list.map((d) => JSON.stringify(d.knobs))).size).toBe(list.length);
      }
    }
  });

  it("only uses motifs the style has", () => {
    for (const d of DESIGNS) expect(d.knobs.motif < STYLES[d.style].motifs.length).toBe(true);
  });
});

describe("legibility", () => {
  const brands = [[], ["#E4572E", "#F3A712"], ["#FFE66D"], ["#1D3557", "#A8DADC"], ["#777777"], ["#FFFFFF"], ["#000000"], ["#00FF66", "#FF00AA"], ["#2E7D32"], ["#8E44AD", "#F1C40F", "#2ECC71"]];

  it("keeps text at WCAG AA on every surface of every style, for any brand colours", () => {
    for (const p of PACKS) {
      for (const colors of brands) {
        const { surfaces } = palette(STYLES[p.id], colors);
        for (const [tone, sf] of Object.entries(surfaces)) {
          const label = `${p.id} ${tone} ${colors.join(",")}`;
          expect(contrastRatio(sf.fg, sf.bg), label).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(sf.fg, sf.bg2), label).toBeGreaterThanOrEqual(4.5);
          expect(sf.hi === sf.fg || contrastRatio(sf.hi, sf.bg) >= 3, label).toBe(true);
          expect(contrastRatio(sf.onHi, sf.hi), label).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

describe("chooseDesign", () => {
  const base = { style: "warm" as const, angle: "new" as const, aspect: "4:5" as const, hasPhoto: true, textLength: 60, recent: [] as string[] };

  it("is deterministic and stays in the style", () => {
    const a = chooseDesign(base);
    expect(chooseDesign(base)).toBe(a);
    expect(getDesign(a)?.style).toBe("warm");
    expect(getDesign(a)?.fits).toContain("new");
  });

  it("never picks a photo design without a photo, and prefers text designs for tips", () => {
    for (const angle of ANGLES) {
      const id = chooseDesign({ ...base, angle, hasPhoto: false });
      expect(getDesign(id)?.needsPhoto).toBe(false);
    }
    expect(getDesign(chooseDesign({ ...base, angle: "tips", hasPhoto: false }))?.fits).toContain("tips");
    expect(getDesign(chooseDesign({ ...base, angle: "price", hasPhoto: false }))?.fits).toContain("price");
  });

  it("does not repeat recent designs and changes layout family after a recent one", () => {
    const recent: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = chooseDesign({ ...base, recent, seed: "post" });
      expect(recent).not.toContain(id);
      if (recent[0]) expect(getDesign(id)?.family).not.toBe(getDesign(recent[0])?.family);
      recent.unshift(id);
    }
  });

  it("spreads ties by seed and respects text capacity", () => {
    const picks = new Set(Array.from({ length: 20 }, (_, i) => chooseDesign({ ...base, seed: `c${i}` })));
    expect(picks.size).toBeGreaterThan(1);
    const long = getDesign(chooseDesign({ ...base, angle: "general", textLength: 190 }))!;
    expect(long.capacity).toBeGreaterThanOrEqual(150);
  });

  it("falls back to a no-photo design of the same style", () => {
    const photoOnly = DESIGNS.find((d) => d.style === "luxe" && d.needsPhoto)!;
    const other = getDesign(designWithoutPhoto(photoOnly.id))!;
    expect(other.style).toBe("luxe");
    expect(other.needsPhoto).toBe(false);
  });

  it("recommends the new styles from industry and voice", () => {
    expect(recommendPack({ tone: "luxury", industry: "Real estate" })).toBe("luxe");
    expect(recommendPack({ tone: "luxury", industry: "Jewellery" })).toBe("luxe");
    expect(recommendPack({ industry: "Hotels & travel" })).toBe("earthy");
    expect(recommendPack({ industry: "Clinics & health" })).toBe("fresh");
    expect(recommendPack({ tone: "caring", industry: "Clinics & health" })).toBe("fresh");
    expect(recommendPack({ industry: "IT & software" })).toBe("corporate");
    expect(recommendPack({ tone: "friendly", industry: "Schools & training" })).toBe("vibrant");
    expect(recommendPack({ industry: "Barber shop" })).toBe("retro");
    expect(recommendPack({ industry: "Architecture studio" })).toBe("minimal");
  });

  it("splits feature lists for the feature grid", () => {
    expect(featureItems("Fast · Free delivery · 2-year warranty")).toEqual(["Fast", "Free delivery", "2-year warranty"]);
    expect(featureItems("One plain sentence")).toEqual(["One plain sentence"]);
    expect(featureItems("")).toEqual([]);
  });
});

async function samplePhoto(): Promise<string> {
  const png = await new ImageResponse(createElement("div", { style: SAMPLE_PHOTO_STYLE }), { width: 800, height: 800 }).arrayBuffer();
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

describe("rendering", () => {
  it("builds the element tree of every design in every aspect", () => {
    for (const [i, d] of DESIGNS.entries()) {
      for (const ratio of ASPECT_RATIOS) expect(buildDesignElement(d.id, sampleInput(d.fits[0], i % 4, i % 2 ? "data:image/png;base64,AAAA" : null), ratio)).toBeTruthy();
    }
    expect(() => buildDesignElement("nope/hero-01", sampleInput("new"), "1:1")).toThrow(/Unknown design/);
  });

  // Satori must not throw for any design. CI: a rotating sample; DESIGNS_FULL=1: all of them.
  it(
    FULL ? "renders every design in every aspect" : "renders a rotating sample of designs (DESIGNS_FULL=1 for all)",
    async () => {
      const photo = await samplePhoto();
      if (OUT) mkdirSync(OUT, { recursive: true });
      const jobs = FULL
        ? DESIGNS.flatMap((d, i) => ASPECT_RATIOS.map((ratio, r) => ({ d, ratio, withPhoto: d.usesPhoto && (d.needsPhoto || (i + r) % 2 === 0), palette: (i + r) % 4 })))
        : // 4 per style, 48 in all: every family three or four times, in rotating styles, variants and aspects.
          PACKS.flatMap((p, s) =>
            [0, 1, 2, 3].map((n) => {
              const f = FAMILIES[(s * 4 + n) % FAMILIES.length];
              const d = DESIGNS.find((x) => x.style === p.id && x.family === f.id && x.variant === ((s + n) % VARIANTS_PER_FAMILY) + 1)!;
              return { d, ratio: ASPECT_RATIOS[(s + n) % 4], withPhoto: d.needsPhoto || (s + n) % 2 === 0, palette: (s + n) % 4 };
            }),
          );
      for (const { d, ratio, withPhoto, palette: pal } of jobs) {
        const bytes = Buffer.from(await renderDesign(d.id, sampleInput(d.fits[0], pal, withPhoto ? photo : null), ratio));
        expect(bytes.subarray(1, 4).toString(), d.id).toBe("PNG");
        expect(bytes.readUInt32BE(16)).toBe(ASPECT_SIZES[ratio].width);
        expect(bytes.readUInt32BE(20)).toBe(ASPECT_SIZES[ratio].height);
        if (OUT) writeFileSync(join(OUT, `${d.id.replace("/", "-")}-${ratio.replace(":", "x")}${withPhoto ? "-photo" : ""}.png`), bytes);
      }
    },
    FULL ? 3_600_000 : 300_000,
  );

  it("copes with very long text, other scripts and no brand colours", async () => {
    const long = { ...sampleInput("general"), headline: "Supercalifragilisticexpialidocious ".repeat(8), subline: "x ".repeat(200), chip: "A very long call to action that keeps going", colors: [] };
    for (const id of ["bold/banner-01", "luxe/quote-02", "corporate/features-03", "vibrant/price-04"]) {
      expect((await renderDesign(id, long, "4:5")).byteLength).toBeGreaterThan(2000);
    }
    for (const headline of ["Свежий хлеб каждое утро", "خبز طازج كل صباح", "Bánh mì tươi mỗi sáng"]) {
      expect((await renderDesign("earthy/split-01", { ...sampleInput("new"), headline, subline: headline }, "1:1")).byteLength).toBeGreaterThan(2000);
    }
  }, 120_000);
});
