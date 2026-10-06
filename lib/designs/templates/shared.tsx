// Building blocks and the three layout families the templates are made from. Satori renders
// a flexbox-only CSS subset: every element with more than one child needs display: flex, sizes
// are in px, and images need explicit width and height.
import { fitFontSize, clampText, rgba, type AspectRatio, type Orientation, type TemplateInput, type Theme } from "@/lib/designs/layout";
import { FONT_FAMILY } from "./fonts";

export type LayoutProps = {
  input: TemplateInput;
  ratio: AspectRatio;
  width: number;
  height: number;
  orientation: Orientation;
  theme: Theme;
  /** Resolved kicker text ("" means none). */
  kicker: string;
};

const WHITE = "#FFFFFF";
const INK = "#0B0B0F";

function Fill({ children, width, height, background }: { children: React.ReactNode; width: number; height: number; background?: string }) {
  return (
    <div style={{ display: "flex", position: "relative", width, height, overflow: "hidden", fontFamily: FONT_FAMILY, background }}>
      {children}
    </div>
  );
}

export function gradient(theme: Theme, angle = 135): string {
  return `linear-gradient(${angle}deg, ${theme.primary} 0%, ${theme.secondary} 100%)`;
}

/** Soft decorative circles for designs without a photo. */
function Decor({ width, height, theme, ink }: { width: number; height: number; theme: Theme; ink: string }) {
  const big = Math.round(Math.max(width, height) * 0.62);
  return (
    <>
      <div style={{ position: "absolute", display: "flex", right: -big * 0.28, top: -big * 0.3, width: big, height: big, borderRadius: 9999, background: rgba(theme.accent, 0.3) }} />
      <div style={{ position: "absolute", display: "flex", left: -big * 0.3, bottom: -big * 0.36, width: big * 0.8, height: big * 0.8, borderRadius: 9999, background: rgba(ink, 0.08) }} />
      <div style={{ position: "absolute", display: "flex", right: width * 0.12, bottom: height * 0.1, width: big * 0.16, height: big * 0.16, borderRadius: 9999, border: `6px solid ${rgba(ink, 0.25)}` }} />
    </>
  );
}

export function Brand({ input, ink, theme }: { input: TemplateInput; ink: string; theme: Theme }) {
  const name = clampText(input.businessName, 30);
  const initial = [...name][0]?.toUpperCase() ?? "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      {input.logoDataUrl ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 92, height: 92, borderRadius: 24, background: WHITE, padding: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image, not a DOM <img> */}
          <img src={input.logoDataUrl} width={72} height={72} style={{ objectFit: "contain" }} />
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 76, height: 76, borderRadius: 9999, background: ink === WHITE ? "rgba(255,255,255,0.2)" : rgba(theme.primary, 0.9), color: ink === WHITE ? WHITE : theme.text, fontSize: 38, fontWeight: 800 }}>
          {initial}
        </div>
      )}
      <div style={{ display: "flex", fontSize: 36, fontWeight: 800, letterSpacing: -0.5, color: ink }}>{name}</div>
    </div>
  );
}

export function Kicker({ text, ink }: { text: string; ink: string }) {
  if (!text) return null;
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        padding: "12px 28px",
        borderRadius: 9999,
        background: rgba(ink, 0.16),
        border: `2px solid ${rgba(ink, 0.35)}`,
        color: ink,
        fontSize: 26,
        fontWeight: 800,
        letterSpacing: 4,
        textTransform: "uppercase",
      }}
    >
      {text}
    </div>
  );
}

type TextSizes = { headMax: number; headBoxH: number; textW: number; align?: "left" | "center" };

export function Headline({ text, ink, sizes }: { text: string; ink: string; sizes: TextSizes }) {
  const clean = clampText(text, 140);
  const size = fitFontSize(clean, sizes.textW, sizes.headBoxH, { maxSize: sizes.headMax, minSize: 44, lineHeight: 1.06 });
  return (
    <div style={{ display: "flex", width: sizes.textW, fontSize: size, lineHeight: 1.06, fontWeight: 800, letterSpacing: -size * 0.025, color: ink, textAlign: sizes.align ?? "left" }}>{clean}</div>
  );
}

