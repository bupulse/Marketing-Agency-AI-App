// Building blocks shared by the style packs (packs/*.tsx). Satori renders a flexbox-only CSS
// subset: every element with more than one child needs display: flex, sizes are in px, images
// need explicit width and height. All pack sizes are written for a 1080px short side; the
// tall and wide formats only add length.
import { clampText, fitFontSize, rgba, type AspectRatio, type Orientation, type TemplateInput, type Theme } from "@/lib/designs/layout";
import type { PackId } from "@/lib/designs/packs";
import { fontFamilyFor } from "./fonts";

export type LayoutProps = {
  input: TemplateInput;
  ratio: AspectRatio;
  width: number;
  height: number;
  orientation: Orientation;
  theme: Theme;
  /** Resolved kicker text ("" means none). */
  kicker: string;
  pack: PackId;
};

/** What a template asks of a pack: which of the pack's layouts to use and how to show the chip. */
export type Spec = {
  mode: "photo" | "card" | "quote";
  /** Chip look: pill (call to action), block (date) or circle (price or discount badge). */
  badge?: "pill" | "block" | "circle";
  /** Extra frame around a photo (listings). */
  frame?: boolean;
  /** Brand-coloured treatment instead of the neutral one (announcements). */
  tint?: boolean;
};

export const WHITE = "#FFFFFF";
export const INK = "#0B0B0F";

export function Fill({ children, width, height, background, pack, color }: { children: React.ReactNode; width: number; height: number; background?: string; pack: PackId; color?: string }) {
  return (
    <div style={{ display: "flex", position: "relative", width, height, overflow: "hidden", fontFamily: fontFamilyFor(pack), background, color }}>
      {children}
    </div>
  );
}

export function Photo({ src, width, height, style }: { src: string; width: number; height: number; style?: React.CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image, not a DOM <img>
    <img src={src} width={width} height={height} style={{ objectFit: "cover", ...style }} />
  );
}

const ARABIC = /[؀-ۿݐ-ݿ]/;

/** Letter spacing in px; none for Arabic, where spacing breaks the joined letters. */
export function spacing(text: string, px: number): number {
  return ARABIC.test(text) ? 0 : px;
}

/** The business logo on a white tile, or its initial on a brand disc. */
export function Logo({ input, theme, size, radius = 24, ring }: { input: TemplateInput; theme: Theme; size: number; radius?: number; ring?: string }) {
  const border = ring ? `3px solid ${ring}` : "none";
  if (input.logoDataUrl) {
    const inner = Math.round(size * 0.78);
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: radius, background: WHITE, border, flexShrink: 0 }}>
        <Photo src={input.logoDataUrl} width={inner} height={inner} style={{ objectFit: "contain" }} />
      </div>
    );
  }
  const initial = [...clampText(input.businessName, 30)][0]?.toUpperCase() ?? "";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: 9999, background: theme.primary, color: theme.text, border, fontSize: size * 0.5, fontWeight: 800, flexShrink: 0 }}>
      {initial}
    </div>
  );
}

export function businessName(input: TemplateInput): string {
  return clampText(input.businessName, 30);
}

export type Fitted = { text: string; size: number };

export type FitSpec = { w: number; h: number; maxSize: number; minSize?: number; lineHeight: number; charWidth: number; weight?: "bold" | "regular"; maxLines?: number };

export function fitHeadline(text: string, spec: FitSpec): Fitted {
  const clean = clampText(text, 140);
  return { text: clean, size: fitFontSize(clean, spec.w, spec.h, { maxSize: spec.maxSize, minSize: spec.minSize ?? 44, lineHeight: spec.lineHeight, charWidth: spec.charWidth, weight: spec.weight }) };
}

export function fitSubline(text: string | null | undefined, w: number, maxSize = 40): Fitted | null {
  if (!text?.trim()) return null;
  const clean = clampText(text, 180);
  return { text: clean, size: fitFontSize(clean, w, 150, { maxSize, minSize: 26, lineHeight: 1.3, weight: "regular", maxLines: 3 }) };
}

export function chipText(input: TemplateInput): string {
  return input.chip?.trim() ? clampText(input.chip, 40) : "";
}

/** Largest font size for a short label inside a box (badges, date blocks). */
export function fitLabel(text: string, w: number, h: number, maxSize: number, charWidth = 0.6): number {
  return fitFontSize(text, w, h, { maxSize, minSize: 24, lineHeight: 1.05, charWidth });
}

export { rgba };
