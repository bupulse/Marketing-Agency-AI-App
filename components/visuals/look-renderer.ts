// Draws one frame of a video that has a look (lib/visuals/video-looks.ts): scene layouts, transitions, caption styles,
// backdrop motifs and the outro. Used by video-renderer.ts drawFrame, so the owner's browser and the video robot draw
// the same frames. Plain 2D canvas calls only (no roundRect or filters, which older browsers lack).
import { STYLES } from "@/lib/designs/library/styles";
import { captionAt, kenBurns, layersAt, sceneStarts, transitionAt, wordsShown, wrapText } from "@/lib/visuals/timeline";
import type { VideoPlan, VideoScene } from "@/lib/visuals/types";
import { captionPaint, hashString, lookColors, priceIn, sceneLayout, type LookColors, type VideoLayout, type VideoLook, type VideoMotif } from "@/lib/visuals/video-looks";

type Img = CanvasImageSource & { width: number; height: number };
type Rect = { x: number; y: number; w: number; h: number };

const MARGIN = 80;
const FRAME_TOP = 220;

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

function drawPhoto(ctx: CanvasRenderingContext2D, img: Img, scene: VideoScene, progress: number, rect: Rect, zoom: number) {
  const r = kenBurns(scene.motion, progress, img, { width: rect.w, height: rect.h }, zoom);
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, rect.x, rect.y, rect.w, rect.h);
}