export function Subline({ text, ink, sizes }: { text?: string | null; ink: string; sizes: TextSizes }) {
  if (!text?.trim()) return null;
  const clean = clampText(text, 180);
  const size = fitFontSize(clean, sizes.textW, 150, { maxSize: 40, minSize: 26, lineHeight: 1.3, weight: "regular", maxLines: 3 });
  return (
    <div style={{ display: "flex", width: sizes.textW, fontSize: size, lineHeight: 1.3, fontWeight: 500, color: ink, opacity: 0.92, textAlign: sizes.align ?? "left" }}>{clean}</div>
  );
}

export type ChipStyle = "pill" | "block";

export function Chip({ text, style, bg, fg }: { text?: string | null; style: ChipStyle; bg: string; fg: string }) {
  if (!text?.trim()) return null;
  const clean = clampText(text, 40);
  const block = style === "block";
  return (
    <div style={{ display: "flex", alignSelf: "flex-start", maxWidth: 900, padding: block ? "22px 40px" : "16px 36px", borderRadius: block ? 28 : 9999, background: bg, color: fg, fontSize: block ? 50 : 40, fontWeight: 800, letterSpacing: -0.5 }}>
      {clean}
    </div>
  );
}

/** Round price/offer badge, tilted like a sticker. */
export function CircleBadge({ text, bg, fg, size, style }: { text: string; bg: string; fg: string; size: number; style: React.CSSProperties }) {
  const clean = clampText(text, 24);
  const inner = Math.round(size * 0.74);
  const fontSize = fitFontSize(clean, inner, inner * 0.8, { maxSize: 64, minSize: 26, lineHeight: 1.05 });
  return (
    <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: 9999, background: bg, color: fg, transform: "rotate(-8deg)", boxShadow: "0 12px 40px rgba(0,0,0,0.28)", ...style }}>
      <div style={{ display: "flex", width: inner, justifyContent: "center", textAlign: "center", fontSize, lineHeight: 1.05, fontWeight: 800, letterSpacing: -1 }}>{clean}</div>
    </div>
  );
}

function textSizes(o: Orientation, width: number, pad: number, narrow = false): TextSizes {
  const full = width - pad * 2;
  const textW = o === "wide" ? (narrow ? 880 : 1080) : narrow ? Math.round(full * 0.98) : full;
  const table = { tall: { headMax: 124, headBoxH: 640 }, square: { headMax: 112, headBoxH: 380 }, wide: { headMax: 112, headBoxH: 400 } };
  const entry = table[o];
  return { ...entry, textW };
}

// ---------------------------------------------------------------- overlay

export type OverlayOptions = {
  /** Brand-coloured scrim instead of a dark one. */
  tint?: boolean;
  /** Thin inset frame. */
  frame?: boolean;
};

