// Building blocks of the design library's layouts (lib/designs/library/families/*). Satori renders a flexbox-only CSS
// subset: every element with more than one child needs display: flex, sizes are px, images need width and height, and
// a style value may never be undefined (Box drops them). Sizes are written for a 1080px short side.
import type { ReactNode } from "react";
import { contrastRatio } from "@/lib/color-contrast";
import { buildTheme, clampText, fitFontSize, mix, rgba, type AspectRatio, type Orientation, type TemplateInput, type Theme } from "@/lib/designs/layout";
import type { PackId } from "@/lib/designs/packs";
import { FONT_FAMILY } from "@/lib/designs/templates/fonts";
import type { DesignInfo, Knobs, Shape, Tone } from "./catalog";
import { motifUrl } from "./motifs";
import { STYLES, type StyleTokens } from "./styles";

export const WHITE = "#FFFFFF";
export const INK = "#0B0B0F";

/** What a design draws: the template input plus an optional step number (carousel tips and steps). */
export type DesignInput = TemplateInput & { step?: number | null };

export type Surface = {
  bg: string;
  /** A second colour for a gradient; same as bg for a flat surface. */
  bg2: string;
  fg: string;
  muted: string;
  /** A highlight colour that still reads on the surface (3:1, large text and marks). */
  hi: string;
  /** Text colour on the highlight. */
  onHi: string;
  line: string;
};

export type Ctx = {
  input: DesignInput;
  design: DesignInfo;
  W: number;
  H: number;
  ratio: AspectRatio;
  o: Orientation;
  wide: boolean;
  tall: boolean;
  /** 9:16: extra length to use. */
  story: boolean;
  s: StyleTokens;
  k: Knobs;
  theme: Theme;
  kicker: string;
  family: string;
  photo: string | null;
  /** The variant's main surface and the others, for secondary panels. */
  main: Surface;
  surfaces: Record<Tone, Surface>;
};

// ---- colour ----

/** The text colour for a background: the style's ink or white, whichever passes 4.5:1 (else the better one). */
export function readable(bg: string, ink: string = INK): string {
  if (contrastRatio(ink, bg) >= 4.5) return ink;
  if (contrastRatio(WHITE, bg) >= 4.5) return WHITE;
  return contrastRatio(ink, bg) >= contrastRatio(WHITE, bg) ? ink : WHITE;
}

/** Readable on both ends of a gradient. */
function readableOnBoth(a: string, b: string, ink: string): string {
  const dark = Math.min(contrastRatio(ink, a), contrastRatio(ink, b));
  const light = Math.min(contrastRatio(WHITE, a), contrastRatio(WHITE, b));
  return dark >= light ? ink : WHITE;
}

/** The first candidate with at least `min` contrast on `bg`, else the fallback. */
function firstReadable(candidates: (string | null)[], bg: string, min: number, fallback: string): string {
  return candidates.find((c): c is string => !!c && contrastRatio(c, bg) >= min) ?? fallback;
}

const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

/** Text on a surface must pass WCAG AA (4.5:1): a gradient that cannot carry it goes flat, a mid tone is deepened. */
function surface(bg0: string, bg20: string, ink: string, highlights: (string | null)[]): Surface {
  let bg = bg0;
  let bg2 = bg20;
  let fg = bg === bg2 ? readable(bg, ink) : readableOnBoth(bg, bg2, ink);
  if (Math.min(contrastRatio(fg, bg), contrastRatio(fg, bg2)) < 4.5) {
    bg2 = bg;
    fg = readable(bg, ink);
    for (let i = 0; i < 8 && contrastRatio(fg, bg) < 4.5; i++) {
      bg = mix(bg, fg === WHITE ? "#000000" : WHITE, 0.12);
      bg2 = bg;
      fg = readable(bg, ink);
    }
  }
  const hi = firstReadable(highlights, bg, 3, fg);
  return { bg, bg2, fg, muted: rgba(fg, 0.78), hi, onHi: readable(hi, ink), line: rgba(fg, 0.22) };
}

