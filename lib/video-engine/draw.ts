// Draws one frame of a motion spec on a 2D canvas (docs/VIDEO_ENGINE.md). Plain canvas calls only, so the owner's
// browser, the Video Lab and the video robot's headless Chrome draw exactly the same pixels. No network, no DOM:
// photos come in already decoded, fonts are loaded by the caller (encode.ts).
//
// A frame: each scene is drawn through its virtual camera (cameraAt): layers move by their depth, so near ones shift
// more than far ones (parallax), with an optional focus pull. Between scenes, a transition. Over everything, the film
// look (colour grade, glow, light leaks, vignette, grain, cinema bars), drawn from an off-screen buffer.
import { cameraAt, clamp01, ease, layerWindow, noise, parallax, poseAt, scenesAt, textEntrance, type ActiveScene, type CameraState } from "./animate";
import { FONTS, canvasSize, type Background, type CharacterLayer, type Layer, type Look, type MotionSpec, type PhotoLayer, type Quality, type Scene, type ShapeLayer, type TextLayer } from "./spec";

export type Img = CanvasImageSource & { width: number; height: number };
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rect = { x: number; y: number; w: number; h: number };
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export type DrawOptions = {
  /** Output quality (the canvas must have that size; default 1080p). */
  quality?: Quality;
  /** Makes the off-screen buffer the film look needs; default OffscreenCanvas. Null: no look (tests, old browsers). */
  makeCanvas?: ((w: number, h: number) => AnyCanvas | null) | null;
};

const buffers = new WeakMap<object, { canvas: AnyCanvas; ctx: Ctx }>();
const defaultCanvas = (w: number, h: number): AnyCanvas | null => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : null);

function bufferFor(owner: object, w: number, h: number, make: (w: number, h: number) => AnyCanvas | null): { canvas: AnyCanvas; ctx: Ctx } | null {
  const have = buffers.get(owner);
  if (have && have.canvas.width === w && have.canvas.height === h) return have;
  const canvas = make(w, h);
  const ctx = canvas?.getContext("2d") as Ctx | null | undefined;
  if (!canvas || !ctx) return null;
  const made = { canvas, ctx };
  buffers.set(owner, made);
  return made;
}

/** Whether the look needs the buffer (a grade or glow); vignette, leaks, grain and bars are drawn on top directly. */
const needsBuffer = (look?: Look) => !!look && ((look.grade && look.grade !== "none") || (look.glow ?? 0) > 0);

/** Draws the frame at `tMs`. `photos` maps the spec's 1-based photo numbers to decoded images. */
export function drawSpecFrame(ctx: Ctx, spec: MotionSpec, photos: Map<number, Img>, tMs: number, opts: DrawOptions = {}): void {
  const { width: W, height: H } = canvasSize(spec, opts.quality ?? "1080p");
  const make = opts.makeCanvas === undefined ? defaultCanvas : opts.makeCanvas;
  const buffer = needsBuffer(spec.look) && make ? bufferFor(ctx, W, H, make) : null;
  const target = buffer ? buffer.ctx : ctx;
  drawScenes(target, spec, photos, tMs, W, H);
  if (buffer) composite(ctx, buffer.canvas, spec.look as Look, W, H);
  drawOverlays(ctx, spec.look, W, H, tMs);
}

