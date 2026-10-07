// Warm: Nunito, soft cream gradients, rounded photo shapes and pill labels. Friendly and inviting.
import { mix } from "@/lib/designs/layout";
import { businessName, chipText, Fill, fitHeadline, fitLabel, fitSubline, Logo, Photo, rgba, WHITE, type LayoutProps, type Spec } from "../shared";

const CW = 0.56;

/** A photo cropped to a rounded shape; without a photo, the brand gradient with the logo in the middle. */
export function Visual({ photo, w, h, radius, theme, input, border = 10, style }: { photo?: string | null; w: number; h: number; radius: number; theme: LayoutProps["theme"]; input: LayoutProps["input"]; border?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", position: "relative", alignItems: "center", justifyContent: "center", width: w, height: h, borderRadius: radius, overflow: "hidden", border: `${border}px solid ${WHITE}`, boxShadow: "0 24px 60px rgba(0,0,0,0.22)", backgroundImage: `linear-gradient(145deg, ${theme.primary}, ${theme.secondary})`, ...style }}>
      {photo ? (
        <Photo src={photo} width={w - border * 2} height={h - border * 2} />
      ) : (
        <>
          <div style={{ position: "absolute", display: "flex", right: -w * 0.12, top: -w * 0.12, width: w * 0.5, height: w * 0.5, borderRadius: 9999, background: rgba(theme.accent, 0.45) }} />
          <div style={{ position: "absolute", display: "flex", left: -w * 0.1, bottom: -w * 0.14, width: w * 0.42, height: w * 0.42, borderRadius: 9999, background: rgba(theme.text, 0.1) }} />
          <Logo input={input} theme={{ ...theme, primary: WHITE, text: mix(theme.primary, "#000000", 0.7) }} size={Math.min(w, h) * 0.34} radius={Math.min(w, h) * 0.09} />
        </>
      )}
    </div>
  );
}

export function warm(props: LayoutProps, spec: Spec) {
  if (spec.mode === "quote") return warmQuote(props);
  const { input, width, height, orientation, theme, kicker, pack } = props;
  const photo = input.photoDataUrl;
  const wide = orientation === "wide";
  const tall = orientation === "tall";
  const tint = !!spec.tint;
  const deep = mix(theme.primary, "#000000", 0.8);
  const ink = tint ? theme.text : deep;
  const muted = tint ? theme.textMuted : rgba(deep, 0.78);
  const bg = tint ? `linear-gradient(150deg, ${theme.primary}, ${theme.secondary})` : `linear-gradient(160deg, ${mix(theme.primary, WHITE, 0.93)} 0%, ${mix(theme.secondary, WHITE, 0.86)} 100%)`;
  const pad = wide ? 84 : 52;
  const cardMode = spec.mode === "card";
  const centered = cardMode && !wide;
  const chip = chipText(input);
  const chipBg = tint ? WHITE : theme.primary;
  const chipFg = tint ? deep : theme.text;
  const circle = spec.badge === "circle" && !!chip;
  const block = spec.badge === "block";

  // Visual size and where it sits.
  const photoW = wide ? 760 : width - 96;
  const photoH = wide ? height - 96 : tall ? (height > 1500 ? 860 : 620) : 420;
  const lift = tall && height > 1500 ? 150 : 0; // 9:16: spread the content down the tall canvas
  const disc = wide ? 880 : Math.min(width * 0.6, tall ? (lift ? 760 : 700) : 430);
  const textW = wide ? width - (cardMode ? 640 : photoW + 48) - pad * 2 : width - pad * 2;
  const textTop = wide ? 0 : cardMode ? 56 + lift + disc + 34 : 48 + lift + photoH + 40;
  const head = fitHeadline(input.headline, { w: textW, h: wide ? 360 : tall ? (height > 1500 ? 420 : 280) : cardMode ? 170 : 210, maxSize: wide ? 100 : tall ? 96 : 88, lineHeight: 1.08, charWidth: CW });
  const sub = fitSubline(input.subline, textW, 36);
  const align = centered ? "center" : "flex-start";
  const badge = wide ? 250 : 230;

  const visual = cardMode ? (
    wide ? (
      <Visual photo={photo} w={disc} h={disc} radius={9999} theme={theme} input={input} border={14} style={{ position: "absolute", right: -150, top: (height - disc) / 2 }} />
    ) : (
      <Visual photo={photo} w={disc} h={disc} radius={9999} theme={theme} input={input} border={14} style={{ position: "absolute", left: (width - disc) / 2, top: 56 + lift }} />
    )
  ) : (
    <Visual photo={photo} w={photoW} h={photoH} radius={72} theme={theme} input={input} border={spec.frame ? 16 : 10} style={{ position: "absolute", ...(wide ? { right: 48, top: 48 } : { left: 48, top: 48 + lift }) }} />
  );

  return (
    <Fill width={width} height={height} pack={pack} background={bg}>
      <div style={{ position: "absolute", display: "flex", left: -160, bottom: -200, width: 560, height: 560, borderRadius: 9999, background: rgba(tint ? WHITE : theme.accent, tint ? 0.12 : 0.28) }} />
      {visual}
      {!cardMode && !wide && (
        <div style={{ position: "absolute", display: "flex", alignItems: "center", gap: 14, left: 78, top: 78, padding: "10px 26px 10px 10px", borderRadius: 9999, background: WHITE }}>
          <Logo input={input} theme={theme} size={52} radius={9999} />
          <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: deep }}>{businessName(input)}</div>
        </div>
      )}
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: align, justifyContent: wide ? "center" : "flex-start", gap: 20, left: 0, top: textTop, width: wide ? width - (cardMode ? 640 : photoW + 48) : width, height: height - textTop, padding: `${wide ? pad : 0}px ${pad}px ${pad}px` }}>
        {wide && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
            <Logo input={input} theme={theme} size={64} radius={9999} />
            <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: ink }}>{businessName(input)}</div>
          </div>
        )}
        {!!kicker && <div style={{ display: "flex", padding: "9px 26px", borderRadius: 9999, background: tint ? rgba(theme.text, 0.18) : theme.primary, color: tint ? ink : theme.text, fontSize: 30, fontWeight: 800 }}>{kicker}</div>}
        <div style={{ display: "flex", justifyContent: centered ? "center" : "flex-start", width: textW, fontSize: head.size, lineHeight: 1.08, fontWeight: 800, letterSpacing: -head.size * 0.015, color: ink, textAlign: centered ? "center" : "left" }}>{head.text}</div>
        {sub && <div style={{ display: "flex", justifyContent: centered ? "center" : "flex-start", width: textW, fontSize: sub.size, lineHeight: 1.3, fontWeight: 500, color: muted, textAlign: centered ? "center" : "left" }}>{sub.text}</div>}
        {!!chip && !circle && (
          <div style={{ display: "flex", maxWidth: textW, padding: block ? "16px 38px" : "12px 34px", borderRadius: block ? 28 : 9999, background: chipBg, color: chipFg, fontSize: block ? 48 : 38, fontWeight: 800, boxShadow: "0 8px 24px rgba(0,0,0,0.14)" }}>{chip}</div>
        )}
        {cardMode && !wide && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: "auto" }}>
            <Logo input={input} theme={theme} size={52} radius={9999} />
            <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: ink }}>{businessName(input)}</div>
          </div>
        )}
      </div>
      {circle && (
        <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", width: badge, height: badge, borderRadius: 9999, background: theme.accent, color: theme.onAccent, border: `8px solid ${WHITE}`, boxShadow: "0 14px 40px rgba(0,0,0,0.25)", ...(wide ? { left: width - 640 - badge * 0.5, top: height - badge - 80 } : { left: width / 2 + disc / 2 - badge * 0.75, top: 56 + lift + disc - badge }) }}>
          <div style={{ display: "flex", justifyContent: "center", width: badge * 0.72, textAlign: "center", fontSize: fitLabel(chip, badge * 0.72, badge * 0.5, 60, CW), lineHeight: 1.05, fontWeight: 800 }}>{chip}</div>
        </div>
      )}
    </Fill>
  );
}

