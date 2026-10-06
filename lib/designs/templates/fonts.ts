// Fonts for next/og (Satori). Satori only reads TTF/OTF/WOFF and next/og bundles just one
// Latin font, so we fetch Inter (OFL) per script subset from the Fontsource CDN once per
// isolate and cache it. If the CDN is unreachable the render falls back to next/og's
// built-in font, so a design is always produced.

export type OgFont = { name: string; data: ArrayBuffer; weight: 500 | 800; style: "normal" };

const BASE = "https://cdn.jsdelivr.net/fontsource/fonts";
const WEIGHTS = [500, 800] as const;
// Subsets Satori can fall back across glyph by glyph (same family name).
const INTER_SUBSETS = ["latin", "latin-ext", "cyrillic", "greek", "vietnamese"] as const;

export const FONT_FAMILY = "Inter, Cairo";

async function fetchFont(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

let interPromise: Promise<OgFont[]> | undefined;

function loadInter(): Promise<OgFont[]> {
  interPromise ??= (async () => {
    const jobs = INTER_SUBSETS.flatMap((subset) =>
      WEIGHTS.map(async (weight) => {
        const data = await fetchFont(`${BASE}/inter@latest/${subset}-${weight}-normal.woff`);
        return data ? ({ name: "Inter", data, weight, style: "normal" } as OgFont) : null;
      }),
    );
    const fonts = (await Promise.all(jobs)).filter((f): f is OgFont => f !== null);
    // Without the Latin subset, retry on the next render instead of caching a broken set.
    if (fonts.length < WEIGHTS.length) interPromise = undefined;
    return fonts;
  })();
  return interPromise;
}

let arabicPromise: Promise<OgFont[]> | undefined;

function loadArabic(): Promise<OgFont[]> {
  arabicPromise ??= (async () => {
    const jobs = WEIGHTS.map(async (weight) => {
      const data = await fetchFont(`${BASE}/${ARABIC_FONT}@latest/arabic-${weight}-normal.woff`);
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

/** Fonts to hand to ImageResponse for this text. Arabic is only fetched when the text needs it. */
export async function loadFonts(text: string): Promise<OgFont[]> {
  const [inter, arabic] = await Promise.all([loadInter(), ARABIC.test(text) ? loadArabic() : Promise.resolve([])]);
  return [...inter, ...arabic];
}
