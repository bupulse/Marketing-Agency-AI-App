// Elegant: Playfair Display headlines, thin rules, ivory space and small letter-spaced labels.
import { mix } from "@/lib/designs/layout";
import { businessName, chipText, Fill, fitHeadline, fitLabel, fitSubline, INK, Logo, Photo, rgba, spacing, WHITE, type LayoutProps, type Spec } from "../shared";

const CW = 0.56;

type Palette = { bg: string; ink: string; muted: string; rule: string };

function paletteFor(theme: LayoutProps["theme"], dark: boolean): Palette {
  if (dark) return { bg: theme.deep, ink: WHITE, muted: "rgba(255,255,255,0.8)", rule: "rgba(255,255,255,0.45)" };
  const deep = mix(theme.primary, "#000000", 0.82);
  return { bg: mix(theme.primary, WHITE, 0.94), ink: deep, muted: rgba(deep, 0.78), rule: rgba(deep, 0.4) };
}

function Rule({ w, color, h = 2 }: { w: number; color: string; h?: number }) {
  return <div style={{ display: "flex", width: w, height: h, background: color }} />;
}

function Eyebrow({ text, color, align = "center" }: { text: string; color: string; align?: "center" | "flex-start" }) {
  if (!text) return null;
  return (
    <div style={{ display: "flex", justifyContent: align, fontSize: 24, fontWeight: 500, letterSpacing: spacing(text, 7), textTransform: "uppercase", color }}>{text}</div>
  );
}

function ChipView({ text, spec, p, w, theme }: { text: string; spec: Spec; p: Palette; w: number; theme: LayoutProps["theme"] }) {
  if (!text) return null;
  if (spec.badge === "block") {
    const size = fitLabel(text, w, 130, 76, CW);
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: w }}>
        <Rule w={160} color={p.rule} />
        <div style={{ display: "flex", fontSize: size, lineHeight: 1.05, fontWeight: 700, color: p.ink, textAlign: "center" }}>{text}</div>
        <Rule w={160} color={p.rule} />
      </div>
    );
  }
  void theme;
  return (
    <div style={{ display: "flex", maxWidth: w, padding: "16px 40px", border: `2px solid ${p.ink}`, color: p.ink, fontSize: 34, fontWeight: 500, letterSpacing: spacing(text, 4), textTransform: "uppercase" }}>{text}</div>
  );
}

export function elegant(props: LayoutProps, spec: Spec) {
  if (spec.mode === "quote") return elegantQuote(props);
  return spec.mode === "photo" ? elegantPhoto(props, spec) : elegantCard(props, spec);
}

function Brand({ input, theme, color, size = 64 }: { input: LayoutProps["input"]; theme: LayoutProps["theme"]; color: string; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <Logo input={input} theme={theme} size={size} radius={9999} />
      <div style={{ display: "flex", fontSize: 24, fontWeight: 500, letterSpacing: spacing(input.businessName, 6), textTransform: "uppercase", color }}>{businessName(input)}</div>
    </div>
  );
}