function warmQuote({ input, width, height, orientation, theme, pack }: LayoutProps) {
  const wide = orientation === "wide";
  const deep = mix(theme.primary, "#000000", 0.8);
  const pad = wide ? 130 : 84;
  const cardW = width - pad * 2;
  const textW = cardW - 120;
  const boxH = orientation === "tall" ? (height > 1500 ? 720 : 440) : orientation === "square" ? 340 : 300;
  const q = fitHeadline(input.headline, { w: textW, h: boxH, maxSize: wide ? 84 : 88, minSize: 36, lineHeight: 1.2, charWidth: CW });
  const author = input.subline?.trim() ? input.subline.trim().slice(0, 60) : "";
  const photo = input.photoDataUrl;
  return (
    <Fill width={width} height={height} pack={pack} background={`linear-gradient(150deg, ${theme.primary}, ${theme.secondary})`}>
      <div style={{ position: "absolute", display: "flex", right: -180, top: -180, width: 620, height: 620, borderRadius: 9999, background: rgba(theme.accent, 0.4) }} />
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", justifyContent: "space-between", left: 0, top: 0, width, height, padding: pad - 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Logo input={input} theme={{ ...theme, primary: WHITE, text: deep }} size={64} radius={9999} />
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: theme.text }}>{businessName(input)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 30, padding: 60, borderRadius: 64, background: WHITE, boxShadow: "0 24px 70px rgba(0,0,0,0.22)" }}>
          <div style={{ display: "flex", fontSize: 150, lineHeight: 0.7, height: 70, fontWeight: 800, color: theme.primary }}>{"“"}</div>
          <div style={{ display: "flex", width: textW, fontSize: q.size, lineHeight: 1.2, fontWeight: 800, color: deep }}>{q.text}</div>
          {(author || photo) && (
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              {photo && <Photo src={photo} width={96} height={96} style={{ borderRadius: 9999 }} />}
              {!!author && <div style={{ display: "flex", fontSize: 36, fontWeight: 500, color: rgba(deep, 0.78) }}>{author}</div>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", height: 10 }} />
      </div>
    </Fill>
  );
}
