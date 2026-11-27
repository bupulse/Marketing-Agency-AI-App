import type { BannerFont } from "@/lib/site-banner";

// The site banner's fonts (Admin -> Settings -> Site banner). "default" is the site's own Geist and "mono" Geist Mono,
// both loaded by the root layout. The others come from Google Fonts only when the banner uses them: <BannerFontLink>
// adds the one stylesheet (React puts it in the head once). next/font is not used here: Turbopack refused extra
// Google fonts in this setup (27 Nov 2026).

const GOOGLE: Partial<Record<BannerFont, { css: string; family: string }>> = {
  bold: { css: "Bricolage+Grotesque:wght@600;800", family: "'Bricolage Grotesque', var(--font-geist-sans), sans-serif" },
  elegant: { css: "Playfair+Display:wght@500;700", family: "'Playfair Display', Georgia, serif" },
  handwritten: { css: "Caveat:wght@600;700", family: "'Caveat', cursive" },
};

/** The classes for the banner's font (weight and size nudges where a font runs small or large). */
export const BANNER_FONT_CLASS: Record<BannerFont, string> = {
  default: "",
  bold: "font-extrabold tracking-tight",
  elegant: "font-semibold",
  handwritten: "text-[1.25em] font-bold leading-none",
  mono: "font-mono tracking-tight",
};

/** The CSS font-family for fonts that come from Google, else undefined (the class is enough). */
export function bannerFontFamily(font: BannerFont): string | undefined {
  return GOOGLE[font]?.family;
}

/** Loads the font's stylesheet from Google Fonts, for the fonts that need it. */
export function BannerFontLink({ font }: { font: BannerFont }) {
  const g = GOOGLE[font];
  if (!g) return null;
  return <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${g.css}&display=swap`} precedence="default" />;
}