function elegantPhoto({ input, width, height, orientation, theme, kicker, pack }: LayoutProps, spec: Spec) {
  const photo = input.photoDataUrl;
  const wide = orientation === "wide";
  const tall = orientation === "tall";
  const dark = !!spec.tint;
  const p = paletteFor(theme, dark);
  const cardW = wide ? 900 : width - 200;
  const cardH = wide ? height - 180 : undefined;
  const innerW = cardW - 150;
  const head = fitHeadline(input.headline, { w: innerW, h: wide ? 330 : tall ? (height > 1500 ? 480 : 300) : 240, maxSize: wide ? 88 : tall ? 96 : 86, lineHeight: 1.14, charWidth: CW });
  const sub = fitSubline(input.subline, innerW, 34);
  const chip = chipText(input);

  const body = (
    <div style={{ display: "flex", width: cardW, ...(cardH ? { height: cardH } : {}), padding: 14, background: p.bg }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, width: cardW - 28, ...(cardH ? { height: cardH - 28 } : {}), padding: "46px 61px", border: `2px solid ${p.rule}`, textAlign: "center" }}>
        <Eyebrow text={kicker} color={p.muted} />
        <Rule w={90} color={p.rule} />
        <div style={{ display: "flex", justifyContent: "center", width: innerW, fontSize: head.size, lineHeight: 1.14, fontWeight: 700, letterSpacing: -head.size * 0.01, color: p.ink, textAlign: "center" }}>{head.text}</div>
        {sub && <div style={{ display: "flex", justifyContent: "center", width: innerW, fontSize: sub.size, lineHeight: 1.3, fontWeight: 500, color: p.muted, textAlign: "center" }}>{sub.text}</div>}
        {!!chip && (
          <div style={{ display: "flex", marginTop: 10 }}>
            <ChipView text={chip} spec={spec} p={p} w={innerW} theme={theme} />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Fill width={width} height={height} pack={pack} background={photo ? INK : p.bg}>
      {photo ? (
        <>
          <Photo src={photo} width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }} />
          <div style={{ position: "absolute", display: "flex", left: 0, top: 0, width, height: 360, backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0))" }} />
        </>
      ) : (
        <>
          <div style={{ position: "absolute", display: "flex", left: width * 0.5 - 520, top: height * 0.5 - 520, width: 1040, height: 1040, borderRadius: 9999, border: `2px solid ${rgba(p.ink, 0.12)}` }} />
          <div style={{ position: "absolute", display: "flex", left: 40, top: 40, width: width - 80, height: height - 80, border: `2px solid ${p.rule}` }} />
        </>
      )}
      {(spec.frame || photo) && <div style={{ position: "absolute", display: "flex", left: 30, top: 30, width: width - 60, height: height - 60, border: `2px solid ${rgba(WHITE, 0.8)}` }} />}
      <div style={{ position: "absolute", display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: wide ? (photo ? "flex-start" : "center") : "space-between", left: 0, top: 0, width, height, padding: wide ? 90 : "70px 0" }}>
        {!wide && <Brand input={input} theme={theme} color={photo ? WHITE : p.ink} />}
        <div style={{ display: "flex", boxShadow: photo ? "0 20px 60px rgba(0,0,0,0.35)" : "0 0 0 rgba(0,0,0,0)" }}>{body}</div>
        {!wide && <div style={{ display: "flex", height: 10 }} />}
      </div>
    </Fill>
  );
}

