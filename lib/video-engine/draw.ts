// Draws one frame of a motion spec on a 2D canvas (docs/VIDEO_ENGINE.md). Plain canvas calls only, so the owner's
// browser, the Video Lab and the video robot's headless Chrome draw exactly the same pixels. No network, no DOM:
// photos come in already decoded, fonts are loaded by the caller (fonts.ts).
import { clamp01, ease, layerWindow, poseAt, scenesAt, textEntrance, type ActiveScene } from "./animate";
import { FONTS, canvasSize, type Background, type Layer, type MotionSpec, type PhotoLayer, type Scene, type ShapeLayer, type TextLayer } from "./spec";

export type Img = CanvasImageSource & { width: number; height: number };
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rect = { x: number; y: number; w: number; h: number };

/** Draws the frame at `tMs`. `photos` maps the spec's 1-based photo numbers to decoded images. */
export function drawSpecFrame(ctx: Ctx, spec: MotionSpec, photos: Map<number, Img>, tMs: number): void {
  const { width: W, height: H } = canvasSize(spec);
  const { current, previous, transition } = scenesAt(spec, tMs);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = spec.palette.background;
  ctx.fillRect(0, 0, W, H);
  if (previous) drawScene(ctx, spec, spec.scenes[previous.index], previous, photos, W, H, tMs);
  const kind = spec.scenes[current.index].transition ?? "fade";
  ctx.save();
  if (previous) applyTransition(ctx, kind, transition, W, H);
  drawScene(ctx, spec, spec.scenes[current.index], current, photos, W, H, tMs);
  ctx.restore();
  if (previous && kind === "flash") {
    ctx.globalAlpha = Math.sin(transition * Math.PI) * 0.9;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function applyTransition(ctx: Ctx, kind: Scene["transition"], t: number, W: number, H: number): void {
  const e = ease("inOut", t);
  switch (kind) {
    case "slideUp":
      ctx.translate(0, (1 - e) * H);
      break;
    case "slideLeft":
      ctx.translate((1 - e) * W, 0);
      break;
    case "zoom":
      ctx.globalAlpha = e;
      ctx.translate(W / 2, H / 2);
      ctx.scale(1.25 - 0.25 * e, 1.25 - 0.25 * e);
      ctx.translate(-W / 2, -H / 2);
      break;
    case "wipe":
      ctx.beginPath();
      ctx.rect(0, 0, W * e, H);
      ctx.clip();
      break;
    case "flash":
      ctx.globalAlpha = t < 0.5 ? 0 : 1;
      break;
    case "fade":
    default:
      ctx.globalAlpha = e;
  }
}

function drawScene(ctx: Ctx, spec: MotionSpec, scene: Scene, active: ActiveScene, photos: Map<number, Img>, W: number, H: number, tMs: number): void {
  drawBackground(ctx, scene.background, active.progress, photos, W, H, tMs);
  for (const layer of scene.layers) {
    const win = layerWindow(layer, active.progress, scene.seconds, layer.kind === "text" ? (layer.animateFor ?? 0.6) : 0.4);
    if (!win.visible) continue;
    ctx.save();
    const pose = poseAt(layer.keyframes, active.progress);
    const rect = boxOf(layer, W, H);
    const cx = rect.x + rect.w / 2 + pose.dx * W;
    const cy = rect.y + rect.h / 2 + pose.dy * H;
    const ownOpacity = layer.keyframes?.some((k) => k.opacity !== undefined) ? 1 : layer.kind === "text" ? 1 : ease("out", win.enter);
    ctx.globalAlpha *= clamp01(pose.opacity * ownOpacity * win.exit);
    ctx.translate(cx, cy);
    if (pose.rotate) ctx.rotate((pose.rotate * Math.PI) / 180);
    if (pose.scale !== 1) ctx.scale(Math.max(0.0001, pose.scale), Math.max(0.0001, pose.scale));
    const local: Rect = { x: -rect.w / 2, y: -rect.h / 2, w: rect.w, h: rect.h };
    if (layer.kind === "photo") drawPhoto(ctx, layer, local, photos.get(layer.photo), active.progress, spec);
    else if (layer.kind === "text") drawText(ctx, layer, local, win.enter, W);
    else drawShape(ctx, layer, local, win.enter, W, tMs);
    ctx.restore();
  }
}

const boxOf = (l: Layer, W: number, H: number): Rect => ({ x: (l.x - l.w / 2) * W, y: (l.y - l.h / 2) * H, w: l.w * W, h: l.h * H });

function roundRectPath(ctx: Ctx, r: Rect, radius: number): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

/** Source rectangle that covers (or fits) `dest` with the image, zoomed `zoom` towards the focus point. */
export function coverRect(img: { width: number; height: number }, dest: { w: number; h: number }, zoom = 1, focusX = 0.5, focusY = 0.5): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(dest.w / img.width, dest.h / img.height) * zoom;
  const sw = Math.min(img.width, dest.w / scale);
  const sh = Math.min(img.height, dest.h / scale);
  const sx = Math.min(img.width - sw, Math.max(0, focusX * img.width - sw / 2));
  const sy = Math.min(img.height - sh, Math.max(0, focusY * img.height - sh / 2));
  return { sx, sy, sw, sh };
}

function drawImageInto(ctx: Ctx, img: Img, r: Rect, fit: "cover" | "contain", zoom: number, fx: number, fy: number): void {
  if (fit === "contain") {
    const s = Math.min(r.w / img.width, r.h / img.height) * zoom;
    const w = img.width * s;
    const h = img.height * s;
    ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
    return;
  }
  const c = coverRect(img, r, zoom, fx, fy);
  ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, r.x, r.y, r.w, r.h);
}