/** A tasteful brand pattern at low opacity, drawn in `color` over `rect`. Static: the same every frame. */
export function drawMotif(ctx: CanvasRenderingContext2D, motif: VideoMotif, color: string, rect: Rect, alpha = 0.14) {
  const { x, y, w, h } = rect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  switch (motif) {
    case "dots":
      for (let yy = y + 40; yy < y + h; yy += 72) for (let xx = x + 40; xx < x + w; xx += 72) {
        ctx.moveTo(xx + 7, yy);
        ctx.arc(xx, yy, 7, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    case "stripes":
      ctx.lineWidth = 22;
      for (let d = -h; d < w; d += 90) {
        ctx.moveTo(x + d, y + h);
        ctx.lineTo(x + d + h, y);
      }
      ctx.stroke();
      break;
    case "rings":
      ctx.lineWidth = 4;
      for (let r = 120; r < Math.max(w, h); r += 90) {
        ctx.moveTo(x + w * 0.82 + r, y + h * 0.2);
        ctx.arc(x + w * 0.82, y + h * 0.2, r, 0, Math.PI * 2);
      }
      ctx.stroke();
      break;
    case "waves":
      ctx.lineWidth = 8;
      for (let yy = y + 60; yy < y + h; yy += 130) {
        ctx.moveTo(x, yy);
        for (let xx = x; xx < x + w; xx += 120) {
          ctx.quadraticCurveTo(xx + 30, yy - 28, xx + 60, yy);
          ctx.quadraticCurveTo(xx + 90, yy + 28, xx + 120, yy);
        }
      }
      ctx.stroke();
      break;
    case "grid":
      ctx.lineWidth = 2;
      for (let xx = x; xx <= x + w; xx += 90) {
        ctx.moveTo(xx, y);
        ctx.lineTo(xx, y + h);
      }
      for (let yy = y; yy <= y + h; yy += 90) {
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy);
      }
      ctx.stroke();
      break;
    case "sunburst": {
      const cx = x + w / 2;
      const cy = y + h * 1.02;
      const rays = 24;
      for (let i = 0; i < rays; i += 2) {
        const a1 = Math.PI + (i / rays) * Math.PI;
        const a2 = Math.PI + ((i + 1) / rays) * Math.PI;
        const r = Math.max(w, h) * 1.4;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
        ctx.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
        ctx.closePath();
      }
      ctx.fill();
      break;
    }
    case "zigzag":
      ctx.lineWidth = 7;
      for (let yy = y + 60; yy < y + h; yy += 110) {
        ctx.moveTo(x, yy);
        for (let xx = x; xx < x + w; xx += 60) {
          ctx.lineTo(xx + 30, yy - 26);
          ctx.lineTo(xx + 60, yy);
        }
      }
      ctx.stroke();
      break;
    case "confetti":
      for (let i = 0; i < 46; i++) {
        const hx = hashString(`c${i}`);
        const px = x + (hx % 1000) / 1000 * w;
        const py = y + ((hx >>> 10) % 1000) / 1000 * h;
        if (i % 2) ctx.rect(px, py, 22, 10);
        else {
          ctx.moveTo(px + 9, py);
          ctx.arc(px, py, 9, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      break;
    case "leaves":
      for (let i = 0; i < 16; i++) {
        const hx = hashString(`l${i}`);
        const px = x + (hx % 1000) / 1000 * w;
        const py = y + ((hx >>> 10) % 1000) / 1000 * h;
        ctx.moveTo(px + 60, py);
        ctx.ellipse(px, py, 60, 24, ((hx >>> 20) % 314) / 100, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    case "plus":
      ctx.lineWidth = 5;
      for (let yy = y + 60; yy < y + h; yy += 120) for (let xx = x + 60; xx < x + w; xx += 120) {
        ctx.moveTo(xx - 14, yy);
        ctx.lineTo(xx + 14, yy);
        ctx.moveTo(xx, yy - 14);
        ctx.lineTo(xx, yy + 14);
      }
      ctx.stroke();
      break;
    case "checker":
      for (let yy = y, row = 0; yy < y + h; yy += 120, row++) for (let xx = x + (row % 2) * 120; xx < x + w; xx += 240) ctx.rect(xx, yy, 120, 120);
      ctx.fill();
      break;
    case "triangles":
      for (let yy = y + 100, row = 0; yy < y + h; yy += 160, row++) for (let xx = x + (row % 2) * 80; xx < x + w; xx += 160) {
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx + 40, yy - 70);
        ctx.lineTo(xx + 80, yy);
        ctx.closePath();
      }
      ctx.fill();
      break;
    case "marks":
      // Woven-cloth marks: bands of short dashes and dots, generic rather than any one tradition's symbols.
      for (let yy = y + 50, row = 0; yy < y + h; yy += 90, row++) for (let xx = x + 30; xx < x + w; xx += 70) {
        if (row % 2) ctx.rect(xx, yy - 4, 36, 8);
        else {
          ctx.moveTo(xx + 25, yy);
          ctx.arc(xx + 18, yy, 7, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      break;
    case "lines":
      ctx.lineWidth = 2;
      for (let yy = y + h * 0.12; yy < y + h; yy += h * 0.19) {
        ctx.moveTo(x + MARGIN, yy);
        ctx.lineTo(x + w - MARGIN, yy);
      }
      ctx.stroke();
      break;
    case "blobs":
      ctx.globalAlpha *= 1.4;
      ctx.moveTo(x + w * 0.85 + w * 0.42, y + h * 0.12);
      ctx.arc(x + w * 0.85, y + h * 0.12, w * 0.42, 0, Math.PI * 2);
      ctx.moveTo(x + w * 0.05 + w * 0.3, y + h * 0.88);
      ctx.arc(x + w * 0.05, y + h * 0.88, w * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

function backdrop(ctx: CanvasRenderingContext2D, look: VideoLook, c: LookColors, rect: Rect) {
  ctx.fillStyle = c.background;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  drawMotif(ctx, look.motif, c.accent, rect, c.accent === c.onBackground ? 0.1 : 0.16);
}

function scrim(ctx: CanvasRenderingContext2D, W: number, H: number, position: VideoLook["caption"]["position"]) {
  const top = position === "top";
  const g = top ? ctx.createLinearGradient(0, 0, 0, H * 0.5) : ctx.createLinearGradient(0, H * (position === "middle" ? 0.25 : 0.45), 0, H);
  if (top) {
    g.addColorStop(0, "rgba(0,0,0,0.65)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.5);
  } else {
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(position === "middle" ? 0.4 : 1, "rgba(0,0,0,0.62)");
    if (position === "middle") g.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = g;
    const from = H * (position === "middle" ? 0.25 : 0.45);
    ctx.fillRect(0, from, W, H - from);
  }
}

/** The scene's picture layer: photo or backdrop, panels and frames. Drawn under the transition transform. */
function drawSceneBase(ctx: CanvasRenderingContext2D, plan: VideoPlan, look: VideoLook, c: LookColors, scene: VideoScene, layout: VideoLayout, img: Img | undefined, progress: number, logo: Img | undefined) {
  const W = plan.width;
  const H = plan.height;
  const full = { x: 0, y: 0, w: W, h: H };
  const zoom = look.motion.zoom;
  const tokens = STYLES[look.style];
  switch (layout) {
    case "lower-third":
    case "price":
    case "card":
      if (img) drawPhoto(ctx, img, scene, progress, full, zoom);
      else backdrop(ctx, look, c, full);
      if (img && captionPaint(look, layout, plan.colors, true).scrim) scrim(ctx, W, H, layout === "price" ? "middle" : look.caption.position);
      return;
    case "kinetic":
    case "steps":
      backdrop(ctx, look, c, full);
      if (img) {
        // The photo shows through a veil of the background colour, so the big words stay readable.
        drawPhoto(ctx, img, scene, progress, full, zoom);
        ctx.save();
        ctx.globalAlpha *= 0.86;
        ctx.fillStyle = c.background;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        drawMotif(ctx, look.motif, c.accent, full, 0.12);
      }
      return;
    case "framed": {
      backdrop(ctx, look, c, full);
      const frame = { x: MARGIN, y: FRAME_TOP, w: W - MARGIN * 2, h: Math.round(H * 0.56) };
      ctx.fillStyle = c.accent;
      ctx.fillRect(frame.x - 12, frame.y - 12, frame.w + 24, frame.h + 24);
      if (img) drawPhoto(ctx, img, scene, progress, frame, zoom);
      else {
        ctx.fillStyle = c.paper;
        ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
        drawMotif(ctx, look.motif, c.accent, frame, 0.3);
      }
      return;
    }
    case "split": {
      const seam = Math.round(H * 0.58);
      const top = { x: 0, y: 0, w: W, h: seam };
      if (img) drawPhoto(ctx, img, scene, progress, top, zoom);
      else {
        ctx.fillStyle = c.accent;
        ctx.fillRect(0, 0, W, seam);
        drawMotif(ctx, look.motif, c.onAccent, top, 0.18);
      }
      backdrop(ctx, look, c, { x: 0, y: seam, w: W, h: H - seam });
      ctx.fillStyle = c.accent;
      ctx.fillRect(0, seam - 6, W, 12);
      return;
    }
    case "quote":
      backdrop(ctx, look, c, full);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(W / 2, H * 0.24, 190, 0, Math.PI * 2);
        ctx.clip();
        drawPhoto(ctx, img, scene, progress, { x: W / 2 - 190, y: H * 0.24 - 190, w: 380, h: 380 }, zoom);
        ctx.restore();
      }
      return;
    case "outro": {
      backdrop(ctx, look, c, full);
      const cx = W / 2;
      const cy = H * 0.36;
      const r = 140;
      ctx.fillStyle = logo ? "#FFFFFF" : c.accent;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      if (logo && logo.width > 0 && logo.height > 0) {
        const s = Math.min((r * 1.4) / logo.width, (r * 1.4) / logo.height);
        ctx.drawImage(logo, 0, 0, logo.width, logo.height, cx - (logo.width * s) / 2, cy - (logo.height * s) / 2, logo.width * s, logo.height * s);
      } else {
        const font = tokens.video;
        ctx.font = `${font.weight} 150px ${font.css}`;
        ctx.fillStyle = c.onAccent;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText([...plan.businessName.trim()][0]?.toUpperCase() ?? "", cx, cy + 6);
      }
      const font = tokens.video;
      ctx.font = `${font.weight} 64px ${font.css}`;
      ctx.fillStyle = c.onBackground;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const name = font.upper ? plan.businessName.toUpperCase() : plan.businessName;
      wrapText(name, W - MARGIN * 2, (s) => ctx.measureText(s).width, 2).forEach((line, i) => ctx.fillText(line, cx, cy + r + 50 + i * 76));
      if (plan.contact) {
        ctx.font = `600 40px ${font.css}`;
        ctx.fillText(plan.contact, cx, H * 0.84);
      }
      return;
    }
  }
}

type Area = { centerY: number; width: number; maxLines: number; size: number };

function captionArea(plan: VideoPlan, look: VideoLook, layout: VideoLayout, scene: VideoScene): Area {
  const W = plan.width;
  const H = plan.height;
  const s = look.caption.scale;
  const base = (scene.role === "body" ? 64 : 84) * s;
  switch (layout) {
    case "kinetic":
      return { centerY: H * 0.5, width: W - MARGIN * 2, maxLines: 6, size: 104 * s };
    case "framed":
      return { centerY: FRAME_TOP + H * 0.56 + (H - FRAME_TOP - H * 0.56) / 2, width: W - MARGIN * 2, maxLines: 3, size: Math.min(base, 66) };
    case "split":
      return { centerY: H * 0.58 + (H * 0.42) / 2, width: W - MARGIN * 2, maxLines: 4, size: base };
    case "card":
      return { centerY: H * 0.74, width: W - MARGIN * 2 - 120, maxLines: 4, size: Math.min(base, 62) };
    case "steps":
      return { centerY: H * 0.55, width: W - MARGIN * 2 - 120 - 170, maxLines: 5, size: Math.min(base, 62) };
    case "quote":
      return { centerY: H * 0.58, width: W - MARGIN * 2 - 40, maxLines: 5, size: 70 * s };
    case "price":
      return { centerY: H * 0.68, width: W - MARGIN * 2, maxLines: 3, size: 54 * s };
    case "outro":
      return { centerY: H * 0.66, width: W - MARGIN * 2 - 100, maxLines: 2, size: 56 };
    default: {
      const pos = look.caption.position;
      return { centerY: pos === "top" ? H * 0.22 : pos === "middle" ? H * 0.5 : H * 0.72, width: W - MARGIN * 2, maxLines: 4, size: base };
    }
  }
}

/** The one caption on screen, styled by the look and its scene's layout. */
function drawCaption(ctx: CanvasRenderingContext2D, plan: VideoPlan, look: VideoLook, c: LookColors, images: Map<string, Img>, tMs: number) {
  const caption = captionAt(plan, tMs);
  if (!caption || caption.alpha <= 0) return;
  const scene = plan.scenes[caption.index];
  if (!scene?.text.trim()) return;
  const layout = sceneLayout(look, scene);
  const hasPhoto = !!(scene.photoPath && images.get(scene.photoPath));
  const font = STYLES[look.style].video;
  const upper = look.caption.upper || font.upper;
  const W = plan.width;
  const area = captionArea(plan, look, layout, scene);
  const paint = layout === "outro" ? { text: c.onAccent, box: c.accent, scrim: false } : captionPaint(look, layout, plan.colors, hasPhoto);
  const price = layout === "price" ? priceIn(scene.text) : null;
  const rest = price ? scene.text.replace(price, "").replace(/^[\s,:;.\-–—]+|[\s,:;\-–—]+$/g, "") : scene.text;
  let text = upper ? rest.toUpperCase() : rest;

  ctx.save();
  ctx.globalAlpha = caption.alpha;
  ctx.font = `${font.weight} ${Math.round(area.size)}px ${font.css}`;
  const measure = (s: string) => ctx.measureText(s).width;
  let lines = text.trim() ? wrapText(text, area.width, measure, area.maxLines) : [];
  if (layout === "kinetic") {
    // Words arrive one after another over the first half of the caption.
    const start = sceneStarts(plan)[caption.index];
    const p = (tMs - start) / Math.max(1, scene.durationMs);
    const words = text.trim().split(/\s+/);
    text = words.slice(0, wordsShown(words.length, p)).join(" ");
    const all = lines;
    lines = wrapText(text, area.width, measure, area.maxLines).slice(0, all.length);
  }
  const lineHeight = area.size * 1.18;
  const blockH = lines.length * lineHeight;
  const rise = (1 - caption.rise) * 40;
  const top = area.centerY - blockH / 2 + rise;
  const center = look.caption.align === "center" || layout === "kinetic" || layout === "quote" || layout === "outro" || layout === "price";
  const x = center ? W / 2 : MARGIN + (layout === "card" ? 60 : layout === "steps" ? 230 : 0);
  const widest = Math.max(0, ...lines.map(measure));
  const radius = STYLES[look.style].radius;

  // Boxes and cards behind the text.
  if (layout === "card" || layout === "steps") {
    ctx.fillStyle = paint.box ?? c.paper;
    roundRect(ctx, { x: MARGIN, y: top - 70, w: W - MARGIN * 2, h: blockH + 140 }, radius);
    ctx.fill();
    if (layout === "steps") {
      const n = plan.scenes.slice(0, caption.index).filter((s) => s.role === "body").length + 1;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(MARGIN + 120, top + blockH / 2, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.onAccent;
      ctx.font = `${font.weight} 80px ${font.css}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), MARGIN + 120, top + blockH / 2 + 4);
      ctx.font = `${font.weight} ${Math.round(area.size)}px ${font.css}`;
    }
  } else if (paint.box && lines.length) {
    const pad = 34;
    ctx.fillStyle = paint.box;
    if (look.caption.box === "bar" && layout !== "outro") ctx.fillRect(0, top - pad, W, blockH + pad * 2);
    else {
      const bw = widest + pad * 2.4;
      const bx = center ? W / 2 - bw / 2 : x - pad * 1.2;
      roundRect(ctx, { x: bx, y: top - pad, w: bw, h: blockH + pad * 2 }, look.caption.box === "pill" || layout === "outro" ? 9999 : Math.min(radius, 16));
      ctx.fill();
    }
  }

  if (layout === "quote") {
    ctx.fillStyle = c.accent;
    ctx.font = `${font.weight} 260px ${font.css}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("“", W / 2, top - 250);
    ctx.font = `${font.weight} ${Math.round(area.size)}px ${font.css}`;
  }

  if (price) {
    const size = 150 * look.caption.scale;
    ctx.font = `${font.weight} ${Math.round(size)}px ${font.css}`;
    const pw = Math.min(W - MARGIN * 2, ctx.measureText(price).width + 100);
    const py = plan.height * 0.44 + rise;
    ctx.fillStyle = c.accent;
    roundRect(ctx, { x: W / 2 - pw / 2, y: py - size * 0.7, w: pw, h: size * 1.4 }, Math.min(radius, 24));
    ctx.fill();
    ctx.fillStyle = c.onAccent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(price, W / 2, py + 4, W - MARGIN * 2 - 40);
    ctx.font = `${font.weight} ${Math.round(area.size)}px ${font.css}`;
  }

  // The accent mark above the text.
  if (lines.length && look.caption.accent !== "none" && !paint.box && layout !== "card" && layout !== "steps" && layout !== "outro") {
    ctx.fillStyle = c.accent;
    if (look.caption.accent === "bar") ctx.fillRect(center ? W / 2 - 60 : x, top - 44, 120, 10);
    else {
      ctx.beginPath();
      ctx.arc(center ? W / 2 : x + 12, top - 38, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (paint.scrim) {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
  }
  ctx.fillStyle = paint.text;
  ctx.textAlign = center ? "center" : "left";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineHeight));
  if (look.caption.box === "underline" && lines.length && layout !== "outro") {
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.fillStyle = c.accent;
    const lw = measure(lines[lines.length - 1]);
    ctx.fillRect(center ? W / 2 - lw / 2 : x, top + blockH + 6, lw, 8);
  }
  ctx.restore();
}

/** One frame of a plan with a look. */
export function drawLookFrame(ctx: CanvasRenderingContext2D, plan: VideoPlan, look: VideoLook, images: Map<string, Img>, tMs: number): void {
  const W = plan.width;
  const H = plan.height;
  const c = lookColors(look, plan.colors);
  const logo = plan.logoPath ? images.get(plan.logoPath) : undefined;
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, W, H);

  const layers = layersAt(plan, tMs);
  for (const layer of layers) {
    const scene = plan.scenes[layer.index];
    const layout = sceneLayout(look, scene);
    const img = scene.photoPath ? images.get(scene.photoPath) : undefined;
    const usable = img && img.width > 0 && img.height > 0 ? img : undefined;
    const t = layer.opacity < 1 ? transitionAt(look.transition.kind, layer.opacity, W, H) : null;
    ctx.save();
    ctx.globalAlpha = t ? t.alpha : 1;
    if (t?.clip) {
      ctx.beginPath();
      ctx.rect(t.clip.x, t.clip.y, t.clip.w, t.clip.h);
      ctx.clip();
    }
    if (t && (t.dx || t.dy || t.scale !== 1)) {
      ctx.translate(W / 2 + t.dx, H / 2 + t.dy);
      ctx.scale(t.scale, t.scale);
      ctx.translate(-W / 2, -H / 2);
    }
    drawSceneBase(ctx, plan, look, c, scene, layout, usable, layer.progress, logo);
    ctx.restore();
  }

  drawCaption(ctx, plan, look, c, images, tMs);

  // Business name, small, near the top; the outro shows it large instead.
  const topScene = plan.scenes[layers[layers.length - 1]?.index ?? 0];
  if (plan.businessName && topScene && sceneLayout(look, topScene) !== "outro") {
    const font = STYLES[look.style].video;
    const onPhoto = ["lower-third", "card", "price", "split"].includes(sceneLayout(look, topScene)) && !!(topScene.photoPath && images.get(topScene.photoPath));
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `600 32px ${font.css}`;
    ctx.fillStyle = onPhoto ? "rgba(255,255,255,0.85)" : c.onBackground;
    if (onPhoto) {
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 10;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(plan.businessName, W / 2, sceneLayout(look, topScene) === "framed" ? 120 : 110);
    ctx.restore();
  }
}
