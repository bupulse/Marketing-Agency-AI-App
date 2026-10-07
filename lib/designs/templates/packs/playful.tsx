// Playful: Nunito, bright brand colour, white stickers with thick ink borders and hard shadows,
// a tilted polaroid and confetti shapes.
import { businessName, chipText, Fill, fitHeadline, fitLabel, fitSubline, INK, Logo, Photo, rgba, WHITE, type LayoutProps, type Spec } from "../shared";

const CW = 0.56;
const SHADOW = `8px 8px 0 ${INK}`;

function Sticker({ children, bg = WHITE, rotate, style }: { children: React.ReactNode; bg?: string; rotate: number; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", background: bg, border: `5px solid ${INK}`, boxShadow: SHADOW, transform: `rotate(${rotate}deg)`, ...style }}>{children}</div>
  );
}

function Confetti({ width, height, theme, seed }: { width: number; height: number; theme: LayoutProps["theme"]; seed: number }) {
  const s = Math.min(width, height);
  // Kept clear of the brand (top left) and the kicker (top right).
  return (
    <>
      <div style={{ position: "absolute", display: "flex", right: s * 0.05, top: height * 0.5 - seed, width: s * 0.1, height: s * 0.1, borderRadius: 9999, background: theme.accent, border: `4px solid ${INK}` }} />
      <div style={{ position: "absolute", display: "flex", left: s * 0.04, top: height * 0.22, width: s * 0.07, height: s * 0.07, borderRadius: 9999, border: `8px solid ${rgba(WHITE, 0.85)}` }} />
      <div style={{ position: "absolute", display: "flex", left: s * 0.1, top: height * 0.62, width: s * 0.05, height: s * 0.05, background: WHITE, border: `4px solid ${INK}`, transform: "rotate(20deg)" }} />
      <div style={{ position: "absolute", display: "flex", right: s * 0.16, top: height * 0.34, width: s * 0.06, height: s * 0.06, borderRadius: 9999, background: rgba(WHITE, 0.9) }} />
    </>
  );
}

export function playful(props: LayoutProps, spec: Spec) {
  if (spec.mode === "quote") return playfulQuote(props);
  const { input, width, height, orientation, theme, kicker, pack } = props;
  const photo = input.photoDataUrl;
  const wide = orientation === "wide";
  const tall = orientation === "tall";
  const tint = !!spec.tint;
  const bg = tint ? theme.accent : theme.primary;
  const onBg = tint ? theme.onAccent : theme.text;
  const pad = wide ? 80 : 56;
  const chip = chipText(input);
  const circle = spec.badge === "circle" && !!chip;
  const block = spec.badge === "block";

  const stickerH = wide ? height - pad * 2 - 130 : tall ? (height > 1500 ? 600 : 470) : 400;
  const stickerW = wide ? 1000 : width - pad * 2 + 16;
  const innerW = stickerW - 80;
  const sub = fitSubline(input.subline, innerW, 36);
  const subH = sub ? 28 + Math.ceil((sub.text.length * sub.size * 0.54) / innerW) * sub.size * 1.3 : 0;
  const head = fitHeadline(input.headline, { w: innerW, h: Math.max(160, stickerH - 76 - subH - 20), maxSize: wide ? 110 : tall ? 108 : 100, lineHeight: 1.06, charWidth: CW });

  const zoneH = wide ? height - pad * 2 : height - pad * 2 - 90 - stickerH + 60 - 24;
  const zoneW = wide ? width - stickerW - pad * 2 - 40 : width - pad * 2;
  const frame = Math.round(Math.min(zoneW * 0.78, zoneH - 40, wide ? 760 : 700));
  const pol = frame;
  const polaroid = (
    <div style={{ display: "flex", flexDirection: "column", width: pol, height: Math.round(pol * 1.06), padding: "22px 22px 0", background: WHITE, border: `5px solid ${INK}`, boxShadow: SHADOW, transform: `rotate(${spec.mode === "card" ? 5 : -4}deg)` }}>
      {photo ? (
        <Photo src={photo} width={pol - 54} height={Math.round(pol * 0.82)} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: pol - 54, height: Math.round(pol * 0.82), backgroundImage: `linear-gradient(145deg, ${theme.secondary}, ${theme.accent})` }}>
          <Logo input={input} theme={theme} size={pol * 0.36} radius={pol * 0.08} ring={INK} />
        </div>
      )}
    </div>
  );

  const badge = Math.min(wide ? 290 : 270, frame * 0.6);

  return (
    <Fill width={width} height={height} pack={pack} background={bg}>
      <Confetti width={width} height={height} theme={theme} seed={tall ? 120 : 40} />
      <div style={{ position: "absolute", display: "flex", flexDirection: wide ? "row" : "column", justifyContent: "space-between", left: 0, top: 0, width, height, padding: pad }}>
        {!wide && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 90 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Logo input={input} theme={{ ...theme, primary: WHITE, text: INK }} size={68} radius={20} ring={INK} />
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: onBg }}>{businessName(input)}</div>
            </div>
            {!!kicker && <Sticker rotate={4} bg={tint ? WHITE : theme.accent} style={{ padding: "8px 24px", color: INK, fontSize: 26, fontWeight: 800, textTransform: "uppercase", letterSpacing: 2, boxShadow: `5px 5px 0 ${INK}` }}>{kicker}</Sticker>}
          </div>
        )}
        {wide && (
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: stickerW }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 90 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <Logo input={input} theme={{ ...theme, primary: WHITE, text: INK }} size={68} radius={20} ring={INK} />
                <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: onBg }}>{businessName(input)}</div>
              </div>
              {!!kicker && <Sticker rotate={4} bg={tint ? WHITE : theme.accent} style={{ padding: "8px 24px", color: INK, fontSize: 26, fontWeight: 800, textTransform: "uppercase", letterSpacing: 2, boxShadow: `5px 5px 0 ${INK}` }}>{kicker}</Sticker>}
            </div>
            <HeadSticker head={head} sub={sub} w={stickerW} h={stickerH} rotate={-2} />
          </div>
        )}
        <div style={{ display: "flex", position: "relative", alignItems: "center", justifyContent: "center", width: zoneW, height: zoneH }}>
          {polaroid}
          {!!chip && !circle && (
            <Sticker rotate={-6} bg={tint ? WHITE : theme.accent} style={{ position: "absolute", left: wide ? 0 : 8, bottom: wide ? 40 : 30, maxWidth: zoneW * 0.72, padding: block ? "14px 36px" : "10px 30px", borderRadius: block ? 18 : 9999, color: INK, fontSize: block ? 52 : 40, fontWeight: 800 }}>{chip}</Sticker>
          )}
          {circle && (
            <Sticker rotate={-10} bg={WHITE} style={{ position: "absolute", alignItems: "center", justifyContent: "center", right: wide ? 20 : 0, bottom: wide ? 30 : 10, width: badge, height: badge, borderRadius: 9999 }}>
              <div style={{ display: "flex", justifyContent: "center", width: badge * 0.72, textAlign: "center", fontSize: fitLabel(chip, badge * 0.72, badge * 0.5, 62, CW), lineHeight: 1.05, fontWeight: 800, color: INK }}>{chip}</div>
            </Sticker>
          )}
        </div>
        {!wide && <HeadSticker head={head} sub={sub} w={stickerW} h={stickerH} rotate={-2} style={{ marginTop: -60, alignSelf: "center" }} />}
      </div>
    </Fill>
  );
}