function drawBackground(ctx: Ctx, bg: Background, progress: number, photos: Map<number, Img>, W: number, H: number, tMs: number): void {
  const full: Rect = { x: 0, y: 0, w: W, h: H };
  const img = bg.kind === "photo" && bg.photo ? photos.get(bg.photo) : undefined;
  if (img && img.width > 0) {
    ctx.save();
    if (bg.blur) ctx.filter = `blur(${bg.blur}px)`;
    const pad = bg.blur ? bg.blur * 2 : 0;
    drawImageInto(ctx, img, { x: -pad, y: -pad, w: W + pad * 2, h: H + pad * 2 }, "cover", 1 + 0.08 * progress, 0.5, 0.5);
    ctx.restore();
    if (bg.dim) {
      ctx.fillStyle = `rgba(0,0,0,${bg.dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  } else if (bg.kind === "gradient" && bg.colors.length >= 2) {
    const a = (((bg.angle ?? 0) + 90) * Math.PI) / 180;
    const dx = (Math.cos(a) * W) / 2;
    const dy = (Math.sin(a) * H) / 2;
    const g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    bg.colors.forEach((c, i) => g.addColorStop(i / (bg.colors.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = bg.colors[0];
    ctx.fillRect(full.x, full.y, full.w, full.h);
  }
  drawTexture(ctx, bg.texture, W, H, tMs);
}

function drawTexture(ctx: Ctx, texture: Background["texture"], W: number, H: number, tMs: number): void {
  if (!texture || texture === "none") return;
  ctx.save();
  if (texture === "dots") {
    ctx.globalAlpha *= 0.12;
    ctx.fillStyle = "#ffffff";
    const step = W / 14;
    const drift = ((tMs / 1000) * step * 0.25) % step;
    for (let y = -step; y < H + step; y += step) for (let x = 0; x < W + step; x += step) {
      ctx.beginPath();
      ctx.arc(x - drift, y + drift, step * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (texture === "lines") {
    ctx.globalAlpha *= 0.08;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = W * 0.004;
    const step = W / 10;
    const drift = ((tMs / 1000) * step * 0.2) % step;
    for (let x = -H; x < W + H; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + drift, 0);
      ctx.lineTo(x + drift + H, H);
      ctx.stroke();
    }
  } else if (texture === "grain") {
    // Deterministic grain: the same frame always gets the same noise, so a re-render is identical.
    ctx.globalAlpha *= 0.07;
    let seed = Math.floor(tMs / 66) * 9301 + 49297;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#000000";
      ctx.fillRect(rand() * W, rand() * H, 3, 3);
    }
  }
  ctx.restore();
}

function drawPhoto(ctx: Ctx, layer: PhotoLayer, r: Rect, img: Img | undefined, progress: number, spec: MotionSpec): void {
  const radius = (layer.radius ?? 0) * Math.min(r.w, r.h);
  if (layer.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = Math.min(r.w, r.h) * 0.08;
    ctx.shadowOffsetY = Math.min(r.w, r.h) * 0.03;
    ctx.fillStyle = layer.fit === "contain" ? "rgba(0,0,0,0)" : spec.palette.primary;
    roundRectPath(ctx, r, radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  roundRectPath(ctx, r, radius);
  ctx.clip();
  if (img && img.width > 0) {
    const zoom = 1 + ((layer.zoomTo ?? 1) - 1) * ease("inOut", progress);
    drawImageInto(ctx, img, r, layer.fit ?? "cover", zoom, layer.focusX ?? 0.5, layer.focusY ?? 0.5);
  } else {
    ctx.fillStyle = spec.palette.primary;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();
  if (layer.border) {
    ctx.save();
    ctx.strokeStyle = layer.border;
    ctx.lineWidth = Math.max(4, Math.min(r.w, r.h) * 0.015);
    roundRectPath(ctx, r, radius);
    ctx.stroke();
    ctx.restore();
  }
}

type Word = { text: string; width: number; color: string; line: number; x: number; index: number };

/** Lays out words in lines no wider than `maxWidth` (a word longer than the line gets its own line). Pure. */
export function layoutWords(words: string[], measure: (s: string) => number, maxWidth: number, space: number): { lines: { words: number[]; width: number }[]; widths: number[] } {
  const widths = words.map(measure);
  const lines: { words: number[]; width: number }[] = [];
  let cur: number[] = [];
  let curW = 0;
  words.forEach((_, i) => {
    const add = cur.length ? space + widths[i] : widths[i];
    if (cur.length && curW + add > maxWidth) {
      lines.push({ words: cur, width: curW });
      cur = [i];
      curW = widths[i];
    } else {
      cur.push(i);
      curW += add;
    }
  });
  if (cur.length) lines.push({ words: cur, width: curW });
  return { lines, widths };
}

function drawText(ctx: Ctx, layer: TextLayer, r: Rect, enter: number, W: number): void {
  const font = FONTS[layer.font];
  const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  let px = layer.size * W;
  const lineH = () => px * (layer.lineHeight ?? 1.12);
  const setFont = () => (ctx.font = `${layer.weight ?? font.weights[font.weights.length - 1]} ${Math.round(px)}px "${font.family}", "Inter", sans-serif`);
  setFont();
  const words = text.split(" ").filter(Boolean);
  // Shrink to fit the box: never overflow the canvas because a word was long or the text longer than planned.
  let layout = layoutWords(words, (s) => ctx.measureText(s).width, r.w, ctx.measureText(" ").width);
  for (let i = 0; i < 12 && (layout.lines.length * lineH() > Math.max(r.h, px * 1.2) * 1.6 || Math.max(...layout.widths) > r.w); i++) {
    px *= 0.9;
    setFont();
    layout = layoutWords(words, (s) => ctx.measureText(s).width, r.w, ctx.measureText(" ").width);
  }
  const space = ctx.measureText(" ").width;
  const hl = new Set((layer.highlight?.words ?? []).map((w) => w.toLowerCase()));
  const placed: Word[] = [];
  layout.lines.forEach((line, li) => {
    const align = layer.align ?? "center";
    let x = align === "left" ? r.x : align === "right" ? r.x + r.w - line.width : r.x + (r.w - line.width) / 2;
    for (const wi of line.words) {
      const bare = words[wi].toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      placed.push({ text: words[wi], width: layout.widths[wi], color: hl.has(bare) || hl.has(words[wi].toLowerCase()) ? (layer.highlight?.color ?? layer.color) : layer.color, line: li, x, index: wi });
      x += layout.widths[wi] + space;
    }
  });
  const blockH = layout.lines.length * lineH();
  const top = r.y + (r.h - blockH) / 2;
  const anim = layer.animate ?? "fade";
  const whole = textEntrance(anim, enter);

  ctx.save();
  ctx.translate(whole.dx * W, whole.dy * W);
  if (whole.scale !== 1) {
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(whole.scale, whole.scale);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  }
  ctx.globalAlpha *= whole.opacity;
  if (whole.blur > 0.5) ctx.filter = `blur(${whole.blur.toFixed(1)}px)`;

  if (layer.box) {
    const pad = (layer.box.padding ?? 0.025) * W;
    const widest = Math.max(...layout.lines.map((l) => l.width));
    const align = layer.align ?? "center";
    const bx = align === "left" ? r.x : align === "right" ? r.x + r.w - widest : r.x + (r.w - widest) / 2;
    const boxRect = { x: bx - pad, y: top - pad * 0.6, w: widest + pad * 2, h: blockH + pad * 1.2 };
    ctx.save();
    ctx.fillStyle = layer.box.color;
    roundRectPath(ctx, boxRect, (layer.box.radius ?? 0.2) * Math.min(boxRect.w, boxRect.h));
    ctx.fill();
    ctx.restore();
  }
  if (layer.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = px * 0.25;
    ctx.shadowOffsetY = px * 0.06;
  }
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const total = placed.length;
  const chars = text.length;
  let shownChars = anim === "typewriter" ? Math.floor(enter * chars + 0.0001) : Infinity;
  for (const w of placed) {
    const y = top + w.line * lineH() + lineH() / 2;
    ctx.fillStyle = w.color;
    if (anim === "words" || anim === "wordsPop") {
      // Each word gets its own slice of the entrance.
      const slice = clamp01(enter * (total + 1) - w.index);
      if (slice <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= ease("out", slice);
      if (anim === "wordsPop") {
        const s = 0.5 + 0.5 * ease("back", slice);
        ctx.translate(w.x + w.width / 2, y);
        ctx.scale(s, s);
        ctx.fillText(w.text, -w.width / 2, 0);
      } else {
        ctx.fillText(w.text, w.x, y + (1 - ease("out", slice)) * px * 0.3);
      }
      ctx.restore();
    } else if (anim === "typewriter") {
      if (shownChars <= 0) break;
      const part = w.text.slice(0, shownChars);
      ctx.fillText(part, w.x, y);
      shownChars -= w.text.length + 1;
    } else {
      ctx.fillText(w.text, w.x, y);
    }
  }
  ctx.restore();
}

function drawShape(ctx: Ctx, layer: ShapeLayer, r: Rect, enter: number, W: number, tMs: number): void {
  const progress = layer.draw ? ease("inOut", enter) : 1;
  const stroke = (layer.stroke ?? 0.008) * W;
  ctx.fillStyle = layer.color;
  ctx.strokeStyle = layer.color;
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  switch (layer.shape) {
    case "circle":
      ctx.beginPath();
      ctx.ellipse(0, 0, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "ring":
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(1, r.w / 2 - stroke / 2), Math.max(1, r.h / 2 - stroke / 2), 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
      break;
    case "line":
      ctx.beginPath();
      ctx.moveTo(r.x, 0);
      ctx.lineTo(r.x + r.w * progress, 0);
      ctx.lineWidth = Math.max(stroke, r.h);
      ctx.stroke();
      break;
    case "burst": {
      const points = 14;
      const spin = (tMs / 1000) * 0.4;
      ctx.beginPath();
      for (let i = 0; i <= points * 2; i++) {
        const a = spin + (i / (points * 2)) * Math.PI * 2;
        const rr = i % 2 === 0 ? 1 : 0.78;
        const px = Math.cos(a) * (r.w / 2) * rr;
        const py = Math.sin(a) * (r.h / 2) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "blob": {
      const t = tMs / 1000;
      ctx.beginPath();
      const n = 64;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const wobble = 1 + 0.06 * Math.sin(a * 3 + t * 1.3) + 0.04 * Math.sin(a * 5 - t * 0.9);
        const px = Math.cos(a) * (r.w / 2) * wobble;
        const py = Math.sin(a) * (r.h / 2) * wobble;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "arrow": {
      const len = r.w * progress;
      ctx.lineWidth = Math.max(stroke, r.h * 0.18);
      ctx.beginPath();
      ctx.moveTo(r.x, 0);
      ctx.lineTo(r.x + len, 0);
      ctx.stroke();
      if (progress > 0.85) {
        const head = r.h / 2;
        ctx.beginPath();
        ctx.moveTo(r.x + len, 0);
        ctx.lineTo(r.x + len - head, -head);
        ctx.moveTo(r.x + len, 0);
        ctx.lineTo(r.x + len - head, head);
        ctx.stroke();
      }
      break;
    }
    case "rect":
    default:
      roundRectPath(ctx, { x: r.x, y: r.y, w: r.w * (layer.draw ? progress : 1), h: r.h }, (layer.radius ?? 0) * Math.min(r.w, r.h));
      ctx.fill();
  }
}
