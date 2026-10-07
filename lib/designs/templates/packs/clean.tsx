// Clean: Inter, left-aligned, a white panel over the photo, a brand-colour bar and hairlines.
// Restrained and professional; the layout is the same for every template kind, only the panel
// treatment and the chip change.
import { businessName, chipText, Fill, fitHeadline, fitLabel, fitSubline, INK, Logo, Photo, rgba, spacing, WHITE, type LayoutProps, type Spec } from "../shared";

const CW = 0.6;

const gradient = (theme: LayoutProps["theme"], angle: number) => `linear-gradient(${angle}deg, ${theme.primary} 0%, ${theme.secondary} 100%)`;

function Kicker({ text, color, accent }: { text: string; color: string; accent: string }) {
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", width: 44, height: 8, background: accent }} />
      <div style={{ display: "flex", fontSize: 26, fontWeight: 800, letterSpacing: spacing(text, 4), textTransform: "uppercase", color }}>{text}</div>
    </div>
  );
}

export function clean(props: LayoutProps, spec: Spec) {
  if (spec.mode === "quote") return cleanQuote(props);
  const { input, width, height, orientation, theme, kicker, pack } = props;
  const photo = input.photoDataUrl;
  const wide = orientation === "wide";
  const tall = orientation === "tall";
  const flush = spec.mode === "card";
  const inset = wide || flush ? 0 : 44;
  const panelPad = wide ? 84 : 52;
  const panelW = wide ? 900 : width - inset * 2;
  const textW = panelW - panelPad * 2;
  const tint = !!spec.tint;
  const ink = tint ? theme.text : INK;
  const muted = tint ? theme.textMuted : "rgba(11,11,15,0.7)";
  const bar = tint ? theme.text : theme.primary;
  const circle = spec.badge === "circle" && !!chipText(input);

  const head = fitHeadline(input.headline, { w: circle && !wide ? textW - 150 : textW, h: wide ? 420 : tall ? (height > 1500 ? 420 : 300) : 230, maxSize: wide ? 96 : tall ? 100 : 84, lineHeight: 1.06, charWidth: CW });
  const sub = fitSubline(input.subline, textW, 36);
  const chip = chipText(input);
  const block = spec.badge === "block";
  const chipBg = tint ? ink : theme.primary;
  const chipFg = tint ? (ink === WHITE ? INK : WHITE) : theme.text;
  const badge = Math.round(wide ? 250 : 230);

  const panel = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "relative",
        justifyContent: wide ? "center" : "flex-start",
        gap: 22,
        width: panelW,
        ...(wide ? { height } : {}),
        padding: panelPad,
        paddingTop: wide ? panelPad : 46,
        background: tint ? theme.primary : WHITE,
        borderTopWidth: wide ? 0 : flush ? 16 : 10,
        borderTopStyle: "solid",
        borderTopColor: tint ? theme.text : theme.primary,
        boxShadow: wide || flush ? "0 0 0 rgba(0,0,0,0)" : "0 18px 60px rgba(0,0,0,0.25)",
      }}
    >
      {wide && (
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 12 }}>
          <Logo input={input} theme={theme} size={72} radius={16} ring={tint ? "" : "rgba(11,11,15,0.12)"} />
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: ink }}>{businessName(input)}</div>
        </div>
      )}
      <Kicker text={kicker} color={muted} accent={bar} />
      <div style={{ display: "flex", width: circle && !wide ? textW - 150 : textW, fontSize: head.size, lineHeight: 1.06, fontWeight: 800, letterSpacing: -head.size * 0.025, color: ink }}>{head.text}</div>
      {sub && <div style={{ display: "flex", width: textW, fontSize: sub.size, lineHeight: 1.3, fontWeight: 500, color: muted }}>{sub.text}</div>}
      {!!chip && !circle && (
        <div style={{ display: "flex", marginTop: 6 }}>
          <div style={{ display: "flex", maxWidth: textW, padding: block ? "18px 36px" : "14px 34px", borderRadius: block ? 6 : 9999, background: chipBg, color: chipFg, fontSize: block ? 48 : 38, fontWeight: 800, letterSpacing: -0.5 }}>{chip}</div>
        </div>
      )}
      {circle && (
        <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", right: 40, top: wide ? panelPad : -badge * 0.42, width: badge, height: badge, borderRadius: 9999, background: chipBg, color: chipFg, border: `8px solid ${tint ? theme.primary : WHITE}`, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
          <div style={{ display: "flex", width: badge * 0.7, justifyContent: "center", textAlign: "center", fontSize: fitLabel(chip, badge * 0.7, badge * 0.5, 60, CW), lineHeight: 1.05, fontWeight: 800 }}>{chip}</div>
        </div>
      )}
    </div>
  );

  return (
    <Fill width={width} height={height} pack={pack} background={photo ? INK : gradient(theme, 150)}>
      {photo ? (
        <Photo src={photo} width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }} />
      ) : (
        <Backdrop width={width} height={height} theme={theme} />
      )}
      {spec.frame && <div style={{ position: "absolute", display: "flex", left: 22, top: 22, width: width - 44, height: height - 44, border: `3px solid ${rgba(WHITE, 0.85)}` }} />}
      {!wide && (
        <div style={{ position: "absolute", display: "flex", alignItems: "center", gap: 18, left: 44, top: 44, padding: "12px 28px 12px 14px", borderRadius: 9999, background: WHITE }}>
          <Logo input={input} theme={theme} size={56} radius={14} />
          <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: INK }}>{businessName(input)}</div>
        </div>
      )}
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", justifyContent: wide ? "flex-start" : "flex-end", left: wide ? 0 : inset, top: 0, width: wide ? panelW : width - inset * 2, height, paddingBottom: wide ? 0 : inset }}>
        {panel}
      </div>
    </Fill>
  );
}

