// Text-led layout families: price, steps, quote, testimonial, features, poster, banner and minimal. Photos are
// optional (drawn small, in a shape) or not used at all.
import { clampText, fitFontSize, rgba } from "@/lib/designs/layout";
import { FONT_FAMILY } from "@/lib/designs/templates/fonts";
import { Abs, Badge, Box, BrandLine, Chip, chipOf, Frame, Head, Kicker, Logo, Mark, Pattern, Picture, Root, Sub, type Ctx, type Surface } from "../kit";
import { starsUrl } from "../motifs";

const cardShadow = (c: Ctx) => (c.s.shadow === "hard" ? `12px 12px 0 ${rgba("#000000", 0.85)}` : c.s.shadow === "soft" ? "0 18px 50px rgba(0,0,0,0.18)" : undefined);

// ---- price: the price or deal as the hero ----

export function price(c: Ctx) {
  const { W, H, k, wide, tall } = c;
  const sf = c.main;
  const chip = chipOf(c);
  const hasArt = !!c.photo;
  const pw = wide ? 760 : tall ? W - 160 : 420;
  const ph = wide ? 760 : tall ? (c.story ? 760 : 460) : 600;
  const px = wide ? (k.flip ? 100 : W - pw - 100) : tall ? 80 : k.flip ? 60 : W - pw - 60;
  const py = wide ? (H - ph) / 2 : tall ? (c.story ? 260 : 160) : (H - ph) / 2 + 40;
  const tx = wide ? (k.flip ? pw + 200 : 100) : 80;
  const tw = wide ? W - pw - 300 : tall ? W - 160 : hasArt ? W - pw - 180 : W - 160;
  const ty = tall && hasArt ? py + ph + 30 : 150;
  const th = tall && hasArt ? H - ty - 60 : H - 210;
  const priceText = chip || clampText(c.input.headline, 24);
  const priceSize = fitFontSize(priceText, tw - 150, wide ? 200 : 170, { maxSize: wide ? 170 : 150, minSize: 44, lineHeight: 1, charWidth: c.s.font.charWidth * (c.s.font.upper ? 1.08 : 1), maxLines: 1 });
  const tag = k.shape === "circle" ? "circle" : k.shape === "round" ? "round" : "rect";
  const priceBlock =
    tag === "circle" ? (
      <Badge c={c} sf={sf} size={Math.min(tw, wide ? 380 : 330)} text={priceText} />
    ) : (
      <Box style={{ alignItems: "center", gap: 18, padding: tag === "round" ? "22px 44px 22px 30px" : "18px 36px", background: sf.hi, color: sf.onHi, borderRadius: tag === "round" ? 9999 : 0, boxShadow: cardShadow(c), transform: c.s.tilt ? `rotate(${c.s.tilt}deg)` : undefined, marginTop: c.s.tilt ? 12 : 0, marginBottom: c.s.tilt ? 12 : 0 }}>
        {tag === "round" && <Box style={{ width: 26, height: 26, borderRadius: 9999, background: sf.bg }} />}
        <Box style={{ maxWidth: tw - 150, fontFamily: c.family, fontSize: priceSize, lineHeight: 1, fontWeight: c.s.font.weight, textTransform: c.s.font.upper ? "uppercase" : undefined }}>{priceText}</Box>
      </Box>
    );
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={sf.hi} opacity={0.14} />
      {hasArt && <Picture c={c} x={px} y={py} w={pw} h={ph} shape={tag === "circle" ? "round" : tag === "round" ? "arch" : "rect"} />}
      <Abs x={60} y={50}>
        <BrandLine c={c} sf={sf} size={56} />
      </Abs>
      <Abs x={tx} y={ty} w={tw} h={th} style={{ flexDirection: "column", justifyContent: "center", gap: 26, alignItems: k.center && !hasArt ? "center" : "flex-start" }}>
        <Kicker c={c} sf={sf} center={k.center && !hasArt} />
        {priceBlock}
        {!!chip && <Head c={c} text={c.input.headline} w={tw} h={wide ? 260 : tall ? 240 : 220} max={wide ? 80 : 70} min={36} color={sf.fg} center={k.center && !hasArt} />}
        <Sub c={c} text={c.input.subline} w={tw} color={sf.muted} max={32} center={k.center && !hasArt} lines={2} />
      </Abs>
    </Root>
  );
}

// ---- steps: a numbered step or tip ----

