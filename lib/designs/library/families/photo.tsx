// Photo-led layout families: hero, split, polaroid, circle, diagonal and magazine. Each reads the variant's knobs
// (tone, motif, flip, shape, accent, scale, center) and lays out for square, portrait, story and landscape.
import { rgba } from "@/lib/designs/layout";
import { Abs, Badge, Box, BrandLine, BrandPill, Chip, chipOf, Frame, Head, Kicker, Mark, name, Pattern, Picture, Root, Scrim, Sub, WHITE, type Ctx, background } from "../kit";

function shadowOf(c: Ctx): string | undefined {
  return c.s.shadow === "hard" ? `14px 14px 0 ${rgba("#000000", 0.85)}` : c.s.shadow === "soft" ? "0 20px 60px rgba(0,0,0,0.28)" : undefined;
}

/** The text stack every family uses: kicker, headline, accent mark, subline, chip. */
function Stack({ c, sf, w, headH, headMax, center, gap = 22, chip = true, subMax = 36 }: { c: Ctx; sf: Ctx["main"]; w: number; headH: number; headMax: number; center?: boolean; gap?: number; chip?: boolean; subMax?: number }) {
  return (
    <Box style={{ flexDirection: "column", gap, width: w, alignItems: center ? "center" : "flex-start" }}>
      <Kicker c={c} sf={sf} center={center} />
      <Head c={c} text={c.input.headline} w={w} h={headH} max={headMax} color={sf.fg} center={center} />
      <Mark c={c} sf={sf} center={center} />
      <Sub c={c} text={c.input.subline} w={w} color={sf.muted} center={center} max={subMax} />
      {chip && <Chip c={c} sf={sf} center={center} maxW={w} />}
    </Box>
  );
}

// ---- hero: full-bleed photo, text panel ----

export function hero(c: Ctx) {
  const { W, H, k, wide } = c;
  const sf = c.main;
  const floating = k.shape !== "rect";
  const inset = floating ? 48 : 0;
  const pad = wide ? 80 : 56;
  const panelW = wide ? 860 : W - inset * 2;
  const textW = panelW - pad * 2;
  const headH = wide ? 420 : c.story ? 460 : c.tall ? 330 : 250;
  const top = k.flip && !wide;
  const slant = k.shape === "slant";
  const panelX = wide ? (k.flip ? W - panelW - inset : inset) : inset;
  const wedge = 90;
  const panelH = H - inset * 2;
  const panelStyle = {
    flexDirection: "column" as const,
    position: "relative" as const,
    width: panelW,
    height: wide ? panelH : undefined,
    justifyContent: "center",
    padding: pad,
    paddingLeft: wide && slant && k.flip ? pad + 120 : pad,
    paddingRight: wide && slant && !k.flip ? pad + 120 : pad,
    background: slant ? sf.bg : background(sf),
    borderRadius: floating && !slant ? Math.max(18, c.s.radius) : 0,
    boxShadow: floating && !slant ? shadowOf(c) : undefined,
    // Polygons in px (Satori resolves percentages in clip paths unreliably); tall panels get a wedge instead.
    clipPath: slant && wide ? (k.flip ? `polygon(120px 0px, ${panelW}px 0px, ${panelW}px ${panelH}px, 0px ${panelH}px)` : `polygon(0px 0px, ${panelW - 120}px 0px, ${panelW}px ${panelH}px, 0px ${panelH}px)`) : undefined,
    overflow: "hidden" as const,
  };
  const wedgeEl = slant && !wide ? <Box style={{ width: panelW, height: wedge, background: sf.bg, clipPath: top ? `polygon(0px 0px, ${panelW}px 0px, 0px ${wedge}px)` : `polygon(0px ${wedge}px, ${panelW}px 0px, ${panelW}px ${wedge}px)` }} /> : null;
  return (
    <Root c={c} sf={c.surfaces.night}>
      <Picture c={c} x={0} y={0} w={W} h={H} shape="rect" />
      <Frame c={c} x={36} y={36} w={W - 72} h={H - 72} color={WHITE} />
      <Abs x={wide ? (k.flip ? 48 : W - 48 - 420) : 44} y={wide ? 48 : top ? H - 44 - 72 : 44}>
        <BrandPill c={c} />
      </Abs>
      <Abs x={panelX} y={0} w={panelW} h={H} style={{ flexDirection: "column", justifyContent: wide ? "center" : top ? "flex-start" : "flex-end", paddingTop: top || wide ? inset : 0, paddingBottom: !top || wide ? inset : 0 }}>
        {!top && wedgeEl}
        <Box style={panelStyle}>
          <Pattern c={c} x={0} y={0} w={panelW} h={wide ? H : 900} color={sf.fg} opacity={0.08} />
          <Stack c={c} sf={sf} w={wide && slant ? textW - 120 : textW} headH={headH} headMax={wide ? 96 : c.tall ? 100 : 84} center={k.center} />
        </Box>
        {top && wedgeEl}
      </Abs>
    </Root>
  );
}