/** Full-bleed photo (or brand gradient) with the text on a scrim at the bottom / left. */
export function overlayLayout({ input, ratio, width, height, orientation, theme, kicker }: LayoutProps, options: OverlayOptions = {}) {
  void ratio;
  const photo = input.photoDataUrl;
  const pad = orientation === "wide" ? 96 : 76;
  const ink = photo ? WHITE : theme.text;
  const sizes = textSizes(orientation, width, pad, orientation === "wide");
  if (orientation === "tall") sizes.headBoxH = height > 1500 ? 700 : 430;
  if (orientation === "tall" && height <= 1500) sizes.headMax = 110;

  let scrim: string | undefined;
  if (photo) {
    if (options.tint) scrim = `linear-gradient(to bottom, ${rgba(theme.primary, 0.6)} 0%, ${rgba(theme.deep, 0.95)} 100%)`;
    else if (orientation === "wide") scrim = `linear-gradient(to right, ${rgba(theme.deep, 0.94)} 0%, ${rgba(theme.deep, 0.78)} 42%, ${rgba(theme.deep, 0.05)} 100%)`;
    else scrim = `linear-gradient(to bottom, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 24%, ${rgba(theme.deep, 0.35)} 48%, ${rgba(theme.deep, 0.95)} 100%)`;
  }

  const chipBg = photo ? theme.accent : ink === WHITE ? WHITE : INK;
  const chipFg = photo ? theme.onAccent : ink === WHITE ? INK : WHITE;

  return (
    <Fill width={width} height={height} background={photo ? INK : gradient(theme)}>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image
        <img src={photo} width={width} height={height} style={{ position: "absolute", left: 0, top: 0, objectFit: "cover" }} />
      )}
      {scrim && <div style={{ position: "absolute", display: "flex", left: 0, top: 0, width, height, backgroundImage: scrim }} />}
      {!photo && <Decor width={width} height={height} theme={theme} ink={ink} />}
      {options.frame && <div style={{ position: "absolute", display: "flex", left: 34, top: 34, width: width - 68, height: height - 68, border: `4px solid ${rgba(WHITE, 0.75)}`, borderRadius: 30 }} />}
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", justifyContent: "space-between", left: 0, top: 0, width, height, padding: pad }}>
        <Brand input={input} ink={ink} theme={theme} />
        <div style={{ display: "flex", flexDirection: "column", gap: 28, flex: 1, justifyContent: photo ? "flex-end" : "center" }}>
          <Kicker text={kicker} ink={ink} />
          <Headline text={input.headline} ink={ink} sizes={sizes} />
          <Subline text={input.subline} ink={ink} sizes={sizes} />
          <div style={{ display: "flex", marginTop: 8 }}>
            <Chip text={input.chip} style="pill" bg={chipBg} fg={chipFg} />
          </div>
        </div>
      </div>
    </Fill>
  );
}

// ---------------------------------------------------------------- card

export type CardOptions = {
  badge: "pill" | "block" | "circle";
};

/** Brand gradient with the photo as a rounded panel: on top (portrait) or on the right. */
export function cardLayout({ input, width, height, orientation, theme, kicker }: LayoutProps, options: CardOptions) {
  const photo = input.photoDataUrl;
  const ink = theme.text;
  const pad = orientation === "wide" ? 96 : 76;
  const rowLayout = orientation !== "tall";
  const photoW = Math.round(width * (orientation === "wide" ? 0.42 : 0.4));
  const photoH = Math.round(height * 0.44);
  const radius = 72;

  const textColW = photo && rowLayout ? width - photoW - pad * 2 + 24 : width - pad * 2;
  const sizes = textSizes(orientation, width, pad);
  sizes.textW = Math.min(sizes.textW, textColW);
  if (photo && rowLayout) {
    sizes.headMax = orientation === "wide" ? 104 : 88;
    sizes.headBoxH = orientation === "wide" ? 420 : 400;
  } else if (orientation === "tall") {
    sizes.headBoxH = photo ? (height > 1500 ? 520 : 300) : height > 1500 ? 700 : 430;
    sizes.headMax = photo && height <= 1500 ? 88 : 112;
  }
  const chipBg = ink === WHITE ? WHITE : INK;
  const chipFg = ink === WHITE ? INK : WHITE;
  const circle = options.badge === "circle" && input.chip?.trim();

  const textBlock = (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1, justifyContent: "center" }}>
      <Kicker text={kicker} ink={ink} />
      <Headline text={input.headline} ink={ink} sizes={sizes} />
      <Subline text={input.subline} ink={ink} sizes={sizes} />
      {options.badge !== "circle" && (
        <div style={{ display: "flex", marginTop: 8 }}>
          <Chip text={input.chip} style={options.badge} bg={chipBg} fg={chipFg} />
        </div>
      )}
    </div>
  );

  const brand = <Brand input={input} ink={ink} theme={theme} />;
  const badgeSize = orientation === "wide" ? 270 : 280;

  if (photo && !rowLayout) {
    return (
      <Fill width={width} height={height} background={gradient(theme, 160)}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image */}
        <img src={photo} width={width} height={photoH} style={{ position: "absolute", left: 0, top: 0, objectFit: "cover", borderBottomLeftRadius: radius, borderBottomRightRadius: radius }} />
        {circle && <CircleBadge text={input.chip!} bg={theme.accent} fg={theme.onAccent} size={badgeSize} style={{ right: pad - 10, top: photoH - badgeSize / 2 }} />}
        <div style={{ position: "absolute", display: "flex", flexDirection: "column", left: 0, top: photoH, width, height: height - photoH, padding: `${Math.round(pad * 0.7)}px ${pad}px ${pad}px` }}>
          {textBlock}
          {brand}
        </div>
      </Fill>
    );
  }

  if (photo && rowLayout) {
    return (
      <Fill width={width} height={height} background={gradient(theme, 120)}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image */}
        <img src={photo} width={photoW} height={height} style={{ position: "absolute", right: 0, top: 0, objectFit: "cover", borderTopLeftRadius: radius, borderBottomLeftRadius: radius }} />
        {circle && <CircleBadge text={input.chip!} bg={theme.accent} fg={theme.onAccent} size={badgeSize} style={{ left: width - photoW + 48, top: height - badgeSize - 64 }} />}
        <div style={{ position: "absolute", display: "flex", flexDirection: "column", left: 0, top: 0, width: width - photoW, height, padding: pad }}>
          {brand}
          {textBlock}
        </div>
      </Fill>
    );
  }

  return (
    <Fill width={width} height={height} background={gradient(theme)}>
      <Decor width={width} height={height} theme={theme} ink={ink} />
      {circle && <CircleBadge text={input.chip!} bg={WHITE} fg={INK} size={badgeSize - 40} style={{ right: pad, top: pad + 20 }} />}
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", left: 0, top: 0, width, height, padding: pad }}>
        {brand}
        {textBlock}
      </div>
    </Fill>
  );
}