export function steps(c: Ctx) {
  const { W, H, k, wide } = c;
  const sf = c.main;
  const n = c.input.step && c.input.step > 0 ? String(c.input.step).padStart(2, "0") : "";
  const disc = wide ? 300 : 230;
  const pad = wide ? 140 : 80;
  const textW = wide ? W - pad * 2 - disc - 100 : W - pad * 2;
  const center = k.center && !wide;
  const numberShape = k.shape === "circle" ? { borderRadius: 9999 } : k.shape === "round" ? { borderRadius: Math.max(28, c.s.radius) } : { borderRadius: 0 };
  const badge = (
    <Box style={{ width: disc, height: disc, alignItems: "center", justifyContent: "center", background: sf.hi, color: sf.onHi, boxShadow: cardShadow(c), flexShrink: 0, ...numberShape }}>
      {n ? (
        <Box style={{ fontFamily: c.family, fontSize: Math.round(disc * 0.5), fontWeight: c.s.font.weight, lineHeight: 1 }}>{n}</Box>
      ) : (
        <Box style={{ width: disc * 0.42, height: disc * 0.22, borderLeft: `${Math.round(disc * 0.07)}px solid ${sf.onHi}`, borderBottom: `${Math.round(disc * 0.07)}px solid ${sf.onHi}`, transform: "rotate(-45deg)", marginTop: -disc * 0.08 }} />
      )}
    </Box>
  );
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={k.flip ? 0 : W / 2} y={0} w={W / 2} h={H} color={sf.hi} opacity={0.16} />
      <Frame c={c} x={36} y={36} w={W - 72} h={H - 72} color={sf.hi} />
      <Abs x={pad} y={0} w={W - pad * 2} h={H} style={{ flexDirection: wide ? (k.flip ? "row-reverse" : "row") : "column", alignItems: wide ? "center" : center ? "center" : "flex-start", justifyContent: "center", gap: wide ? 100 : 50 }}>
        {badge}
        <Box style={{ flexDirection: "column", gap: 24, width: textW, alignItems: center ? "center" : "flex-start" }}>
          <Kicker c={c} sf={sf} center={center} />
          <Head c={c} text={c.input.headline} w={textW} h={wide ? 360 : c.story ? 520 : c.tall ? 380 : 290} max={wide ? 90 : 88} color={sf.fg} center={center} />
          <Mark c={c} sf={sf} center={center} />
          <Sub c={c} text={c.input.subline} w={textW} color={sf.muted} max={36} center={center} lines={4} />
        </Box>
      </Abs>
      <Abs x={0} y={H - 110} w={W} h={70} style={{ justifyContent: "center" }}>
        <BrandLine c={c} sf={sf} size={48} />
      </Abs>
    </Root>
  );
}

// ---- quote: a saying in large type ----

export function quote(c: Ctx) {
  const { W, H, k, wide } = c;
  const sf = c.main;
  const pad = wide ? 180 : 100;
  const textW = W - pad * 2;
  const center = k.center;
  const author = c.input.subline?.trim() ? clampText(c.input.subline, 60) : "";
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={sf.hi} opacity={0.12} scale={1.2} />
      {k.accent === "bar" && <Abs x={k.flip ? W - 28 : 0} y={0} w={28} h={H} style={{ background: sf.hi }} />}
      <Frame c={c} x={44} y={44} w={W - 88} h={H - 88} color={sf.hi} />
      <Abs x={pad} y={0} w={textW} h={H} style={{ flexDirection: "column", justifyContent: "center", alignItems: center ? "center" : "flex-start", gap: 30 }}>
        <Box style={{ fontFamily: c.family, fontSize: 240, lineHeight: 0.8, height: 120, fontWeight: c.s.font.weight, color: sf.hi }}>{"“"}</Box>
        <Head c={c} text={c.input.headline} w={textW} h={wide ? 520 : c.story ? 900 : c.tall ? 640 : 480} max={wide ? 92 : 90} min={38} color={sf.fg} center={center} />
        {k.accent === "underline" && <Mark c={c} sf={sf} center={center} />}
        {!!author && <Box style={{ fontFamily: FONT_FAMILY, fontSize: 34, fontWeight: 500, color: sf.muted }}>{`— ${author}`}</Box>}
      </Abs>
      <Abs x={0} y={H - 120} w={W} h={70} style={{ justifyContent: center ? "center" : "flex-start", paddingLeft: center ? 0 : pad }}>
        <BrandLine c={c} sf={sf} size={48} />
      </Abs>
    </Root>
  );
}