function elegantCard({ input, width, height, orientation, theme, kicker, pack }: LayoutProps, spec: Spec) {
  const photo = input.photoDataUrl;
  const wide = orientation === "wide";
  const tall = orientation === "tall";
  const p = paletteFor(theme, false);
  const row = !tall;
  const margin = 56;
  const innerW = width - margin * 2;
  const innerH = height - margin * 2;
  const archW = row ? Math.round(innerW * (wide ? 0.3 : 0.34)) : Math.round(innerW * 0.62);
  const archH = row ? innerH - 120 : Math.round(innerH * (height > 1500 ? 0.44 : 0.38));
  const textW = row ? innerW - archW - 150 : innerW - 140;
  const head = fitHeadline(input.headline, { w: textW, h: row ? 330 : height > 1500 ? 380 : 260, maxSize: wide ? 84 : 76, lineHeight: 1.14, charWidth: CW });
  const sub = fitSubline(input.subline, textW, 34);
  const chip = chipText(input);
  const circle = spec.badge === "circle" && chip;
  const ringSize = 220;

  const arch = (
    <div style={{ display: "flex", position: "relative", width: archW, height: archH }}>
      <div style={{ display: "flex", width: archW, height: archH, borderTopLeftRadius: 9999, borderTopRightRadius: 9999, overflow: "hidden", backgroundImage: `linear-gradient(160deg, ${theme.primary}, ${theme.secondary})` }}>
        {photo && <Photo src={photo} width={archW} height={archH} />}
      </div>
      <div style={{ position: "absolute", display: "flex", left: -14, top: -14, width: archW + 28, height: archH + 28, borderTopLeftRadius: 9999, borderTopRightRadius: 9999, border: `2px solid ${p.rule}` }} />
      {circle && (
        <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", right: -ringSize * 0.3, bottom: archH * 0.22, width: ringSize, height: ringSize, borderRadius: 9999, background: p.bg, border: `3px solid ${p.ink}` }}>
          <div style={{ display: "flex", justifyContent: "center", width: ringSize * 0.7, fontSize: fitLabel(chip, ringSize * 0.7, ringSize * 0.45, 50, CW), lineHeight: 1.05, fontWeight: 700, color: p.ink, textAlign: "center" }}>{chip}</div>
        </div>
      )}
    </div>
  );

  const text = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: row ? "flex-start" : "center", gap: 22, width: textW, textAlign: row ? "left" : "center" }}>
      <Eyebrow text={kicker} color={p.muted} align={row ? "flex-start" : "center"} />
      <Rule w={90} color={p.rule} />
      <div style={{ display: "flex", justifyContent: row ? "flex-start" : "center", width: textW, fontSize: head.size, lineHeight: 1.14, fontWeight: 700, letterSpacing: -head.size * 0.01, color: p.ink, textAlign: row ? "left" : "center" }}>{head.text}</div>
      {sub && <div style={{ display: "flex", justifyContent: row ? "flex-start" : "center", width: textW, fontSize: sub.size, lineHeight: 1.3, fontWeight: 500, color: p.muted, textAlign: row ? "left" : "center" }}>{sub.text}</div>}
      {!!chip && !circle && (
        <div style={{ display: "flex", marginTop: 8 }}>
          <ChipView text={chip} spec={spec} p={p} w={textW} theme={theme} />
        </div>
      )}
    </div>
  );

  return (
    <Fill width={width} height={height} pack={pack} background={p.bg}>
      <div style={{ position: "absolute", display: "flex", left: 28, top: 28, width: width - 56, height: height - 56, border: `2px solid ${p.rule}` }} />
      <div style={{ position: "absolute", display: "flex", flexDirection: row ? "row" : "column", alignItems: "center", justifyContent: row ? "flex-start" : "space-around", gap: row ? 80 : 0, left: margin, top: margin, width: innerW, height: innerH, padding: row ? "60px 40px 60px 70px" : "50px 0 40px" }}>
        {arch}
        {row ? (
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: archH, flex: 1 }}>
            <div style={{ display: "flex", flex: 1, alignItems: "center" }}>{text}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Logo input={input} theme={theme} size={52} radius={9999} ring={p.rule} />
              <div style={{ display: "flex", fontSize: 22, fontWeight: 500, letterSpacing: spacing(input.businessName, 5), textTransform: "uppercase", color: p.ink }}>{businessName(input)}</div>
            </div>
          </div>
        ) : null}
        {!row && text}
        {!row && <Brand input={input} theme={theme} color={p.ink} size={56} />}
      </div>
    </Fill>
  );
}

function elegantQuote({ input, width, height, orientation, theme, pack }: LayoutProps) {
  const p = paletteFor(theme, false);
  const wide = orientation === "wide";
  const textW = wide ? 1300 : width - 240;
  const boxH = orientation === "tall" ? (height > 1500 ? 760 : 500) : orientation === "square" ? 400 : 340;
  const q = fitHeadline(input.headline, { w: textW, h: boxH, maxSize: wide ? 80 : 84, minSize: 36, lineHeight: 1.22, charWidth: CW });
  const author = input.subline?.trim() ? input.subline.trim().slice(0, 60) : "";
  const photo = input.photoDataUrl;
  return (
    <Fill width={width} height={height} pack={pack} background={p.bg}>
      <div style={{ position: "absolute", display: "flex", left: 40, top: 40, width: width - 80, height: height - 80, border: `2px solid ${p.rule}` }} />
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", left: 0, top: 0, width, height, padding: "110px 0 90px" }}>
        <Brand input={input} theme={theme} color={p.ink} size={60} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 200, lineHeight: 0.6, height: 100, fontWeight: 700, color: theme.primary }}>{"“"}</div>
          <div style={{ display: "flex", justifyContent: "center", width: textW, fontSize: q.size, lineHeight: 1.22, fontWeight: 700, color: p.ink, textAlign: "center" }}>{q.text}</div>
          <Rule w={90} color={p.rule} />
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {photo && <Photo src={photo} width={84} height={84} style={{ borderRadius: 9999 }} />}
            {!!author && <div style={{ display: "flex", fontSize: 28, fontWeight: 500, letterSpacing: spacing(author, 5), textTransform: "uppercase", color: p.muted }}>{author}</div>}
          </div>
        </div>
        <div style={{ display: "flex", height: 4 }} />
      </div>
    </Fill>
  );
}
