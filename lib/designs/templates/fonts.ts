// Fonts for next/og (Satori). Satori only reads TTF/OTF/WOFF and next/og bundles just one
// Latin font, so we fetch Inter (OFL) per script subset from the Fontsource CDN once per
// isolate and cache it (also in the Workers Cache API, so a cold isolate does not refetch). If the CDN is unreachable the render falls back to next/og's
// built-in font, so a design is always produced.

import { edgeGet, edgePut } from "@/lib/designs/edge-cache";
import type { PackId } from "@/lib/designs/packs";

export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 | 800; style: "normal" };

// Pinned so a CDN update can never change or break renders; bump after checking the output.
const FONTSOURCE_VERSION = "5.3.0";
const INTER_VERSION = FONTSOURCE_VERSION;
const BASE = "https://cdn.jsdelivr.net/fontsource/fonts";
const WEIGHTS = [500, 800] as const;

export const FONT_FAMILY = "Inter, Cairo";

// Extra display families for the style packs (all SIL OFL, from the same CDN). Inter stays in the
// list after them so glyphs a display font lacks (Cyrillic for Anton, say) still draw.
type PackFont = { name: string; slug: string; weight: 400 | 700 | 800; subsets: readonly string[] };
const PACK_FONTS: Partial<Record<PackId, PackFont>> = {
  elegant: { name: "Playfair Display", slug: "playfair-display", weight: 700, subsets: ["latin", "latin-ext", "vietnamese", "cyrillic"] },
  bold: { name: "Anton", slug: "anton", weight: 400, subsets: ["latin", "latin-ext", "vietnamese"] },
  warm: { name: "Nunito", slug: "nunito", weight: 800, subsets: ["latin", "latin-ext", "vietnamese", "cyrillic"] },
  playful: { name: "Nunito", slug: "nunito", weight: 800, subsets: ["latin", "latin-ext", "vietnamese", "cyrillic"] },
};

/** CSS font-family list for a pack's text. */
export function fontFamilyFor(pack?: PackId): string {
  const display = pack ? PACK_FONTS[pack] : undefined;
  return display ? `${display.name}, ${FONT_FAMILY}` : FONT_FAMILY;
}

const FONT_CACHE_SECONDS = 60 * 60 * 24 * 30;

async function fetchFont(url: string): Promise<ArrayBuffer | null> {
  const key = `font/${url.slice(BASE.length + 1)}`;
  const cached = await edgeGet(key);
  if (cached) return cached;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    await edgePut(key, bytes, "font/woff", FONT_CACHE_SECONDS);
    return bytes;
  } catch {
    return null;
  }
}

const interPromises = new Map<string, Promise<OgFont[]>>();

/** One Inter subset (both weights), cached per isolate. A missing Latin subset is retried on the next render. */
function loadInter(subset: string): Promise<OgFont[]> {
  let promise = interPromises.get(subset);
  if (!promise) {
    promise = (async () => {
      const jobs = WEIGHTS.map(async (weight) => {
        const data = await fetchFont(`${BASE}/inter@${INTER_VERSION}/${subset}-${weight}-normal.woff`);
        return data ? ({ name: "Inter", data, weight, style: "normal" } as OgFont) : null;
      });
      const fonts = (await Promise.all(jobs)).filter((f): f is OgFont => f !== null);
      if (fonts.length < WEIGHTS.length) interPromises.delete(subset);
      return fonts;
    })();
    interPromises.set(subset, promise);
  }
  return promise;
}

let arabicPromise: Promise<OgFont[]> | undefined;

function loadArabic(): Promise<OgFont[]> {
  arabicPromise ??= (async () => {
    const jobs = WEIGHTS.map(async (weight) => {
      const data = await fetchFont(`${BASE}/${ARABIC_FONT}@${FONTSOURCE_VERSION}/arabic-${weight}-normal.woff`);
      return data ? ({ name: "Cairo", data, weight, style: "normal" } as OgFont) : null;
    });
    const fonts = (await Promise.all(jobs)).filter((f): f is OgFont => f !== null);
    if (fonts.length === 0) arabicPromise = undefined;
    return fonts;
  })();
  return arabicPromise;
}

const ARABIC_FONT = "cairo";
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

const displayPromises = new Map<string, Promise<OgFont | null>>();

function loadDisplay(font: PackFont, subset: string): Promise<OgFont | null> {
  const key = `${font.slug}/${subset}/${font.weight}`;
  let promise = displayPromises.get(key);
  if (!promise) {
    promise = fetchFont(`${BASE}/${font.slug}@${FONTSOURCE_VERSION}/${subset}-${font.weight}-normal.woff`).then((data) =>
      data ? { name: font.name, data, weight: font.weight, style: "normal" } : null,
    );
    displayPromises.set(key, promise);
    // A failed fetch is retried on the next render.
    void promise.then((f) => f ?? displayPromises.delete(key));
  }
  return promise;
}

// Script ranges that need their own subset; Latin is always loaded.
const NEEDS: Record<string, RegExp> = {
  "latin-ext": /[\u0100-\u024F\u1E00-\u1EFF\u2C60-\u2C7F\uA720-\uA7FF]/,
  vietnamese: /[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/,
  cyrillic: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/,
};

function subsetsFor(text: string, available: readonly string[]): string[] {
  return available.filter((s) => s === "latin" || NEEDS[s]?.test(text));
}

const INTER_SUBSETS = ["latin", "latin-ext", "vietnamese", "cyrillic", "greek"] as const;

/** Fonts to hand to ImageResponse for this text. Only the script subsets the text uses are fetched. */
export async function loadFonts(text: string, pack?: PackId): Promise<OgFont[]> {
  const display = pack ? PACK_FONTS[pack] : undefined;
  const [inter, arabic, extra] = await Promise.all([
    Promise.all(subsetsFor(text, INTER_SUBSETS).map(loadInter)),
    ARABIC.test(text) ? loadArabic() : Promise.resolve([]),
    Promise.all(display ? subsetsFor(text, display.subsets).map((s) => loadDisplay(display, s)) : []),
  ]);
  return [...extra.filter((f): f is OgFont => f !== null), ...inter.flat(), ...arabic];
}