// ---- testimonial: stars, words, who said it ----

export function testimonial(c: Ctx) {
  const { W, H, k, wide } = c;
  const outer = c.main;
  const card: Surface = outer === c.surfaces.paper ? c.surfaces.tint : c.surfaces.paper;
  const cw = wide ? 1300 : W - 140;
  const pad = wide ? 90 : 64;
  const textW = cw - pad * 2;
  const center = k.center;
  const author = c.input.subline?.trim() ? clampText(c.input.subline, 50) : "";
  const portrait = 120;
  return (
    <Root c={c} sf={outer}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={outer.hi} opacity={0.14} />
      <Abs x={(W - cw) / 2} y={0} w={cw} h={H} style={{ flexDirection: "column", justifyContent: "center", gap: 36 }}>
        <Box style={{ flexDirection: "column", gap: 30, padding: pad, background: card.bg, borderRadius: Math.max(c.s.radius, 8), boxShadow: cardShadow(c), alignItems: center ? "center" : "flex-start", border: k.accent === "frame" ? `${Math.max(2, c.s.stroke)}px solid ${card.hi}` : undefined }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image, not a DOM <img> */}
          <img src={starsUrl(44, c.s.metal ?? card.hi)} width={246} height={44} />
          <Head c={c} text={c.input.headline} w={textW} h={wide ? 360 : c.story ? 640 : c.tall ? 460 : 330} max={wide ? 72 : 70} min={34} color={card.fg} center={center} />
          {k.accent === "bar" && <Mark c={c} sf={card} center={center} />}
          <Box style={{ alignItems: "center", gap: 22 }}>
            {c.photo ? (
              <Box style={{ position: "relative", width: portrait, height: portrait, overflow: "hidden", borderRadius: k.shape === "circle" ? 9999 : 24 }}>
                <Picture c={c} x={0} y={0} w={portrait} h={portrait} shape="rect" />
              </Box>
            ) : (
              <Logo c={c} size={portrait * 0.7} />
            )}
            {!!author && <Box style={{ fontFamily: FONT_FAMILY, fontSize: 34, fontWeight: 800, color: card.fg }}>{author}</Box>}
          </Box>
        </Box>
        <Box style={{ justifyContent: center ? "center" : "flex-start" }}>
          <BrandLine c={c} sf={outer} size={50} />
        </Box>
      </Abs>
    </Root>
  );
}

// ---- features: a headline and up to four short features as tiles ----

/** The subline's parts ("Fast · Free delivery · 2-year warranty"), at most four, each short. */
export function featureItems(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const parts = text.split(/\s*(?:[·•|;\n]|,\s|\s[-–—]\s)\s*/).map((p) => p.trim()).filter((p) => p.length >= 2);
  return (parts.length >= 2 ? parts : [text.trim()]).slice(0, 4).map((p) => clampText(p, 44));
}