// ---- split: photo one side, message the other ----

export function split(c: Ctx) {
  const { W, H, k, wide, tall } = c;
  const sf = c.main;
  const vertical = tall;
  const photoShare = vertical && !c.story ? 0.44 : 0.5;
  const pw = vertical ? W : Math.round(W * photoShare);
  const ph = vertical ? Math.round(H * photoShare) : H;
  const px = vertical ? 0 : k.flip ? W - pw : 0;
  const py = vertical ? (k.flip ? H - ph : 0) : 0;
  const flush = k.shape === "rect";
  const m = flush ? 0 : 48;
  const tx = vertical ? 0 : k.flip ? 0 : pw;
  const ty = vertical ? (k.flip ? 0 : ph) : 0;
  const tw = vertical ? W : W - pw;
  const th = vertical ? H - ph : H;
  const pad = wide ? 80 : 60;
  const textW = tw - pad * 2;
  const headH = vertical ? (c.story ? 420 : 210) : wide ? 420 : 330;
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={tx} y={ty} w={tw} h={th} color={sf.hi} opacity={0.14} />
      <Picture c={c} x={px + m} y={py + m} w={pw - m * 2} h={ph - m * 2} shape={k.shape} />
      <Abs x={tx} y={ty} w={tw} h={th} style={{ flexDirection: "column", justifyContent: "space-between", padding: pad }}>
        <BrandLine c={c} sf={sf} size={wide ? 64 : 56} />
        <Stack c={c} sf={sf} w={textW} headH={headH} headMax={wide ? 92 : vertical ? 92 : 76} subMax={vertical ? 36 : 32} />
      </Abs>
    </Root>
  );
}

// ---- polaroid: framed photo on a patterned ground ----

export function polaroid(c: Ctx) {
  const { W, H, k, wide, tall } = c;
  const sf = c.main;
  const side = !tall;
  const cardW = wide ? 760 : side ? 520 : 760;
  const photoH = wide ? 620 : side ? 500 : c.story ? 780 : 560;
  const border = k.shape === "round" ? 22 : 26;
  const cardH = photoH + border + (side ? 110 : 130);
  const cx = side ? (k.flip ? W - cardW - 70 : 70) : (W - cardW) / 2;
  const cy = side ? (H - cardH) / 2 : c.story ? 170 : 80;
  const tilt = (c.s.tilt || 2) * (k.flip ? -1 : 1) * 0.6;
  const tx = side ? (k.flip ? 70 : cardW + 140) : 80;
  const tw = side ? W - cardW - 210 : W - 160;
  const ty = side ? 0 : cy + cardH + 30;
  const th = side ? H : H - ty - 60;
  const radius = k.shape === "round" ? 18 : 2;
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={sf.hi} opacity={0.18} scale={1.2} />
      <Abs x={cx} y={cy} w={cardW} h={cardH} style={{ flexDirection: "column", alignItems: "center", background: WHITE, borderRadius: radius, padding: border, paddingBottom: 0, transform: `rotate(${tilt}deg)`, boxShadow: "0 24px 60px rgba(0,0,0,0.30)" }}>
        <Box style={{ position: "relative", width: cardW - border * 2, height: photoH, overflow: "hidden", borderRadius: radius }}>
          <Picture c={c} x={0} y={0} w={cardW - border * 2} h={photoH} shape="rect" />
        </Box>
        <Box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 14, fontSize: 30, fontWeight: 800, color: "#1A1A1A" }}>
          <Box style={{ width: 14, height: 14, borderRadius: 9999, background: c.surfaces.paper.hi }} />
          {name(c)}
        </Box>
      </Abs>
      {k.accent === "frame" && <Abs x={cx - 24} y={cy - 24} w={cardW + 48} h={cardH + 48} style={{ border: `${Math.max(2, c.s.stroke)}px solid ${sf.hi}`, borderRadius: radius + 10, transform: `rotate(${-tilt}deg)` }} />}
      <Frame c={c} x={30} y={30} w={W - 60} h={H - 60} color={sf.hi} />
      <Abs x={tx} y={ty} w={tw} h={th} style={{ flexDirection: "column", justifyContent: "center" }}>
        <Stack c={c} sf={sf} w={tw} headH={side ? (wide ? 420 : 400) : c.story ? 380 : 230} headMax={side ? 80 : 84} center={k.center && !side} subMax={32} />
      </Abs>
    </Root>
  );
}

