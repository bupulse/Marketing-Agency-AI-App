// Decorative patterns for the design library, as SVG data URLs (Satori draws an <img> of an SVG through resvg; CSS
// background patterns are not reliable in Satori). Built from the brand colours at render time, so nothing is stored.
// The earthy patterns are generic geometry (zigzags, triangles, mud-cloth-like marks), not any one culture's motifs.
import type { Motif } from "./styles";

type Tile = { w: number; h: number; body: (c: string, sw: number) => string };

const TILES: Record<Motif, Tile> = {
  grid: { w: 90, h: 90, body: (c, sw) => `<path d="M90 0H0V90" fill="none" stroke="${c}" stroke-width="${sw * 0.6}"/>` },
  hairlines: { w: 60, h: 60, body: (c, sw) => `<path d="M0 30H60" stroke="${c}" stroke-width="${sw * 0.5}"/>` },
  plus: { w: 80, h: 80, body: (c, sw) => `<path d="M40 30V50M30 40H50" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>` },
  dots: { w: 44, h: 44, body: (c) => `<circle cx="22" cy="22" r="5" fill="${c}"/>` },
  diagonal: { w: 40, h: 40, body: (c, sw) => `<path d="M-10 10L10 -10M0 40L40 0M30 50L50 30" stroke="${c}" stroke-width="${sw}"/>` },
  zigzag: { w: 60, h: 34, body: (c, sw) => `<path d="M0 26L15 8L30 26L45 8L60 26" fill="none" stroke="${c}" stroke-width="${sw * 1.2}" stroke-linejoin="round"/>` },
  waves: { w: 120, h: 40, body: (c, sw) => `<path d="M0 20C20 4 40 4 60 20S100 36 120 20" fill="none" stroke="${c}" stroke-width="${sw * 1.1}"/>` },
  rings: { w: 120, h: 120, body: (c, sw) => `<circle cx="60" cy="60" r="34" fill="none" stroke="${c}" stroke-width="${sw}"/><circle cx="60" cy="60" r="14" fill="none" stroke="${c}" stroke-width="${sw * 0.7}"/>` },
  confetti: {
    w: 160,
    h: 160,
    body: (c, sw) =>
      `<rect x="18" y="22" width="22" height="9" rx="4" fill="${c}" transform="rotate(28 29 26)"/><circle cx="110" cy="34" r="7" fill="${c}"/><path d="M70 100l12 -14l12 14" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/><rect x="122" y="112" width="20" height="8" rx="4" fill="${c}" transform="rotate(-24 132 116)"/><circle cx="34" cy="128" r="5" fill="${c}"/>`,
  },
  arches: { w: 120, h: 90, body: (c, sw) => `<path d="M14 90V50a46 46 0 0 1 92 0V90" fill="none" stroke="${c}" stroke-width="${sw}"/><path d="M38 90V54a22 22 0 0 1 44 0V90" fill="none" stroke="${c}" stroke-width="${sw * 0.7}"/>` },
  leaves: {
    w: 140,
    h: 140,
    body: (c, sw) =>
      `<path d="M30 100C30 60 60 34 100 30C100 70 74 100 30 100Z" fill="${c}"/><path d="M30 100L86 44" stroke="#ffffff" stroke-opacity="0.35" stroke-width="${sw * 0.6}"/><path d="M110 128c0-14 10-24 24-26c0 14-10 24-24 26Z" fill="${c}"/>`,
  },
  sunburst: {
    w: 200,
    h: 200,
    body: (c) => {
      const rays = Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        const b = a + Math.PI / 18;
        const p = (r: number, t: number) => `${(100 + r * Math.cos(t)).toFixed(1)} ${(100 + r * Math.sin(t)).toFixed(1)}`;
        return `M100 100L${p(150, a)}L${p(150, b)}Z`;
      }).join("");
      return `<path d="${rays}" fill="${c}"/>`;
    },
  },
  mudcloth: {
    w: 96,
    h: 96,
    body: (c, sw) =>
      `<path d="M8 12h20M8 20h20M8 28h20" stroke="${c}" stroke-width="${sw}"/><circle cx="66" cy="20" r="6" fill="none" stroke="${c}" stroke-width="${sw}"/><path d="M8 66l10 -10l10 10l10 -10" fill="none" stroke="${c}" stroke-width="${sw}"/><path d="M60 56v24M70 56v24M80 56v24" stroke="${c}" stroke-width="${sw}"/>`,
  },
  triangles: { w: 72, h: 62, body: (c) => `<path d="M0 62L18 31L36 62Z M36 31L54 0L72 31Z" fill="${c}"/>` },
  chevrons: { w: 64, h: 40, body: (c, sw) => `<path d="M0 30L32 8L64 30" fill="none" stroke="${c}" stroke-width="${sw * 1.6}"/>` },
  deco: {
    w: 120,
    h: 70,
    body: (c, sw) =>
      `<path d="M0 70A60 60 0 0 1 120 70" fill="none" stroke="${c}" stroke-width="${sw * 0.7}"/><path d="M20 70A40 40 0 0 1 100 70" fill="none" stroke="${c}" stroke-width="${sw * 0.7}"/><path d="M40 70A20 20 0 0 1 80 70" fill="none" stroke="${c}" stroke-width="${sw * 0.7}"/>`,
  },
  blobs: { w: 220, h: 220, body: (c) => `<path d="M60 30c30-20 80-10 90 30s-10 80-50 84s-80-20-76-60c2-24 16-42 36-54Z" fill="${c}"/><circle cx="180" cy="180" r="18" fill="${c}"/>` },
  checker: { w: 60, h: 60, body: (c) => `<rect width="30" height="30" fill="${c}"/><rect x="30" y="30" width="30" height="30" fill="${c}"/>` },
};

/**
 * A pattern covering `width` x `height` as an SVG data URL. `scale` grows the tile (1 is the design size for a 1080px
 * short side); `opacity` keeps patterns behind text quiet.
 */
export function motifUrl(motif: Motif, width: number, height: number, color: string, opacity: number, scale = 1): string {
  const tile = TILES[motif];
  const w = Math.round(tile.w * scale);
  const h = Math.round(tile.h * scale);
  const sw = 3 * scale;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}">` +
    `<defs><pattern id="m" width="${w}" height="${h}" patternUnits="userSpaceOnUse">` +
    `<g transform="scale(${scale})">${tile.body(color, sw / scale)}</g></pattern></defs>` +
    `<rect width="100%" height="100%" fill="url(#m)" opacity="${opacity}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Five stars for testimonials. */
export function starsUrl(size: number, color: string): string {
  const star = (x: number) => `<path transform="translate(${x} 0)" d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6 5.6 21.1 7 14l-5.3-5 7.2-.9z" fill="${color}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 5.6}" height="${size}" viewBox="0 0 134 24">${[0, 27.5, 55, 82.5, 110].map(star).join("")}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