export function features(c: Ctx) {
  const { W, H, k, wide, tall } = c;
  const sf = c.main;
  const items = featureItems(c.input.subline);
  const tile = c.surfaces[sf === c.surfaces.paper ? "tint" : "paper"];
  const pad = wide ? 100 : 70;
  const photoH = c.photo ? (wide ? H : tall ? (c.story ? 640 : 420) : 0) : 0;
  const photoW = c.photo && wide ? 640 : 0;
  const areaX = wide && c.photo ? (k.flip ? pad : photoW + pad) : pad;
  const areaW = W - pad * 2 - (wide && c.photo ? photoW : 0);
  const cols = items.length >= 3 && (wide || !tall) ? 2 : items.length >= 2 && wide ? 2 : 1;
  const gap = 22;
  const tileW = Math.floor((areaW - gap * (cols - 1)) / cols);
  const center = k.center;
  const iconShape = k.shape === "circle" ? 9999 : k.shape === "round" ? 14 : 0;
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={sf.hi} opacity={0.1} />
      {!!c.photo && <Picture c={c} x={wide ? (k.flip ? W - photoW : 0) : 0} y={0} w={wide ? photoW : W} h={wide ? H : photoH} shape="rect" />}
      <Abs x={areaX} y={wide ? 0 : photoH} w={areaW} h={H - (wide ? 0 : photoH)} style={{ flexDirection: "column", justifyContent: "center", gap: 30 }}>
        {!c.photo && <BrandLine c={c} sf={sf} size={52} center={center} />}
        <Kicker c={c} sf={sf} center={center} />
        <Head c={c} text={c.input.headline} w={areaW} h={wide ? 260 : c.story && !c.photo ? 360 : 200} max={wide ? 84 : 78} color={sf.fg} center={center} />
        <Box style={{ flexWrap: "wrap", gap, width: areaW, justifyContent: center ? "center" : "flex-start" }}>
          {items.map((item, i) => (
            <Box key={i} style={{ width: tileW, alignItems: "center", gap: 20, padding: "22px 26px", background: tile.bg, borderRadius: Math.min(c.s.radius, 28), boxShadow: c.s.shadow === "hard" ? `6px 6px 0 ${rgba("#000000", 0.8)}` : undefined }}>
              <Box style={{ width: 46, height: 46, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: iconShape, background: tile.hi, color: tile.onHi, fontFamily: FONT_FAMILY, fontSize: 24, fontWeight: 800 }}>{k.accent === "dot" || k.accent === "none" ? String(i + 1) : ""}</Box>
              <Box style={{ width: tileW - 120, fontFamily: FONT_FAMILY, fontSize: fitFontSize(item, tileW - 120, 80, { maxSize: 32, minSize: 22, lineHeight: 1.2, weight: "regular", maxLines: 2 }), lineHeight: 1.2, fontWeight: 800, color: tile.fg }}>{item}</Box>
            </Box>
          ))}
        </Box>
        <Chip c={c} sf={sf} center={center} maxW={areaW} />
      </Abs>
    </Root>
  );
}

// ---- poster: event poster with a big date block ----

export function poster(c: Ctx) {
  const { W, H, k, wide, tall } = c;
  const sf = c.main;
  const chip = chipOf(c);
  const words = chip.split(/\s+/).filter(Boolean).slice(0, 4);
  const center = k.center && !wide;
  const pad = wide ? 110 : 80;
  const photo = !!c.photo;
  const ph = photo ? (wide ? H - 160 : c.story ? 760 : tall ? 520 : 400) : 0;
  const pw = photo ? (wide ? 640 : W - pad * 2) : 0;
  const textX = wide && photo ? (k.flip ? pad : pw + pad * 2) : pad;
  const textW = wide && photo ? W - pw - pad * 3 : W - pad * 2;
  const dateW = wide ? 300 : 260;
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={sf.hi} opacity={0.15} scale={1.3} />
      <Frame c={c} x={28} y={28} w={W - 56} h={H - 56} color={sf.hi} />
      {photo && <Picture c={c} x={wide ? (k.flip ? W - pw - pad : pad) : pad} y={wide ? 80 : 70} w={pw} h={ph} shape={k.shape} />}
      <Abs x={textX} y={wide ? 0 : photo ? ph + 100 : 0} w={textW} h={wide ? H : photo ? H - ph - 100 : H} style={{ flexDirection: "column", justifyContent: "center", alignItems: center ? "center" : "flex-start", gap: 26 }}>
        <Kicker c={c} sf={sf} center={center} />
        <Box style={{ alignItems: "center", gap: 36, flexDirection: center ? "column" : "row" }}>
          {!!words.length && (
            <Box style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", width: dateW, padding: "18px 10px", background: sf.hi, color: sf.onHi, borderRadius: Math.min(c.s.radius, 24), flexShrink: 0, boxShadow: cardShadow(c) }}>
              {words.map((w, i) => (
                <Box key={i} style={{ fontFamily: c.family, fontWeight: c.s.font.weight, lineHeight: 1.05, textTransform: "uppercase", fontSize: fitFontSize(w, dateW - 40, i === 1 ? 110 : 60, { maxSize: i === 1 && words.length > 1 ? 104 : 54, minSize: 24, lineHeight: 1, charWidth: c.s.font.charWidth * 1.08 }) }}>
                  {w}
                </Box>
              ))}
            </Box>
          )}
          <Head c={c} text={c.input.headline} w={center || !words.length ? textW : textW - dateW - 36} h={wide ? 400 : c.story && !photo ? 600 : photo ? 260 : 380} max={wide ? 104 : 100} color={sf.fg} center={center} />
        </Box>
        <Mark c={c} sf={sf} center={center} />
        <Sub c={c} text={c.input.subline} w={textW} color={sf.muted} max={36} center={center} lines={2} />
        <Box style={{ width: textW, borderTop: `3px dashed ${sf.line}`, paddingTop: 22, justifyContent: center ? "center" : "flex-start" }}>
          <BrandLine c={c} sf={sf} size={46} />
        </Box>
      </Abs>
    </Root>
  );
}