function HeadSticker({ head, sub, w, h, rotate, style }: { head: { text: string; size: number }; sub: { text: string; size: number } | null; w: number; h: number; rotate: number; style?: React.CSSProperties }) {
  return (
    <Sticker rotate={rotate} style={{ flexDirection: "column", justifyContent: "center", gap: 16, width: w, height: h, padding: "36px 40px", ...style }}>
      <div style={{ display: "flex", width: w - 80, fontSize: head.size, lineHeight: 1.06, fontWeight: 800, letterSpacing: -head.size * 0.015, color: INK }}>{head.text}</div>
      {sub && <div style={{ display: "flex", width: w - 80, fontSize: sub.size, lineHeight: 1.3, fontWeight: 500, color: "rgba(11,11,15,0.78)" }}>{sub.text}</div>}
    </Sticker>
  );
}

function playfulQuote({ input, width, height, orientation, theme, pack }: LayoutProps) {
  const wide = orientation === "wide";
  const pad = wide ? 120 : 76;
  const w = width - pad * 2;
  const textW = w - 100;
  const boxH = orientation === "tall" ? (height > 1500 ? 700 : 420) : orientation === "square" ? 340 : 300;
  const q = fitHeadline(input.headline, { w: textW, h: boxH, maxSize: wide ? 84 : orientation === "tall" ? 110 : 90, minSize: 36, lineHeight: 1.18, charWidth: CW });
  const author = input.subline?.trim() ? input.subline.trim().slice(0, 60) : "";
  const photo = input.photoDataUrl;
  return (
    <Fill width={width} height={height} pack={pack} background={theme.primary}>
      <Confetti width={width} height={height} theme={theme} seed={60} />
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", justifyContent: "space-between", left: 0, top: 0, width, height, padding: pad - 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Logo input={input} theme={{ ...theme, primary: WHITE, text: INK }} size={68} radius={20} ring={INK} />
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: theme.text }}>{businessName(input)}</div>
        </div>
        <Sticker rotate={-2} style={{ flexDirection: "column", gap: 24, width: w, padding: "40px 50px", borderRadius: 48 }}>
          <div style={{ display: "flex", fontSize: 150, lineHeight: 0.7, height: 66, fontWeight: 800, color: theme.primary }}>{"“"}</div>
          <div style={{ display: "flex", width: textW, fontSize: q.size, lineHeight: 1.18, fontWeight: 800, color: INK }}>{q.text}</div>
        </Sticker>
        {(author || photo) && (
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {photo && <Photo src={photo} width={100} height={100} style={{ borderRadius: 9999, border: `5px solid ${INK}` }} />}
            {!!author && <Sticker rotate={3} bg={theme.accent} style={{ padding: "8px 28px", borderRadius: 9999, color: theme.onAccent, fontSize: 36, fontWeight: 800 }}>{author}</Sticker>}
          </div>
        )}
        {!(author || photo) && <div style={{ display: "flex", height: 10 }} />}
      </div>
    </Fill>
  );
}
