// Pure layout helpers shared by the templates. No rendering and no I/O, so they are unit-testable.
import { brandPalette, contrastRatio, PULSE_BLUE } from "@/lib/color-contrast";

export const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const ASPECT_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

export const ASPECT_LABELS: Record<AspectRatio, string> = {
  "1:1": "Square",
  "4:5": "Portrait",
  "9:16": "Story",
  "16:9": "Landscape",
};

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === "string" && (ASPECT_RATIOS as readonly string[]).includes(value);
}

export type Orientation = "square" | "tall" | "wide";

export function orientationOf(ratio: AspectRatio): Orientation {
  const { width, height } = ASPECT_SIZES[ratio];
  return width === height ? "square" : height > width ? "tall" : "wide";
}

/** Everything a template needs to draw one design. Images are data URLs (Satori cannot fetch private URLs). */
export type TemplateInput = {
  businessName: string;
  logoDataUrl?: string | null;
  /** Brand colours as hex; missing ones fall back to Pulse Blue and Violet. */
  colors?: readonly string[] | null;
  photoDataUrl?: string | null;
  headline: string;
  subline?: string | null;
  /** Price, date or call to action shown as a chip. */
  chip?: string | null;
  /** Small label above the headline. Defaults to the template's own ("New arrival"); "" hides it. */
  kicker?: string | null;
};

// ---- colour ----

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mixes `hex` toward `target` ("#000000" darkens, "#ffffff" lightens) by `amount` 0..1. */
export function mix(hex: string, target: string, amount: number): string {
  const a = parse(hex);
  const b = parse(target);
  return toHex([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type Theme = {
  primary: string;
  secondary: string;
  accent: string;
  /** Text colour readable on both primary and secondary. */
  text: string;
  /** Muted text on the gradient. */
  textMuted: string;
  /** Text colour readable on the accent colour. */
  onAccent: string;
  /** Dark brand tone for scrims and dark backgrounds. */
  deep: string;
};

const WHITE = "#FFFFFF";
const INK = "#0B0B0F";

/** Picks white or near-black, whichever reads better on the worse of the two colours. */
function readableOnBoth(a: string, b: string): string {
  const light = Math.min(contrastRatio(a, WHITE), contrastRatio(b, WHITE));
  const dark = Math.min(contrastRatio(a, INK), contrastRatio(b, INK));
  return light >= dark ? WHITE : INK;
}

export function buildTheme(colors?: readonly string[] | null): Theme {
  const [first, second, third] = brandPalette(colors);
  const primary = first;
  // A single brand colour still gets a gradient: a slightly deeper tone of itself.
  const secondary = second.toLowerCase() === first.toLowerCase() ? mix(first, "#000000", 0.28) : second;
  const accent = third.toLowerCase() === first.toLowerCase() ? mix(first, WHITE, 0.82) : third;
  const text = readableOnBoth(primary, secondary);
  return {
    primary,
    secondary,
    accent,
    text,
    textMuted: text === WHITE ? "rgba(255, 255, 255, 0.82)" : "rgba(11, 11, 15, 0.74)",
    onAccent: readableOnBoth(accent, accent),
    deep: mix(primary, "#000000", 0.78) || PULSE_BLUE,
  };
}

// ---- text fitting ----

// Average glyph advance as a fraction of the font size, for Inter ExtraBold / Medium. Slightly
// generous so text is never clipped; wide scripts are handled by the caller's box sizes.
const CHAR_WIDTH = { bold: 0.6, regular: 0.54 };

export type FitOptions = {
  maxSize: number;
  minSize: number;
  lineHeight?: number;
  weight?: "bold" | "regular";
  /** Never more lines than this (the text is ellipsised by the caller if it still does not fit). */
  maxLines?: number;
};

/** Greedy word wrap using estimated glyph widths. Returns the line count. */
export function estimateLines(text: string, fontSize: number, boxWidth: number, weight: "bold" | "regular" = "bold"): number {
  const unit = fontSize * CHAR_WIDTH[weight];
  const perLine = Math.max(1, Math.floor(boxWidth / unit));
  let lines = 1;
  let used = 0;
  for (const word of text.trim().split(/\s+/)) {
    let len = [...word].length;
    // A word longer than the line is broken across lines by the renderer.
    while (len > perLine) {
      if (used > 0) lines++;
      lines += Math.floor((len - 1) / perLine);
      len = len % perLine || perLine;
      used = 0;
    }
    const needed = used === 0 ? len : used + 1 + len;
    if (needed <= perLine) used = needed;
    else {
      lines++;
      used = len;
    }
  }
  return lines;
}

/** Largest font size (step 2px) from maxSize down to minSize so the text fits the box. */
export function fitFontSize(text: string, boxWidth: number, boxHeight: number, options: FitOptions): number {
  const { maxSize, minSize, lineHeight = 1.08, weight = "bold", maxLines } = options;
  for (let size = maxSize; size > minSize; size -= 2) {
    const lines = estimateLines(text, size, boxWidth, weight);
    if (lines * size * lineHeight <= boxHeight && (!maxLines || lines <= maxLines)) return size;
  }
  return minSize;
}

/** Trims text to `max` characters on a word boundary with an ellipsis. */
export function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = [...clean];
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:!?\s]+$/, "")}…`;
}