// ---- circle: round or arched crop beside large type ----

export function circle(c: Ctx) {
  const { W, H, k, wide, tall } = c;
  const sf = c.main;
  const d = wide ? 760 : tall ? (c.story ? 860 : 640) : 520;
  const arch = k.shape === "arch";
  const cw = arch ? Math.round(d * 0.82) : d;
  const ch = d;
  const x = wide ? (k.flip ? W - cw - 120 : 120) : k.center ? (W - cw) / 2 : k.flip ? 70 : W - cw - 70;
  const y = wide ? (H - ch) / 2 : c.story ? 200 : 64;
  const ring = Math.max(3, c.s.stroke);
  const tx = wide ? (k.flip ? 100 : cw + 240) : 80;
  const tw = wide ? W - cw - 340 : W - 160;
  const ty = wide ? 0 : y + ch + 30;
  const th = wide ? H : H - ty - 50;
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={sf.hi} opacity={0.12} />
      <Abs x={x + 26} y={y - 26} w={cw} h={ch} style={{ border: `${ring}px solid ${sf.hi}`, borderRadius: arch ? `${cw / 2}px ${cw / 2}px 0 0` : 9999 }} />
      <Picture c={c} x={x} y={y} w={cw} h={ch} shape={arch ? "arch" : "circle"} />
      {!!chipOf(c) && c.s.chip === "circle" && (
        <Abs x={wide ? x + cw - 200 : x + cw - 230} y={y + ch - 230}>
          <Badge c={c} sf={sf} size={230} text={chipOf(c)} />
        </Abs>
      )}
      <Abs x={tx} y={ty} w={tw} h={th} style={{ flexDirection: "column", justifyContent: wide ? "center" : "flex-start", gap: 26 }}>
        {wide && <BrandLine c={c} sf={sf} size={60} />}
        <Stack c={c} sf={sf} w={tw} headH={wide ? 380 : c.story ? 400 : tall ? 240 : 170} headMax={wide ? 92 : 76} center={k.center && !wide} chip={c.s.chip !== "circle"} subMax={32} />
      </Abs>
      {!wide && (
        <Abs x={0} y={k.center ? H - 100 : 50} w={W} h={60} style={{ justifyContent: k.center ? "center" : k.flip ? "flex-end" : "flex-start", paddingLeft: 60, paddingRight: 60 }}>
          <BrandLine c={c} sf={sf} size={50} />
        </Abs>
      )}
    </Root>
  );
}

// ---- diagonal: a slanted band across photo or colour ----