// ---- banner: a loud message on the brand colours ----

export function banner(c: Ctx) {
  const { W, H, k, wide, tall } = c;
  const sf = c.main;
  const photo = !!c.photo;
  const ph = photo ? (wide ? 0 : tall ? (c.story ? 700 : 500) : 380) : 0;
  const pw = photo && wide ? 700 : 0;
  const center = k.center;
  const pad = wide ? 110 : 80;
  const tx = wide && photo ? (k.flip ? pad : pw + pad) : pad;
  const tw = W - pad * 2 - pw;
  const ribbonText = c.kicker ? clampText(c.kicker, 28) : "";
  const tilt = c.s.tilt || -3;
  const ribbon = ribbonText ? (
    <Box style={{ justifyContent: center ? "center" : "flex-start" }}>
      <Box style={{ padding: "14px 40px", background: sf.hi, color: sf.onHi, fontFamily: c.family, fontWeight: c.s.font.weight, fontSize: 40, textTransform: "uppercase", letterSpacing: 2, transform: `rotate(${tilt}deg)`, boxShadow: c.s.shadow === "hard" ? `8px 8px 0 ${rgba("#000000", 0.85)}` : undefined }}>{ribbonText}</Box>
    </Box>
  ) : null;
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={sf.fg} opacity={0.09} scale={1.6} />
      {photo && <Picture c={c} x={wide ? (k.flip ? W - pw : 0) : 0} y={0} w={wide ? pw : W} h={wide ? H : ph} shape={k.shape === "slant" ? "slant" : "rect"} />}
      <Abs x={tx} y={ph} w={tw} h={H - ph - 100} style={{ flexDirection: "column", justifyContent: "center", alignItems: center ? "center" : "flex-start", gap: 30 }}>
        {ribbon}
        <Head c={c} text={c.input.headline} w={tw} h={wide ? 460 : c.story && !photo ? 760 : photo ? (c.story ? 420 : 260) : c.tall ? 520 : 400} max={wide ? 130 : 124} color={sf.fg} center={center} />
        <Mark c={c} sf={sf} center={center} />
        <Sub c={c} text={c.input.subline} w={tw} color={sf.muted} max={38} center={center} lines={2} />
        <Chip c={c} sf={sf} center={center} maxW={tw} size={42} />
      </Abs>
      <Abs x={0} y={H - 100} w={W} h={60} style={{ justifyContent: center ? "center" : "flex-end", paddingRight: center ? 0 : 60 }}>
        <BrandLine c={c} sf={sf} size={44} />
      </Abs>
    </Root>
  );
}

// ---- minimal: quiet type, one accent, space ----

export function minimal(c: Ctx) {
  const { W, H, k, wide } = c;
  const sf = c.main;
  const pad = wide ? 160 : 110;
  const center = k.center;
  const photo = !!c.photo;
  const ps = wide ? 520 : c.story ? 560 : 360;
  const textW = wide ? (photo ? W - pad * 2 - ps - 120 : 1100) : W - pad * 2;
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={H - 260} w={W} h={260} color={sf.hi} opacity={0.18} />
      <Abs x={pad} y={pad * 0.7} w={W - pad * 2} h={60} style={{ justifyContent: center ? "center" : "space-between", alignItems: "center" }}>
        <Box style={{ fontFamily: FONT_FAMILY, fontSize: 26, fontWeight: 500, letterSpacing: 5, textTransform: "uppercase", color: sf.muted }}>{clampText(c.input.businessName, 30)}</Box>
        {!center && <Box style={{ width: 18, height: 18, borderRadius: 9999, background: c.s.metal ?? sf.hi }} />}
      </Abs>
      {photo && <Picture c={c} x={wide ? (k.flip ? pad : W - pad - ps) : k.flip ? pad : W - pad - ps} y={wide ? (H - ps) / 2 : c.story ? 300 : 220} w={ps} h={ps} shape={k.shape} />}
      <Abs x={wide && photo && k.flip ? pad + ps + 120 : pad} y={wide ? 0 : photo ? (c.story ? 300 : 220) + ps : 0} w={textW} h={wide ? H : photo ? H - (c.story ? 300 : 220) - ps - 60 : H} style={{ flexDirection: "column", justifyContent: "center", alignItems: center ? "center" : "flex-start", gap: 30 }}>
        <Mark c={c} sf={sf} center={center} />
        <Head c={c} text={c.input.headline} w={textW} h={wide ? 360 : c.story ? 520 : 360} max={wide ? 76 : 70} min={36} color={sf.fg} center={center} />
        <Sub c={c} text={c.input.subline} w={Math.min(textW, 820)} color={sf.muted} max={32} center={center} />
        {!!chipOf(c) && <Box style={{ fontFamily: FONT_FAMILY, fontSize: 30, fontWeight: 800, color: sf.hi, borderBottom: `2px solid ${sf.hi}`, paddingBottom: 6 }}>{chipOf(c)}</Box>}
      </Abs>
      {k.accent === "bar" && <Abs x={0} y={H - 14} w={W} h={14} style={{ background: c.s.metal ?? sf.hi }} />}
    </Root>
  );
}