export function palette(style: StyleTokens, colors: TemplateInput["colors"]): { theme: Theme; surfaces: Record<Tone, Surface> } {
  const base = buildTheme(colors);
  const lean = style.lean;
  const theme: Theme = lean
    ? { ...base, primary: mix(base.primary, lean.toward, lean.amount), secondary: mix(base.secondary, lean.toward, lean.amount), accent: mix(base.accent, lean.toward, lean.amount * 0.6) }
    : base;
  const night = style.night && hex(style.night) ? style.night : theme.deep;
  const tint = mix(theme.primary, style.paper, 0.86);
  const surfaces: Record<Tone, Surface> = {
    paper: surface(style.paper, style.paper, style.ink, [style.metal && contrastRatio(style.metal, style.paper) >= 3 ? style.metal : null, theme.primary, theme.secondary, mix(theme.primary, "#000000", 0.35)]),
    brand: surface(theme.primary, theme.secondary, style.ink, [style.metal, theme.accent, style.paper, WHITE]),
    night: surface(night, night, style.ink, [style.metal, theme.primary, theme.accent, theme.secondary, mix(theme.primary, WHITE, 0.45)]),
    tint: surface(tint, tint, style.ink, [theme.primary, theme.secondary, mix(theme.primary, "#000000", 0.4)]),
  };
  return { theme, surfaces };
}

export function background(sf: Surface, angle = 150): string {
  return sf.bg === sf.bg2 ? sf.bg : `linear-gradient(${angle}deg, ${sf.bg} 0%, ${sf.bg2} 100%)`;
}

// ---- layout ----

type Style = React.CSSProperties;

/** Drops undefined values (Satori rejects them) and always sets display: flex. */
export function css(style: Style): Style {
  const out: Record<string, unknown> = { display: "flex" };
  for (const [key, value] of Object.entries(style)) if (value !== undefined && value !== null) out[key] = value;
  return out as Style;
}

export function Box({ style, children }: { style: Style; children?: ReactNode }) {
  return <div style={css(style)}>{children}</div>;
}

export function Abs({ x, y, w, h, style, children }: { x: number; y: number; w?: number; h?: number; style?: Style; children?: ReactNode }) {
  return <Box style={{ position: "absolute", left: x, top: y, width: w, height: h, ...style }}>{children}</Box>;
}

// ---- text ----

const ARABIC = /[؀-ۿݐ-ݿ]/;

function track(text: string, px: number): number {
  return ARABIC.test(text) ? 0 : px;
}

/** Characters that fit a box at a font size (estimated, with a margin for word wrapping). */
export function capacity(w: number, h: number, size: number, charWidth: number, lineHeight: number): number {
  const perLine = Math.max(1, Math.floor(w / (size * charWidth)));
  const lines = Math.max(1, Math.floor(h / (size * lineHeight)));
  return Math.max(12, Math.floor(perLine * lines * 0.85));
}

/** Headline sized to its box with the style's font metrics; capitals are wider. */
export function fitHead(c: Ctx, text: string, w: number, h: number, max: number, min = 40): { text: string; size: number } {
  const cw = c.s.font.charWidth * (c.s.font.upper ? 1.08 : 1);
  // Never more text than the box holds at the smallest size, so nothing spills out of its panel.
  const clean = clampText(text, Math.min(140, capacity(w, h, min, cw, c.s.font.lineHeight)));
  const scaled = Math.round(max * (c.k.scale === "l" ? 1.12 : c.k.scale === "s" ? 0.86 : 1));
  return { text: clean, size: fitFontSize(clean, w, h, { maxSize: scaled, minSize: min, lineHeight: c.s.font.lineHeight, charWidth: cw }) };
}