function drawScenes(ctx: Ctx, spec: MotionSpec, photos: Map<number, Img>, tMs: number, W: number, H: number): void {
  const { current, previous, transition } = scenesAt(spec, tMs);
  const kind = spec.scenes[current.index].transition ?? "fade";
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.fillStyle = kind === "dip" && previous ? "#000000" : spec.palette.background;
  ctx.fillRect(0, 0, W, H);
  const tf = previous ? transitionTransforms(kind, transition, W, H) : null;
  if (previous && tf) withTransform(ctx, tf.prev, W, H, () => drawScene(ctx, spec, spec.scenes[previous.index], previous, photos, W, H, tMs));
  withTransform(ctx, tf?.cur ?? IDENTITY, W, H, () => drawScene(ctx, spec, spec.scenes[current.index], current, photos, W, H, tMs));
  if (previous && kind === "flash") {
    ctx.globalAlpha = Math.sin(transition * Math.PI) * 0.9;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

type Tf = { dx: number; dy: number; scale: number; rot: number; alpha: number; blur: number; wipe?: number };
const IDENTITY: Tf = { dx: 0, dy: 0, scale: 1, rot: 0, alpha: 1, blur: 0 };

/** How the outgoing (prev) and incoming (cur) scenes are moved during a transition at `t` (0..1). Pure. */
export function transitionTransforms(kind: Scene["transition"], t: number, W: number, H: number): { prev: Tf; cur: Tf } {
  const e = ease("inOut", t);
  const k = Math.min(W, H) / 1080;
  const id = { ...IDENTITY };
  switch (kind) {
    case "cut":
      return { prev: { ...id, alpha: 0 }, cur: id };
    case "slideUp":
      return { prev: { ...id, dy: -e * H * 0.3 }, cur: { ...id, dy: (1 - e) * H } };
    case "slideLeft":
      return { prev: { ...id, dx: -e * W * 0.3 }, cur: { ...id, dx: (1 - e) * W } };
    case "zoom":
      return { prev: id, cur: { ...id, scale: 1.25 - 0.25 * e, alpha: e } };
    case "wipe":
      return { prev: id, cur: { ...id, wipe: e } };
    case "flash":
      return { prev: id, cur: { ...id, alpha: t < 0.5 ? 0 : 1 } };
    case "whip":
      return { prev: { ...id, dx: -e * W, blur: e * 40 * k }, cur: { ...id, dx: (1 - e) * W, blur: (1 - e) * 40 * k } };
    case "blurZoom":
      return { prev: { ...id, scale: 1 + e * 0.6, alpha: 1 - e, blur: e * 30 * k }, cur: { ...id, scale: 0.7 + 0.3 * e, alpha: e, blur: (1 - e) * 30 * k } };
    case "spin":
      return { prev: { ...id, alpha: 1 - e }, cur: { ...id, rot: (1 - e) * -90, scale: 0.5 + 0.5 * ease("back", t), alpha: e } };
    case "dip":
      return { prev: { ...id, alpha: t < 0.5 ? 1 - 2 * t : 0 }, cur: { ...id, alpha: t < 0.5 ? 0 : 2 * t - 1 } };
    case "fade":
    default:
      return { prev: id, cur: { ...id, alpha: e } };
  }
}

function withTransform(ctx: Ctx, tf: Tf, W: number, H: number, draw: () => void): void {
  if (tf.alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha *= tf.alpha;
  if (tf.wipe !== undefined) {
    ctx.beginPath();
    ctx.rect(0, 0, W * tf.wipe, H);
    ctx.clip();
  }
  if (tf.dx || tf.dy) ctx.translate(tf.dx, tf.dy);
  if (tf.scale !== 1 || tf.rot) {
    ctx.translate(W / 2, H / 2);
    if (tf.rot) ctx.rotate((tf.rot * Math.PI) / 180);
    ctx.scale(tf.scale, tf.scale);
    ctx.translate(-W / 2, -H / 2);
  }
  if (tf.blur > 0.5) ctx.filter = `blur(${tf.blur.toFixed(1)}px)`;
  draw();
  ctx.restore();
}

const DEFAULT_DEPTH = { photo: 0.45, text: 0.85, shape: 0.6, character: 0.7 } as const;

function drawScene(ctx: Ctx, spec: MotionSpec, scene: Scene, active: ActiveScene, photos: Map<number, Img>, W: number, H: number, tMs: number): void {
  const cam = cameraAt(scene.camera, active.progress, tMs);
  const k = Math.min(W, H) / 1080;
  const outerFilter = ctx.filter && ctx.filter !== "none" ? ctx.filter : "";
  ctx.save();
  if (cam.roll) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate((cam.roll * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
  }
  // The background is the farthest layer; when the camera moves it is drawn larger so its edges never show.
  ctx.save();
  const bg = parallax(cam, 0);
  const over = cam.moving || cam.zoom !== 1 || cam.dollyZoom ? 1.14 : 1;
  ctx.translate(W / 2 + bg.dx * W, H / 2 + bg.dy * H);
  ctx.scale(bg.scale * over, bg.scale * over);
  ctx.translate(-W / 2, -H / 2);
  ctx.filter = joinFilters(outerFilter, focusBlur(cam, 0, k));
  drawBackground(ctx, scene.background, active.progress, photos, W, H, tMs, k);
  ctx.restore();

  for (const layer of scene.layers) {
    const win = layerWindow(layer, active.progress, scene.seconds, layer.kind === "text" ? (layer.animateFor ?? 0.6) : 0.4);
    if (!win.visible) continue;
    ctx.save();
    const depth = layer.depth ?? DEFAULT_DEPTH[layer.kind];
    const par = parallax(cam, depth);
    const pose = poseAt(layer.keyframes, active.progress);
    const rect = boxOf(layer, W, H);
    // Camera: positions spread out from the centre by the zoom and shift by the pan, both weighted by depth.
    const cx = W / 2 + (rect.x + rect.w / 2 + pose.dx * W - W / 2) * par.scale + par.dx * W;
    const cy = H / 2 + (rect.y + rect.h / 2 + pose.dy * H - H / 2) * par.scale + par.dy * H;
    const ownOpacity = layer.keyframes?.some((f) => f.opacity !== undefined) ? 1 : layer.kind === "text" ? 1 : ease("out", win.enter);
    ctx.globalAlpha *= clamp01(pose.opacity * ownOpacity * win.exit);
    // Text is a graphic on top of the shot, as in real ads: it moves with the camera but always stays sharp.
    ctx.filter = joinFilters(outerFilter, layer.kind === "text" ? "" : focusBlur(cam, depth, k));
    ctx.translate(cx, cy);
    if (pose.rotate) ctx.rotate((pose.rotate * Math.PI) / 180);
    const scale = Math.max(0.0001, pose.scale * par.scale);
    if (scale !== 1) ctx.scale(scale, scale);
    const local: Rect = { x: -rect.w / 2, y: -rect.h / 2, w: rect.w, h: rect.h };
    if (layer.kind === "photo") drawPhoto(ctx, layer, local, photos.get(layer.photo), active.progress, spec);
    else if (layer.kind === "text") drawText(ctx, layer, local, win.enter, W);
    else if (layer.kind === "character") drawCharacter(ctx, layer, local, active.progress, tMs);
    else drawShape(ctx, layer, local, win.enter, W, tMs);
    ctx.restore();
  }
  ctx.restore();
}

/** Blur for a layer at `depth` when the camera has a focus point: the farther from focus, the softer. */
function focusBlur(cam: CameraState, depth: number, k: number): string {
  if (cam.focus === null) return "";
  const px = Math.abs(depth - cam.focus) * 18 * k;
  return px > 0.6 ? `blur(${px.toFixed(1)}px)` : "";
}

const joinFilters = (...parts: string[]) => parts.filter(Boolean).join(" ") || "none";

/** The colour grade of each look, as canvas filters (applied once to the whole frame). */
export const GRADE_FILTERS: Record<string, string> = {
  none: "",
  warm: "sepia(0.22) saturate(1.15) contrast(1.05)",
  cool: "saturate(1.05) contrast(1.06) hue-rotate(-8deg)",
  tealOrange: "contrast(1.12) saturate(1.25)",
  vivid: "saturate(1.4) contrast(1.1)",
  mono: "grayscale(1) contrast(1.18)",
  film: "contrast(1.08) saturate(0.9) sepia(0.12)",
  faded: "contrast(0.86) saturate(0.78) brightness(1.06)",
  night: "brightness(0.82) contrast(1.15) saturate(0.85) hue-rotate(-12deg)",
};

function composite(ctx: Ctx, frame: AnyCanvas, look: Look, W: number, H: number): void {
  const k = Math.min(W, H) / 1080;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = GRADE_FILTERS[look.grade ?? "none"] || "none";
  ctx.drawImage(frame as CanvasImageSource, 0, 0, W, H);
  if ((look.glow ?? 0) > 0) {
    // Bloom: the frame blurred and brightened, added on top.
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = Math.min(1, look.glow ?? 0) * 0.45;
    ctx.filter = `blur(${Math.round(22 * k)}px) brightness(1.15)`;
    ctx.drawImage(frame as CanvasImageSource, 0, 0, W, H);
  }
  ctx.restore();
  if (look.grade === "tealOrange" || look.grade === "cool" || look.grade === "warm") {
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.35;
    const g = ctx.createLinearGradient(0, 0, W, H);
    const [a, b] = look.grade === "tealOrange" ? ["#008b8b", "#ff8c32"] : look.grade === "cool" ? ["#2f6bff", "#7fd4ff"] : ["#ff9a3c", "#ffd27f"];
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/** Vignette, drifting light leaks, grain and cinema bars, on top of everything. */
function drawOverlays(ctx: Ctx, look: Look | undefined, W: number, H: number, tMs: number): void {
  if (!look) return;
  const t = tMs / 1000;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  if ((look.lightLeak ?? 0) > 0) {
    ctx.globalCompositeOperation = "screen";
    const x = W * (0.5 + 0.6 * noise(t * 0.25, 3));
    const y = H * (0.3 + 0.4 * noise(t * 0.2, 7));
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.6);
    g.addColorStop(0, `rgba(255,150,60,${0.45 * Math.min(1, look.lightLeak ?? 0)})`);
    g.addColorStop(0.5, `rgba(255,60,120,${0.18 * Math.min(1, look.lightLeak ?? 0)})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }
  if ((look.vignette ?? 0) > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${0.75 * Math.min(1, look.vignette ?? 0)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if ((look.grain ?? 0) > 0) {
    ctx.globalAlpha = 0.12 * Math.min(1, look.grain ?? 0);
    let seed = Math.floor(tMs / 41) * 9301 + 49297;
    const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const dot = Math.max(1, Math.round(Math.min(W, H) / 540));
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#000000";
      ctx.fillRect(rand() * W, rand() * H, dot, dot);
    }
    ctx.globalAlpha = 1;
  }
  if (look.letterbox) {
    const bar = Math.round(Math.min(W, H) * 0.06);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
  }
  ctx.restore();
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

function drawBackground(ctx: Ctx, bg: Background, progress: number, photos: Map<number, Img>, W: number, H: number, tMs: number, k = 1): void {
  const full: Rect = { x: 0, y: 0, w: W, h: H };
  const img = bg.kind === "photo" && bg.photo ? photos.get(bg.photo) : undefined;
  if (img && img.width > 0) {
    ctx.save();
    const blur = (bg.blur ?? 0) * k;
    if (blur) ctx.filter = joinFilters(ctx.filter && ctx.filter !== "none" ? ctx.filter : "", `blur(${blur.toFixed(1)}px)`);
    const pad = blur ? blur * 2 : 0;
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

// ---- Cartoon presenter ----------------------------------------------------------------------------------------------

/** How open the mouth is at scene progress `p`: 0 closed, up to 1 wide, inside the talk windows only. Pure. */
export function mouthOpen(talk: [number, number][] | undefined, p: number, tMs: number): number {
  if (!talk?.some(([a, b]) => p >= a && p <= b)) return 0;
  const t = tMs / 1000;
  // Syllable-like rhythm: two mixed frequencies, never perfectly regular.
  return Math.max(0, Math.min(1, 0.55 + 0.45 * Math.sin(t * 17) * Math.sin(t * 5.3 + 1)));
}

/** Eyes closed for 120 ms every few seconds, at a deterministic rhythm per character position. */
export function blinking(tMs: number, seed: number): boolean {
  const period = 2800 + (seed % 7) * 230;
  return (tMs + seed * 97) % period < 120;
}

function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 + amount))));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function drawCharacter(ctx: Ctx, c: CharacterLayer, r: Rect, progress: number, tMs: number): void {
  // Built on the box height: head at the top, body below, centred on x = 0.
  const h = r.h;
  const t = tMs / 1000;
  const seed = Math.round((c.x * 1000 + c.y * 100) % 997);
  const bob = Math.sin(t * 2.1 + seed) * h * 0.006;
  const top = r.y + bob;
  const headR = h * 0.13;
  const headY = top + h * 0.2;
  const shoulderY = top + h * 0.42;
  const armW = h * 0.075;
  const side = c.side === "left" ? -1 : 1;
  const skinDark = shade(c.skin, -0.18);

  // Hair behind the head (long, braids, afro).
  ctx.fillStyle = c.hairColor;
  if (c.hair === "afro") {
    ctx.beginPath();
    ctx.arc(0, headY - headR * 0.25, headR * 1.45, 0, Math.PI * 2);
    ctx.fill();
  } else if (c.hair === "long" || c.hair === "braids") {
    const drop = c.hair === "braids" ? h * 0.32 : h * 0.26;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      roundRectPath(ctx, { x: sx * headR * 0.65 - headR * 0.45, y: headY - headR * 0.6, w: headR * 0.9, h: drop }, headR * 0.4);
      ctx.fill();
      if (c.hair === "braids") {
        ctx.strokeStyle = shade(c.hairColor, 0.35);
        ctx.lineWidth = h * 0.004;
        for (let k = 1; k < 7; k++) {
          const yy = headY - headR * 0.6 + (drop / 7) * k;
          ctx.beginPath();
          ctx.moveTo(sx * headR * 0.65 - headR * 0.4, yy);
          ctx.lineTo(sx * headR * 0.65 + headR * 0.4, yy + h * 0.01);
          ctx.stroke();
        }
      }
    }
  }

  // Body: rounded shoulders wider than the waist (waist-up framing), with a collar in the accent colour.
  const shoulderW = h * 0.56;
  const waistW = h * 0.46;
  const bottom = r.y + r.h;
  ctx.fillStyle = c.outfit;
  ctx.beginPath();
  ctx.moveTo(-waistW / 2, bottom);
  ctx.lineTo(-shoulderW / 2, shoulderY + h * 0.09);
  ctx.quadraticCurveTo(-shoulderW / 2, shoulderY, -shoulderW / 2 + h * 0.09, shoulderY);
  ctx.lineTo(shoulderW / 2 - h * 0.09, shoulderY);
  ctx.quadraticCurveTo(shoulderW / 2, shoulderY, shoulderW / 2, shoulderY + h * 0.09);
  ctx.lineTo(waistW / 2, bottom);
  ctx.closePath();
  ctx.fill();
  if (c.accent) {
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(-headR * 0.6, shoulderY + h * 0.004);
    ctx.lineTo(0, shoulderY + h * 0.1);
    ctx.lineTo(headR * 0.6, shoulderY + h * 0.004);
    ctx.closePath();
    ctx.fill();
  }
  // Neck.
  ctx.fillStyle = skinDark;
  ctx.fillRect(-headR * 0.32, headY + headR * 0.7, headR * 0.64, shoulderY - headY - headR * 0.6);

  // Arms: angles (radians from straight down) per pose; the gesture arm moves. Sleeves are a shade darker than the
  // shirt so the arm reads in front of the body.
  const wave = Math.sin(t * 7) * 0.35;
  const poses: Record<string, { left: [number, number]; right: [number, number] }> = {
    stand: { left: [0.18, 0.08], right: [-0.18, -0.08] },
    wave: { left: [0.18, 0.08], right: [-2.6 + wave, -0.5 + wave * 0.5] },
    point: { left: [0.18, 0.08], right: [-1.5, -1.6] },
    present: { left: [0.6, 1.25], right: [-1.25, -1.65] },
    thumbsUp: { left: [0.18, 0.08], right: [-0.45, -2.7] },
    hold: { left: [0.3, 1.5], right: [-0.3, -1.5] },
  };
  const pose = poses[c.pose ?? "stand"] ?? poses.stand;
  const upper = h * 0.18;
  const lower = h * 0.16;
  const sleeve = shade(c.outfit, -0.16);
  const gestures = c.pose === "point" || c.pose === "present" || c.pose === "wave" || c.pose === "thumbsUp";
  const arm = (sx: number, [a1, a2]: [number, number], gesture: boolean) => {
    const flip = side < 0 && gestures ? -1 : 1;
    const sxx = sx * flip;
    const ax = sxx * (shoulderW / 2 - armW * 0.55);
    const ay = shoulderY + armW * 0.7;
    const ex = ax + Math.sin(a1 * flip) * upper;
    const ey = ay + Math.cos(a1) * upper;
    const hx = ex + Math.sin(a2 * flip) * lower;
    const hy = ey + Math.cos(a2) * lower;
    ctx.lineCap = "round";
    ctx.strokeStyle = sleeve;
    ctx.lineWidth = armW;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = c.skin;
    ctx.lineWidth = armW * 0.8;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = c.skin;
    ctx.beginPath();
    ctx.arc(hx, hy, armW * 0.6, 0, Math.PI * 2);
    ctx.fill();
    if (gesture && c.pose === "thumbsUp") {
      roundRectPath(ctx, { x: hx - armW * 0.17, y: hy - armW * 1.25, w: armW * 0.34, h: armW * 0.8 }, armW * 0.17);
      ctx.fill();
    }
    if (gesture && c.pose === "point") {
      const dir = Math.sign(hx - ex) || 1;
      roundRectPath(ctx, { x: dir > 0 ? hx : hx - armW * 0.9, y: hy - armW * 0.15, w: armW * 0.9, h: armW * 0.3 }, armW * 0.15);
      ctx.fill();
    }
  };
  arm(-1, pose.left, false);
  arm(1, pose.right, true);

  // Head and ears.
  ctx.fillStyle = c.skin;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * headR * 0.98, headY + headR * 0.05, headR * 0.16, headR * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, headY, headR * 0.92, headR, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair on top.
  ctx.fillStyle = c.hairColor;
  if (c.hair === "short" || c.hair === "long" || c.hair === "braids") {
    ctx.beginPath();
    ctx.ellipse(0, headY - headR * 0.45, headR * 0.95, headR * 0.62, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  } else if (c.hair === "afro") {
    ctx.beginPath();
    ctx.ellipse(0, headY - headR * 0.55, headR * 1.05, headR * 0.6, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  } else if (c.hair === "bun") {
    ctx.beginPath();
    ctx.ellipse(0, headY - headR * 0.45, headR * 0.95, headR * 0.6, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, headY - headR * 1.2, headR * 0.42, 0, Math.PI * 2);
    ctx.fill();
  } else if (c.hair === "twists") {
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath();
      ctx.arc(k * headR * 0.27, headY - headR * 0.82 + Math.abs(k) * headR * 0.08, headR * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Face: eyes (with blink), brows, cheeks, mouth (talks inside the talk windows).
  const eyeY = headY + headR * 0.05;
  const eyeX = headR * 0.36;
  const closed = blinking(tMs, seed);
  for (const sx of [-1, 1]) {
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.ellipse(sx * eyeX, eyeY, headR * 0.1, closed ? headR * 0.015 : headR * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!closed) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(sx * eyeX + headR * 0.03, eyeY - headR * 0.04, headR * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = shade(c.hairColor, 0.1);
    ctx.lineWidth = headR * 0.06;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx * eyeX - headR * 0.13, eyeY - headR * 0.26);
    ctx.lineTo(sx * eyeX + headR * 0.13, eyeY - headR * 0.28 - (mouthOpen(c.talk, progress, tMs) > 0 ? headR * 0.03 : 0));
    ctx.stroke();
    ctx.fillStyle = "rgba(255,120,120,0.18)";
    ctx.beginPath();
    ctx.arc(sx * headR * 0.55, eyeY + headR * 0.3, headR * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  if (c.glasses) {
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = headR * 0.05;
    for (const sx of [-1, 1]) {
      roundRectPath(ctx, { x: sx * eyeX - headR * 0.22, y: eyeY - headR * 0.18, w: headR * 0.44, h: headR * 0.34 }, headR * 0.08);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-eyeX + headR * 0.22, eyeY - headR * 0.05);
    ctx.lineTo(eyeX - headR * 0.22, eyeY - headR * 0.05);
    ctx.stroke();
  }
  const open = mouthOpen(c.talk, progress, tMs);
  const mouthY = headY + headR * 0.52;
  if (open > 0.05) {
    ctx.fillStyle = "#5a1a1a";
    ctx.beginPath();
    ctx.ellipse(0, mouthY, headR * 0.22, headR * (0.04 + 0.16 * open), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-headR * 0.14, mouthY - headR * (0.04 + 0.16 * open), headR * 0.28, headR * 0.05);
  } else {
    ctx.strokeStyle = "#5a1a1a";
    ctx.lineWidth = headR * 0.06;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, mouthY - headR * 0.14, headR * 0.22, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
}