// ---------------------------------------------------------------- quote

export function quoteLayout({ input, width, height, orientation, theme }: LayoutProps) {
  const ink = theme.text;
  const pad = orientation === "wide" ? 120 : 84;
  const textW = orientation === "wide" ? 1500 : width - pad * 2;
  const boxH = orientation === "tall" ? (height > 1500 ? 820 : 520) : orientation === "square" ? 440 : 400;
  const quote = clampText(input.headline, 220);
  const size = fitFontSize(quote, textW, boxH, { maxSize: orientation === "wide" ? 92 : 100, minSize: 38, lineHeight: 1.15 });
  const author = input.subline?.trim() ? clampText(input.subline, 60) : "";
  const photo = input.photoDataUrl;
  const mark = orientation === "wide" ? 420 : 520;

  return (
    <Fill width={width} height={height} background={gradient(theme, 150)}>
      <Decor width={width} height={height} theme={theme} ink={ink} />
      <div style={{ position: "absolute", display: "flex", left: pad - 20, top: pad - mark * 0.12, fontSize: mark, lineHeight: 1, fontWeight: 800, color: ink, opacity: 0.22 }}>{"“"}</div>
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", justifyContent: "space-between", left: 0, top: 0, width, height, padding: pad }}>
        <div style={{ display: "flex", height: 40 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <div style={{ display: "flex", width: textW, fontSize: size, lineHeight: 1.15, fontWeight: 800, letterSpacing: -size * 0.02, color: ink }}>{quote}</div>
          {(author || photo) && (
            <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image
                <img src={photo} width={116} height={116} style={{ objectFit: "cover", borderRadius: 9999, border: `5px solid ${rgba(ink, 0.9)}` }} />
              )}
              {author && (
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <div style={{ display: "flex", width: 56, height: 5, background: ink, opacity: 0.7 }} />
                  <div style={{ display: "flex", fontSize: 40, fontWeight: 500, color: ink }}>{author}</div>
                </div>
              )}
            </div>
          )}
        </div>
        <Brand input={input} ink={ink} theme={theme} />
      </div>
    </Fill>
  );
}