export function Head({ c, text, w, h, max, min, color, center, size: forced }: { c: Ctx; text: string; w: number; h: number; max: number; min?: number; color: string; center?: boolean; size?: number }) {
  const fit = fitHead(c, text, w, h, max, min);
  const size = forced ?? fit.size;
  return (
    <Box
      style={{
        width: w,
        fontFamily: c.family,
        fontSize: size,
        fontWeight: c.s.font.weight,
        lineHeight: c.s.font.lineHeight,
        letterSpacing: track(fit.text, size * c.s.font.tracking),
        textTransform: c.s.font.upper ? "uppercase" : undefined,
        color,
        justifyContent: center ? "center" : undefined,
        textAlign: center ? "center" : undefined,
      }}
    >
      {fit.text}
    </Box>
  );
}

export function Sub({ c, text, w, color, max = 38, center, lines = 3 }: { c: Ctx; text: string | null | undefined; w: number; color: string; max?: number; center?: boolean; lines?: number }) {
  if (!text?.trim()) return null;
  const clean = clampText(text, Math.min(180, capacity(w, lines * 24 * 1.3, 24, 0.54, 1.3)));
  const size = fitFontSize(clean, w, lines * max * 1.3, { maxSize: max, minSize: 24, lineHeight: 1.3, weight: "regular", maxLines: lines });
  return (
    <Box style={{ width: w, fontFamily: FONT_FAMILY, fontSize: size, lineHeight: 1.3, fontWeight: c.s.bodyWeight === 800 ? 800 : 500, color, justifyContent: center ? "center" : undefined, textAlign: center ? "center" : undefined }}>
      {clean}
    </Box>
  );
}

export function Kicker({ c, sf, center }: { c: Ctx; sf: Surface; center?: boolean }) {
  const text = clampText(c.kicker, 32);
  if (!text) return null;
  const small = { fontFamily: FONT_FAMILY, fontSize: 25, fontWeight: 800, letterSpacing: track(text, 4), textTransform: "uppercase" as const };
  if (c.s.kicker === "pill" || c.s.kicker === "tag") {
    const pill = c.s.kicker === "pill";
    return (
      <Box style={{ justifyContent: center ? "center" : "flex-start" }}>
        <Box style={{ ...small, padding: pill ? "10px 24px" : "8px 16px", borderRadius: pill ? 9999 : 2, background: sf.hi, color: sf.onHi, transform: c.s.tilt && !pill ? `rotate(${c.s.tilt / 2}deg)` : undefined }}>{text}</Box>
      </Box>
    );
  }
  if (c.s.kicker === "caps") {
    return (
      <Box style={{ alignItems: "center", gap: 18, justifyContent: center ? "center" : "flex-start" }}>
        {center && <Box style={{ width: 48, height: 2, background: sf.hi }} />}
        <Box style={{ ...small, fontWeight: 500, letterSpacing: track(text, 7), color: sf.hi }}>{text}</Box>
        <Box style={{ width: 48, height: 2, background: sf.hi }} />
      </Box>
    );
  }
  return (
    <Box style={{ alignItems: "center", gap: 16, justifyContent: center ? "center" : "flex-start" }}>
      <Box style={{ width: 44, height: 8, background: sf.hi }} />
      <Box style={{ ...small, color: sf.muted }}>{text}</Box>
    </Box>
  );
}

export function chipOf(c: Ctx): string {
  return c.input.chip?.trim() ? clampText(c.input.chip, 40) : "";
}

