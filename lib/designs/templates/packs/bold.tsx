// Bold: Anton in capitals, a dark base, a diagonal brand-colour band and skewed blocks.
// Text always sits on the dark base, so it stays legible whatever the photo looks like.
import { mix } from "@/lib/designs/layout";
import { FONT_FAMILY } from "../fonts";
import { businessName, chipText, Fill, fitHeadline, fitLabel, fitSubline, INK, Logo, Photo, rgba, spacing, WHITE, type LayoutProps, type Spec } from "../shared";

const CW = 0.46;

export function bold(props: LayoutProps, spec: Spec) {
  if (spec.mode === "quote") return boldQuote(props);
  const { input, width, height, orientation, theme, kicker, pack } = props;
  const photo = input.photoDataUrl;
  const wide = orientation === "wide";
  const tall = orientation === "tall";
  const base = mix(theme.deep, INK, 0.45);
  const pad = wide ? 90 : 64;
  const bandH = 124;
  const slab = spec.tint ? theme.accent : theme.primary;
  const slabInk = spec.tint ? theme.onAccent : theme.text;
  const full = spec.mode === "photo";

  // Visual area: the top 44% (square, tall) or the right 52% (wide); the band sits on its edge.
  const visualH = wide ? height : Math.round(height * (tall ? 0.4 : 0.44));
  const visualW = wide ? Math.round(width * 0.52) : width;
  const textTop = wide ? 0 : visualH + 84;
  const textW = wide ? width - visualW - pad - 70 : width - pad * 2;
  const textH = height - textTop;

  const head = fitHeadline(input.headline.toUpperCase(), { w: textW, h: wide ? 520 : tall ? (height > 1500 ? 560 : 360) : 250, maxSize: wide ? 190 : tall ? 170 : 140, minSize: 52, lineHeight: 0.98, charWidth: CW });
  const sub = fitSubline(input.subline, textW, 34);
  const chip = chipText(input);
  const circle = spec.badge === "circle" && !!chip;
  const badge = wide ? 300 : 270;

  const bandStyle = wide
    ? { left: width - visualW - 40, top: -200, width: 80, height: height + 400, transform: "rotate(8deg)" }
    : { left: -100, top: visualH - bandH / 2, width: width + 200, height: bandH, transform: "rotate(-4deg)" };

  return (
    <Fill width={width} height={height} pack={pack} background={base}>
      {photo ? (
        <Photo src={photo} width={full && !wide ? width : visualW} height={full && !wide ? height : visualH} style={{ position: "absolute", right: 0, top: 0 }} />
      ) : (
        <Stripes width={visualW} height={visualH} theme={theme} wide={wide} />
      )}
      {full && !wide && photo && (
        <div style={{ position: "absolute", display: "flex", left: 0, top: 0, width, height, backgroundImage: `linear-gradient(to bottom, ${rgba(base, 0)} 0%, ${rgba(base, 0.1)} 28%, ${rgba(base, 0.88)} ${Math.round((visualH / height) * 100) + 10}%, ${base} 100%)` }} />
      )}
      {wide && photo && <div style={{ position: "absolute", display: "flex", right: 0, top: 0, width: visualW, height, backgroundImage: `linear-gradient(to right, ${rgba(base, 0.55)} 0%, ${rgba(base, 0)} 40%)` }} />}
      <div style={{ position: "absolute", display: "flex", alignItems: "center", paddingLeft: wide ? 0 : pad, paddingRight: wide ? 0 : pad, ...bandStyle, background: slab, color: slabInk }}>
        {!wide && !!kicker && <div style={{ display: "flex", marginLeft: 100, fontSize: 52, fontWeight: 400, letterSpacing: spacing(kicker, 3), textTransform: "uppercase", transform: "rotate(0deg)", color: slabInk }}>{kicker}</div>}
      </div>

      <div style={{ position: "absolute", display: "flex", flexDirection: "column", justifyContent: wide ? "center" : "flex-start", gap: 18, left: pad, top: textTop, width: textW, height: textH, paddingTop: wide ? pad : 0, paddingBottom: pad }}>
        {wide && !!kicker && (
          <div style={{ display: "flex", alignSelf: "flex-start", padding: "10px 30px", background: slab, color: slabInk, fontSize: 44, fontWeight: 400, letterSpacing: spacing(kicker, 3), textTransform: "uppercase", transform: "skewX(-10deg)" }}>{kicker}</div>
        )}
        <div style={{ display: "flex", width: textW, fontSize: head.size, lineHeight: 0.98, fontWeight: 400, letterSpacing: spacing(head.text, 1), textTransform: "uppercase", color: WHITE }}>{head.text}</div>
        {sub && <div style={{ display: "flex", width: textW, fontFamily: FONT_FAMILY, fontSize: sub.size, lineHeight: 1.28, fontWeight: 500, color: "rgba(255,255,255,0.86)" }}>{sub.text}</div>}
        {wide && !!chip && !circle && <ChipBlock text={chip} theme={theme} big={spec.badge === "block"} w={textW} />}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: "auto" }}>
          <Logo input={input} theme={theme} size={64} radius={12} />
          <div style={{ display: "flex", fontSize: 34, fontWeight: 400, letterSpacing: spacing(input.businessName, 3), textTransform: "uppercase", color: WHITE }}>{businessName(input)}</div>
        </div>
      </div>

      {!wide && !!chip && !circle && (
        <div style={{ position: "absolute", display: "flex", right: pad, bottom: height - visualH + bandH / 2 + 30, maxWidth: width - pad * 2 }}>
          <ChipBlock text={chip} theme={theme} big={spec.badge === "block"} w={width - pad * 2} />
        </div>
      )}
      {circle && (
        <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", ...(wide ? { right: 90, bottom: 90 } : { right: pad - 10, bottom: height - visualH + bandH / 2 + 10 }), width: badge, height: badge, borderRadius: 9999, background: theme.accent, color: theme.onAccent, border: `10px solid ${WHITE}`, transform: "rotate(10deg)", boxShadow: "0 14px 40px rgba(0,0,0,0.4)" }}>
          <div style={{ display: "flex", justifyContent: "center", width: badge * 0.72, textAlign: "center", textTransform: "uppercase", fontSize: fitLabel(chip.toUpperCase(), badge * 0.72, badge * 0.5, 96, CW), lineHeight: 1, fontWeight: 400 }}>{chip}</div>
        </div>
      )}
    </Fill>
  );
}