export function diagonal(c: Ctx) {
  const { W, H, k, wide } = c;
  const band = c.main;
  const ground = c.photo ? c.surfaces.night : band === c.surfaces.night ? c.surfaces.brand : c.surfaces.night;
  const bandH = wide ? 780 : c.story ? 980 : c.tall ? 800 : 700;
  const bandY = wide ? (H - bandH) / 2 + 60 : H - bandH - (c.story ? 200 : 30);
  const slope = wide ? 120 : 110;
  // Satori has no calc(): the polygon is in px.
  const pts = k.flip ? [[0, 0], [W, slope], [W, bandH], [0, bandH - slope]] : [[0, slope], [W, 0], [W, bandH - slope], [0, bandH]];
  const clip = `polygon(${pts.map(([px, py]) => `${px}px ${py}px`).join(", ")})`;
  const pad = wide ? 160 : 80;
  const textW = wide ? 1100 : W - pad * 2;
  const chip = chipOf(c);
  const badge = !!chip && (c.s.chip === "circle" || c.s.chip === "stamp");
  return (
    <Root c={c} sf={ground}>
      {c.photo ? <Picture c={c} x={0} y={0} w={W} h={H} shape="rect" /> : <Pattern c={c} x={0} y={0} w={W} h={H} color={ground.hi} opacity={0.2} scale={1.3} />}
      <Abs x={0} y={bandY + 26} w={W} h={bandH} style={{ background: band.hi, clipPath: clip, opacity: 0.9 }} />
      <Abs x={0} y={bandY} w={W} h={bandH} style={{ background: background(band), clipPath: clip, flexDirection: "column", justifyContent: "center", paddingLeft: pad, paddingRight: pad }}>
        <Stack c={c} sf={band} w={textW} headH={wide ? 230 : c.story ? 400 : c.tall ? 280 : 220} headMax={wide ? 100 : 92} chip={!badge} />
      </Abs>
      <Abs x={44} y={44}>
        <BrandPill c={c} />
      </Abs>
      {badge && (
        <Abs x={k.flip ? 60 : W - 300} y={wide ? 70 : bandY - 190}>
          <Badge c={c} sf={band} size={250} text={chip} />
        </Abs>
      )}
    </Root>
  );
}

// ---- magazine: masthead, cover photo, cover lines ----

export function magazine(c: Ctx) {
  const { W, H, k, wide } = c;
  const strip = c.main;
  const mastH = wide ? 190 : c.story ? 300 : 230;
  const title = name(c);
  const mastW = W - 120;
  const textW = wide ? 1000 : W - 140;
  const chip = chipOf(c);
  const white = { ...c.surfaces.night, fg: WHITE, muted: "rgba(255,255,255,0.86)", hi: WHITE, onHi: "#0B0B0F" };
  return (
    <Root c={c} sf={c.surfaces.night}>
      <Picture c={c} x={0} y={0} w={W} h={H} shape="rect" />
      <Scrim x={0} y={Math.round(H * 0.38)} w={W} h={Math.round(H * 0.62)} from="bottom" strength={0.86} />
      <Abs x={0} y={0} w={W} h={mastH} style={{ background: background(strip), alignItems: "center", justifyContent: k.center ? "center" : "flex-start", paddingLeft: 60, paddingRight: 60, borderBottom: `${Math.max(3, c.s.stroke)}px solid ${strip.hi}` }}>
        <Head c={c} text={title} w={mastW} h={mastH - 40} max={wide ? 150 : 180} min={56} color={strip.fg} center={k.center} />
      </Abs>
      {!!chip && (
        <Abs x={k.flip ? 50 : W - 290} y={mastH + 40}>
          <Badge c={c} sf={strip} size={240} text={chip} />
        </Abs>
      )}
      <Frame c={c} x={30} y={mastH + 30} w={W - 60} h={H - mastH - 60} color={WHITE} />
      <Abs x={70} y={mastH} w={textW} h={H - mastH - 70} style={{ flexDirection: "column", justifyContent: "flex-end" }}>
        <Stack c={c} sf={white} w={textW} headH={wide ? 330 : c.story ? 460 : c.tall ? 330 : 250} headMax={wide ? 100 : 96} chip={false} />
      </Abs>
    </Root>
  );
}