/** The chip in the style's own shape (pill, block, tag, stamp); circles are drawn by Badge. */
export function Chip({ c, sf, center, size = 40, maxW }: { c: Ctx; sf: Surface; center?: boolean; size?: number; maxW: number }) {
  const text = chipOf(c);
  if (!text) return null;
  const kind = c.s.chip === "circle" ? "pill" : c.s.chip;
  const fs = fitFontSize(text, maxW - 80, size * 1.3, { maxSize: size, minSize: 22, lineHeight: 1.1, charWidth: c.s.font.charWidth });
  const base: Style = { fontFamily: c.family, fontSize: fs, fontWeight: c.s.font.weight, lineHeight: 1.1, maxWidth: maxW, textTransform: c.s.font.upper ? "uppercase" : undefined };
  const look: Style =
    kind === "pill"
      ? { padding: "14px 34px", borderRadius: 9999, background: sf.hi, color: sf.onHi }
      : kind === "block"
        ? { padding: "16px 30px", background: sf.hi, color: sf.onHi, boxShadow: c.s.shadow === "hard" ? `8px 8px 0 ${sf.fg}` : undefined }
        : kind === "stamp"
          ? { padding: "12px 28px", border: `${Math.max(3, c.s.stroke)}px dashed ${sf.hi}`, borderRadius: c.s.radius ? 16 : 4, color: sf.fg, transform: c.s.tilt ? `rotate(${c.s.tilt}deg)` : undefined }
          : { padding: "12px 0", borderBottom: `${Math.max(2, c.s.stroke)}px solid ${sf.hi}`, color: sf.fg };
  return (
    <Box style={{ justifyContent: center ? "center" : "flex-start" }}>
      <Box style={{ ...base, ...look }}>{text}</Box>
    </Box>
  );
}

/** A round badge for a price or discount. */
export function Badge({ c, sf, size, text }: { c: Ctx; sf: Surface; size: number; text: string }) {
  const inner = size * 0.72;
  const fs = fitFontSize(text, inner, size * 0.5, { maxSize: Math.round(size * 0.26), minSize: 22, lineHeight: 1.05, charWidth: c.s.font.charWidth * (c.s.font.upper ? 1.08 : 1) });
  return (
    <Box
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        alignItems: "center",
        justifyContent: "center",
        background: sf.hi,
        color: sf.onHi,
        border: `${Math.round(size * 0.035)}px solid ${sf.bg}`,
        boxShadow: c.s.shadow === "hard" ? `10px 10px 0 ${rgba(INK, 0.9)}` : c.s.shadow === "soft" ? "0 12px 32px rgba(0,0,0,0.22)" : undefined,
        transform: c.s.tilt ? `rotate(${c.s.tilt * 2}deg)` : undefined,
      }}
    >
      <Box style={{ width: inner, justifyContent: "center", textAlign: "center", fontFamily: c.family, fontSize: fs, lineHeight: 1.05, fontWeight: c.s.font.weight, textTransform: c.s.font.upper ? "uppercase" : undefined }}>{text}</Box>
    </Box>
  );
}

// ---- brand ----