// ---- spotlight: the product in a large frame with its features called out ----

export function spotlight(c: Ctx) {
  const { W, H, k, wide, tall } = c;
  const sf = c.main;
  const items = featureItems(c.input.subline);
  const callouts = items.length >= 2 ? items.slice(0, 3) : [];
  const tile = c.surfaces[sf === c.surfaces.paper ? "tint" : "paper"];
  const d = wide ? 700 : c.story ? 760 : tall ? 600 : 480;
  const shape = k.shape === "rect" ? "round" : k.shape;
  const px = wide ? (k.flip ? W - d - 150 : 150) : (W - d) / 2;
  const py = wide ? (H - d) / 2 : c.story ? 230 : 100;
  const chip = chipOf(c);
  const tx = wide ? (k.flip ? 120 : d + 300) : 80;
  const tw = wide ? W - d - 420 : W - 160;
  const center = !wide;
  const pills = callouts.length ? (
    <Box style={{ flexDirection: wide ? "column" : "row", flexWrap: "wrap", gap: 14, justifyContent: center ? "center" : "flex-start", width: tw }}>
      {callouts.map((item, i) => (
        <Box key={i} style={{ alignItems: "center", gap: 12, padding: "12px 22px", borderRadius: 9999, background: tile.bg, color: tile.fg, boxShadow: cardShadow(c), fontFamily: FONT_FAMILY, fontSize: 28, fontWeight: 800 }}>
          <Box style={{ width: 14, height: 14, borderRadius: 9999, background: tile.hi }} />
          {item}
        </Box>
      ))}
    </Box>
  ) : null;
  return (
    <Root c={c} sf={sf}>
      <Pattern c={c} x={0} y={0} w={W} h={H} color={sf.hi} opacity={0.12} />
      <Abs x={px - 50} y={py - 50} w={d + 100} h={d + 100} style={{ borderRadius: shape === "circle" ? 9999 : shape === "arch" ? `${(d + 100) / 2}px ${(d + 100) / 2}px 40px 40px` : 60, background: rgba(sf.hi, 0.18) }} />
      <Picture c={c} x={px} y={py} w={d} h={d} shape={shape} />
      {!!chip && (
        <Abs x={px + d - 170} y={py - 40}>
          <Badge c={c} sf={sf} size={210} text={chip} />
        </Abs>
      )}
      <Abs x={tx} y={wide ? 0 : py + d + 40} w={tw} h={wide ? H : H - py - d - 140} style={{ flexDirection: "column", justifyContent: wide ? "center" : "flex-start", alignItems: center ? "center" : "flex-start", gap: 24 }}>
        <Kicker c={c} sf={sf} center={center} />
        <Head c={c} text={c.input.headline} w={tw} h={wide ? 300 : c.story ? 300 : tall ? 220 : 150} max={wide ? 88 : 80} min={36} color={sf.fg} center={center} />
        {pills ?? <Sub c={c} text={c.input.subline} w={tw} color={sf.muted} max={32} center={center} lines={2} />}
      </Abs>
      <Abs x={0} y={H - 100} w={W} h={60} style={{ justifyContent: wide ? (k.flip ? "flex-start" : "flex-end") : "center", paddingLeft: 60, paddingRight: 60 }}>
        <BrandLine c={c} sf={sf} size={44} />
      </Abs>
    </Root>
  );
}