function ChipBlock({ text, theme, big, w }: { text: string; theme: LayoutProps["theme"]; big: boolean; w: number }) {
  const upper = text.toUpperCase();
  const size = fitLabel(upper, Math.min(w, 760) - 70, big ? 110 : 70, big ? 92 : 64, CW);
  return (
    <div style={{ display: "flex", alignSelf: "flex-start", maxWidth: w, padding: big ? "14px 40px" : "10px 34px", background: theme.accent, color: theme.onAccent, fontSize: size, fontWeight: 400, lineHeight: 1.1, textTransform: "uppercase", transform: "skewX(-10deg)", boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}>
      {text}
    </div>
  );
}

/** Diagonal stripes on a brand gradient, stands in for a photo. */
function Stripes({ width, height, theme, wide }: { width: number; height: number; theme: LayoutProps["theme"]; wide: boolean }) {
  const count = 9;
  return (
    <div style={{ position: "absolute", display: "flex", right: 0, top: 0, width, height, overflow: "hidden", backgroundImage: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})` }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ position: "absolute", display: "flex", left: (i - 2) * (width / 5), top: -300, width: width / 14, height: height + 600, background: rgba(theme.text, i % 2 ? 0.1 : 0.05), transform: `rotate(${wide ? 8 : 20}deg)` }} />
      ))}
      <div style={{ position: "absolute", display: "flex", right: wide ? 120 : 70, top: wide ? 220 : 60, width: wide ? 520 : 340, height: wide ? 520 : 340, borderRadius: 9999, border: `28px solid ${rgba(theme.text, 0.16)}` }} />
    </div>
  );
}

function boldQuote({ input, width, height, orientation, theme, pack }: LayoutProps) {
  const base = mix(theme.deep, INK, 0.45);
  const wide = orientation === "wide";
  const pad = wide ? 120 : 80;
  const textW = wide ? 1500 : width - pad * 2;
  const boxH = orientation === "tall" ? (height > 1500 ? 900 : 560) : orientation === "square" ? 430 : 400;
  const q = fitHeadline(input.headline.toUpperCase(), { w: textW, h: boxH, maxSize: wide ? 150 : 160, minSize: 50, lineHeight: 1, charWidth: CW });
  const author = input.subline?.trim() ? input.subline.trim().slice(0, 60) : "";
  const photo = input.photoDataUrl;
  return (
    <Fill width={width} height={height} pack={pack} background={base}>
      <div style={{ position: "absolute", display: "flex", left: -80, top: height * 0.5 - 60, width: width + 160, height: 120, background: theme.primary, transform: "rotate(-4deg)", opacity: 0.16 }} />
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", justifyContent: "space-between", left: 0, top: 0, width, height, padding: pad }}>
        <div style={{ display: "flex", fontSize: 360, lineHeight: 0.7, height: 200, fontWeight: 400, color: theme.primary }}>{"“"}</div>
        <div style={{ display: "flex", width: textW, fontSize: q.size, lineHeight: 1, fontWeight: 400, textTransform: "uppercase", color: WHITE }}>{q.text}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {photo && <Photo src={photo} width={100} height={100} style={{ borderRadius: 9999, border: `5px solid ${theme.primary}` }} />}
            {!!author && <div style={{ display: "flex", padding: "8px 28px", background: theme.primary, color: theme.text, fontSize: 40, fontWeight: 400, textTransform: "uppercase", transform: "skewX(-10deg)" }}>{author}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Logo input={input} theme={theme} size={56} radius={12} />
            <div style={{ display: "flex", fontSize: 30, fontWeight: 400, letterSpacing: spacing(input.businessName, 3), textTransform: "uppercase", color: WHITE }}>{businessName(input)}</div>
          </div>
        </div>
      </div>
    </Fill>
  );
}