export function Logo({ c, size, ring }: { c: Ctx; size: number; ring?: string }) {
  const border = ring ? `3px solid ${ring}` : undefined;
  if (c.input.logoDataUrl) {
    const inner = Math.round(size * 0.78);
    return (
      <Box style={{ alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: Math.min(24, size / 4), background: WHITE, border, flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image, not a DOM <img> */}
        <img src={c.input.logoDataUrl} width={inner} height={inner} style={{ objectFit: "contain" }} />
      </Box>
    );
  }
  const initial = [...clampText(c.input.businessName, 30)][0]?.toUpperCase() ?? "";
  const sf = c.surfaces.brand;
  return (
    <Box style={{ alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: 9999, background: sf.bg, color: sf.fg, border, fontFamily: c.family, fontSize: size * 0.5, fontWeight: c.s.font.weight, flexShrink: 0 }}>
      {initial}
    </Box>
  );
}

export function name(c: Ctx): string {
  return clampText(c.input.businessName, 30);
}

/** Logo and business name on one line. */
export function BrandLine({ c, sf, size = 60, center }: { c: Ctx; sf: Surface; size?: number; center?: boolean }) {
  return (
    <Box style={{ alignItems: "center", gap: Math.round(size * 0.3), justifyContent: center ? "center" : "flex-start" }}>
      <Logo c={c} size={size} ring={sf.line} />
      <Box style={{ fontFamily: FONT_FAMILY, fontSize: Math.round(size * 0.5), fontWeight: 800, color: sf.fg }}>{name(c)}</Box>
    </Box>
  );
}

/** Logo and name on a small white pill, for placing over a photo. */
export function BrandPill({ c }: { c: Ctx }) {
  return (
    <Box style={{ alignItems: "center", gap: 16, padding: "10px 26px 10px 12px", borderRadius: 9999, background: WHITE }}>
      <Logo c={c} size={52} />
      <Box style={{ fontFamily: FONT_FAMILY, fontSize: 28, fontWeight: 800, color: INK }}>{name(c)}</Box>
    </Box>
  );
}

// ---- decoration ----

/** The variant's pattern over an area, quiet enough to sit behind text. */
export function Pattern({ c, x, y, w, h, color, opacity = 0.16, scale = 1 }: { c: Ctx; x: number; y: number; w: number; h: number; color: string; opacity?: number; scale?: number }) {
  if (c.k.motif < 0) return null;
  const motif = c.s.motifs[c.k.motif];
  if (!motif) return null;
  return (
    <Abs x={x} y={y} w={w} h={h}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image, not a DOM <img> */}
      <img src={motifUrl(motif, w, h, color, opacity, scale)} width={Math.round(w)} height={Math.round(h)} />
    </Abs>
  );
}

/** The variant's accent mark next to a headline. */
export function Mark({ c, sf, center }: { c: Ctx; sf: Surface; center?: boolean }) {
  const a = c.k.accent;
  if (a === "none" || a === "frame" || a === "corner") return null;
  const color = c.s.metal ?? sf.hi;
  const shape: Style = a === "dot" ? { width: 22, height: 22, borderRadius: 9999 } : a === "underline" ? { width: 160, height: Math.max(3, c.s.stroke) } : { width: 72, height: 10, borderRadius: c.s.radius ? 9999 : 0 };
  return (
    <Box style={{ justifyContent: center ? "center" : "flex-start" }}>
      <Box style={{ ...shape, background: color }} />
    </Box>
  );
}

/** Corner brackets or a frame inside an area, for the corner and frame accents. */
export function Frame({ c, x, y, w, h, color }: { c: Ctx; x: number; y: number; w: number; h: number; color: string }) {
  const sw = Math.max(2, c.s.stroke);
  if (c.k.accent === "frame") return <Abs x={x} y={y} w={w} h={h} style={{ border: `${sw}px solid ${color}`, borderRadius: c.s.radius ? c.s.radius * 0.6 : 0 }} />;
  if (c.k.accent !== "corner") return null;
  const len = 70;
  const edge = (bx: number, by: number, sides: Style) => <Abs x={bx} y={by} w={len} h={len} style={sides} />;
  const b = `${sw * 1.5}px solid ${color}`;
  return (
    <>
      {edge(x, y, { borderTop: b, borderLeft: b })}
      {edge(x + w - len, y, { borderTop: b, borderRight: b })}
      {edge(x, y + h - len, { borderBottom: b, borderLeft: b })}
      {edge(x + w - len, y + h - len, { borderBottom: b, borderRight: b })}
    </>
  );
}

// ---- photos ----

export function radiusFor(c: Ctx, shape: Shape, w: number, h: number): Style {
  if (shape === "circle") return { borderRadius: 9999 };
  if (shape === "arch") return { borderRadius: `${Math.round(w / 2)}px ${Math.round(w / 2)}px ${c.s.radius}px ${c.s.radius}px` };
  if (shape === "round") return { borderRadius: Math.max(24, c.s.radius) };
  // Polygons in px: Satori resolves percentages in clip paths unreliably.
  if (shape === "slant") return { clipPath: c.k.flip ? `polygon(0px 0px, ${w}px 0px, ${w}px ${h}px, ${Math.round(w * 0.12)}px ${h}px)` : `polygon(0px 0px, ${w}px 0px, ${Math.round(w * 0.88)}px ${h}px, 0px ${h}px)` };
  return { borderRadius: Math.min(c.s.radius, Math.min(w, h) / 6) };
}