/** Grid of hairlines on the brand gradient, stands in for a photo. */
function Backdrop({ width, height, theme }: { width: number; height: number; theme: LayoutProps["theme"] }) {
  const step = 120;
  const lines = Array.from({ length: Math.ceil(width / step) }, (_, i) => i);
  const rows = Array.from({ length: Math.ceil(height / step) }, (_, i) => i);
  const line = rgba(theme.text === WHITE ? WHITE : INK, 0.1);
  return (
    <>
      {lines.map((i) => (
        <div key={`v${i}`} style={{ position: "absolute", display: "flex", left: i * step, top: 0, width: 2, height, background: line }} />
      ))}
      {rows.map((i) => (
        <div key={`h${i}`} style={{ position: "absolute", display: "flex", left: 0, top: i * step, width, height: 2, background: line }} />
      ))}
      <div style={{ position: "absolute", display: "flex", right: -140, top: -140, width: 560, height: 560, borderRadius: 9999, border: `2px solid ${rgba(theme.text, 0.35)}` }} />
      <div style={{ position: "absolute", display: "flex", right: 40, top: 40, width: 260, height: 260, borderRadius: 9999, background: rgba(theme.accent, 0.55) }} />
    </>
  );
}

function cleanQuote({ input, width, height, orientation, theme, pack }: LayoutProps) {
  const wide = orientation === "wide";
  const pad = wide ? 130 : 96;
  const textW = (wide ? 1400 : width - pad * 2) - 40;
  const boxH = orientation === "tall" ? (height > 1500 ? 800 : 520) : orientation === "square" ? 440 : 400;
  const q = fitHeadline(input.headline, { w: textW, h: boxH, maxSize: wide ? 88 : 96, minSize: 38, lineHeight: 1.18, charWidth: CW });
  const author = input.subline?.trim() ? input.subline.trim().slice(0, 60) : "";
  const photo = input.photoDataUrl;
  return (
    <Fill width={width} height={height} pack={pack} background="#F5F6F8">
      <div style={{ position: "absolute", display: "flex", left: 0, top: 0, width: 28, height, background: theme.primary }} />
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", justifyContent: "space-between", left: 28, top: 0, width: width - 28, height, padding: `${pad - 20}px ${pad}px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Logo input={input} theme={theme} size={64} radius={14} ring="rgba(11,11,15,0.12)" />
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: INK }}>{businessName(input)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
          <div style={{ display: "flex", fontSize: 260, lineHeight: 0.6, height: 120, fontWeight: 800, color: theme.primary }}>{"“"}</div>
          <div style={{ display: "flex", width: textW, fontSize: q.size, lineHeight: 1.18, fontWeight: 800, letterSpacing: -q.size * 0.02, color: INK }}>{q.text}</div>
          {(author || photo) && (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              {photo && <Photo src={photo} width={104} height={104} style={{ borderRadius: 16 }} />}
              {!!author && <div style={{ display: "flex", fontSize: 38, fontWeight: 500, color: "rgba(11,11,15,0.7)" }}>{author}</div>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", width: 80, height: 4, background: "rgba(11,11,15,0.2)" }} />
      </div>
    </Fill>
  );
}