/**
 * The photo cropped to a shape, or brand art in its place: a brand gradient with the style's pattern and the
 * business's initial, so a design never shows an empty box.
 */
export function Picture({ c, x, y, w, h, shape, style }: { c: Ctx; x: number; y: number; w: number; h: number; shape: Shape; style?: Style }) {
  const clip = radiusFor(c, shape, w, h);
  if (c.photo) {
    return (
      <Abs x={x} y={y} w={w} h={h} style={{ overflow: "hidden", ...clip, ...style }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image, not a DOM <img> */}
        <img src={c.photo} width={Math.round(w)} height={Math.round(h)} style={{ objectFit: "cover" }} />
      </Abs>
    );
  }
  const sf = c.surfaces.brand;
  const motif = c.s.motifs[(c.k.motif + 1 + c.s.motifs.length) % c.s.motifs.length];
  const initial = [...clampText(c.input.businessName, 30)][0]?.toUpperCase() ?? "";
  return (
    <Abs x={x} y={y} w={w} h={h} style={{ overflow: "hidden", alignItems: "center", justifyContent: "center", background: background(sf, 135), ...clip, ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image, not a DOM <img> */}
      <img src={motifUrl(motif, w, h, sf.fg, 0.2, 1.4)} width={Math.round(w)} height={Math.round(h)} style={{ position: "absolute", left: 0, top: 0 }} />
      {c.input.logoDataUrl ? (
        <Logo c={c} size={Math.round(Math.min(w, h) * 0.32)} />
      ) : (
        <Box style={{ fontFamily: c.family, fontWeight: c.s.font.weight, fontSize: Math.round(Math.min(w, h) * 0.42), color: rgba(sf.fg, 0.85) }}>{initial}</Box>
      )}
    </Abs>
  );
}

/** A dark gradient over a photo so white text reads (used only under text that sits on a photo). */
export function Scrim({ x, y, w, h, from = "bottom", strength = 0.78 }: { x: number; y: number; w: number; h: number; from?: "bottom" | "top" | "left" | "right"; strength?: number }) {
  const dir = from === "bottom" ? "0deg" : from === "top" ? "180deg" : from === "left" ? "90deg" : "270deg";
  return <Abs x={x} y={y} w={w} h={h} style={{ background: `linear-gradient(${dir}, rgba(0,0,0,${strength}) 0%, rgba(0,0,0,${strength * 0.75}) 45%, rgba(0,0,0,0) 100%)` }} />;
}

export function Root({ c, sf, children }: { c: Ctx; sf: Surface; children: ReactNode }) {
  return <Box style={{ position: "relative", width: c.W, height: c.H, overflow: "hidden", fontFamily: c.family, background: background(sf), color: sf.fg }}>{children}</Box>;
}

export function makeCtx(design: DesignInfo, input: DesignInput, ratio: AspectRatio, size: { width: number; height: number }, o: Orientation, kicker: string): Ctx {
  const s = STYLES[design.style as PackId];
  const { theme, surfaces } = palette(s, input.colors);
  return {
    input,
    design,
    W: size.width,
    H: size.height,
    ratio,
    o,
    wide: o === "wide",
    tall: o === "tall",
    story: ratio === "9:16",
    s,
    k: design.knobs,
    theme,
    kicker,
    family: `${s.font.family === "Inter" ? "" : `${s.font.family}, `}${FONT_FAMILY}`,
    photo: design.usesPhoto ? (input.photoDataUrl ?? null) : null,
    main: surfaces[design.knobs.tone],
    surfaces,
  };
}
