// The "3D look" of the canvas renderer (docs/VIDEO_ENGINE.md, "3D look"): extruded letters, photos on a turntable with
// a reflective floor, particles, glass and metal surfaces, and the key light's highlights and shadows. Plain 2D canvas
// calls only (no WebGL), so the owner's browser and the video robot's headless Chrome draw the same pixels; every
// value comes from the frame time (animate.ts), so a re-render of a frame is identical. Used by draw.ts.
import { clamp01, ease, extrusion, extrusionSteps, fogAmount, particleAt, spinAngle, turntableAt, turntableColumn, type CameraState, type LightState } from "./animate";
import type { Material, MotionSpec, ParticlesLayer, PhotoLayer, Text3d } from "./spec";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rect = { x: number; y: number; w: number; h: number };
type Img = CanvasImageSource & { width: number; height: number };

/** What a layer knows about its scene: canvas size, camera, key light and where the layer sits on the canvas. */
export type Env = {
  W: number;
  H: number;
  /** Scale of the canvas to 1080p. */
  k: number;
  tMs: number;
  cam: CameraState;
  light: LightState;
  /** The light in pixels, and the unit vector from the layer's centre towards it. */
  lightPx: { x: number; y: number };
  toLight: { x: number; y: number };
  /** The layer's centre on the canvas, and the scene's vanishing point, in pixels. */
  centre: { x: number; y: number };
  vp: { x: number; y: number };
  palette: MotionSpec["palette"];
  /** A canvas-sized scratch buffer (reflections are drawn there and faded before landing), or null when none. */
  scratch: () => { canvas: CanvasImageSource; ctx: Ctx } | null;
};

// ---- Colour helpers ---------------------------------------------------------------------------------------------------

/** [r, g, b, a] of a hex or rgb(a) colour (the only forms validate.ts lets through); grey when unreadable. */
export function rgba(c: string): [number, number, number, number] {
  const s = c.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(",").map((x) => Number(x.trim()));
    return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] === undefined || Number.isNaN(p[3]) ? 1 : p[3]];
  }
  return [128, 128, 128, 1];
}

/** `a` mixed towards `b` by `t` (0..1), as rgba(); `alpha` overrides the opacity. */
export function mix(a: string, b: string, t: number, alpha?: number): string {
  const x = rgba(a);
  const y = rgba(b);
  const u = clamp01(t);
  const ch = (i: number) => Math.round(x[i] + (y[i] - x[i]) * u);
  const al = alpha ?? x[3] + (y[3] - x[3]) * u;
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${Math.round(clamp01(al) * 1000) / 1000})`;
}

/** Relative brightness 0 (black) .. 1 (white). */
export const luminance = (c: string) => {
  const [r, g, b] = rgba(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

// ---- Fog -------------------------------------------------------------------------------------------------------------

/** Canvas filter that fades a layer at `depth` into the fog: lighter and flatter in pale fog, darker in dark fog. */
export function fogFilter(light: LightState, depth: number): string {
  const a = fogAmount(light.fog, depth);
  if (a < 0.02) return "";
  const f = (n: number) => n.toFixed(3);
  return luminance(light.fogColor) > 0.5 ? `contrast(${f(1 - 0.55 * a)}) brightness(${f(1 + 0.3 * a)}) saturate(${f(1 - 0.5 * a)})` : `brightness(${f(1 - 0.6 * a)}) saturate(${f(1 - 0.4 * a)})`;
}

/** The haze of the fog over the background: thicker towards the floor, like air in a deep room. */
export function drawFogHaze(ctx: Ctx, light: LightState, W: number, H: number): void {
  if (light.fog < 0.02) return;
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix(light.fogColor, light.fogColor, 0, 0.12 * light.fog));
  g.addColorStop(0.6, mix(light.fogColor, light.fogColor, 0, 0.3 * light.fog));
  g.addColorStop(1, mix(light.fogColor, light.fogColor, 0, 0.55 * light.fog));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * A soft beam from the key light (only when the scene sets a light): makes the light's position visible. Fainter over a
 * photo background, which was dimmed so text reads on it.
 */
export function drawLightGlow(ctx: Ctx, light: LightState, W: number, H: number, overPhoto = false): void {
  if (!light.set || light.intensity < 0.05) return;
  const k = overPhoto ? 0.35 : 0.75;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const x = light.x * W;
  const y = light.y * H;
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.75);
  g.addColorStop(0, mix(light.color, light.color, 0, 0.32 * k * light.intensity));
  g.addColorStop(0.35, mix(light.color, light.color, 0, 0.1 * k * light.intensity));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---- Materials ---------------------------------------------------------------------------------------------------------

/**
 * The fill of a glass or metal surface over `r` (local pixels), lit from `toLight`. Metal: bright and dark bands across
 * the surface (brushed metal), sliding slowly; glass: a see-through tint, brighter on the lit side.
 */
export function materialFill(ctx: Ctx, material: Material, color: string, r: Rect, env: Pick<Env, "toLight" | "tMs" | "light">): CanvasGradient {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const half = Math.max(r.w, r.h) / 2;
  // From the lit side to the far side; metal leans a little so the bands read as a curved surface.
  const lx = env.toLight.x;
  const ly = env.toLight.y;
  if (material === "metal") {
    const g = ctx.createLinearGradient(cx + lx * half * 0.5 - ly * half * 0.15, cy + ly * half * 0.9, cx - lx * half * 0.5 + ly * half * 0.15, cy - ly * half * 0.9);
    const drift = 0.06 * Math.sin(env.tMs / 900);
    const I = 0.6 + 0.4 * env.light.intensity;
    g.addColorStop(0, mix(color, "#ffffff", 0.75 * I));
    g.addColorStop(clamp01(0.2 + drift), mix(color, "#ffffff", 0.3 * I));
    g.addColorStop(clamp01(0.46 + drift), mix(color, "#000000", 0.4));
    g.addColorStop(clamp01(0.54 + drift), mix(color, "#ffffff", 0.6 * I));
    g.addColorStop(clamp01(0.78 + drift), color);
    g.addColorStop(1, mix(color, "#000000", 0.5));
    return g;
  }
  const g = ctx.createLinearGradient(cx + lx * half, cy + ly * half, cx - lx * half, cy - ly * half);
  g.addColorStop(0, mix(color, "#ffffff", 0.55, 0.34));
  g.addColorStop(0.45, mix(color, "#ffffff", 0.15, 0.2));
  g.addColorStop(1, mix(color, "#000000", 0.1, 0.26));
  return g;
}

/** The finish on the path just filled: glass gets a bright rim and a diagonal sheen, metal a light edge and a dark one. */
export function materialFinish(ctx: Ctx, material: Material, color: string, r: Rect, env: Pick<Env, "toLight" | "k">): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0)";
  const lw = Math.max(1, 2.5 * env.k);
  const g = ctx.createLinearGradient(r.x + r.w / 2 + env.toLight.x * r.w * 0.5, r.y + r.h / 2 + env.toLight.y * r.h * 0.5, r.x + r.w / 2 - env.toLight.x * r.w * 0.5, r.y + r.h / 2 - env.toLight.y * r.h * 0.5);
  if (material === "glass") {
    g.addColorStop(0, "rgba(255,255,255,0.85)");
    g.addColorStop(0.5, "rgba(255,255,255,0.25)");
    g.addColorStop(1, "rgba(255,255,255,0.5)");
  } else {
    g.addColorStop(0, mix(color, "#ffffff", 0.85));
    g.addColorStop(1, mix(color, "#000000", 0.6));
  }
  ctx.strokeStyle = g;
  ctx.lineWidth = lw;
  ctx.stroke();
  if (material === "glass") {
    // A soft diagonal sheen across the panel, inside its outline.
    ctx.clip();
    const s = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    s.addColorStop(0.18, "rgba(255,255,255,0)");
    s.addColorStop(0.3, "rgba(255,255,255,0.22)");
    s.addColorStop(0.42, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

// ---- 3D letters ----------------------------------------------------------------------------------------------------------

/** Everything the letters of one 3D text layer share: built once per frame, then each word is painted with it. */
export type Text3dPaint = { steps: number; back: { dx: number; dy: number }; side: string; bevel: boolean; material: Material | undefined; px: number; spin: number; shadow: boolean };

/** Sets up the extrusion of a 3D text layer at entrance progress `enter`. */
export function text3dPaint(t: Text3d, color: string, px: number, enter: number, shadow: boolean, env: Env): Text3dPaint {
  const spin = t.spin ? spinAngle(enter) : 0;
  const length = (t.depth ?? 0.5) * px * 0.32;
  const back = extrusion(env.centre.x, env.centre.y, env.vp, env.lightPx, length, spin);
  const side = t.side ?? (luminance(color) < 0.2 ? mix(color, "#ffffff", 0.3) : mix(color, "#000000", 0.5));
  return { steps: extrusionSteps(Math.hypot(back.dx, back.dy), env.k), back, side, bevel: t.bevel === true, material: t.material, px, spin, shadow };
}

/**
 * Paints one word in 3D at (x, y) (left, middle): the sides from the back forwards, darker at the back, then a bright
 * rim towards the light (bevel), then the lit face. Uses fillText only, so fonts and per-word animations still work.
 */
export function paintText3d(ctx: Ctx, text: string, x: number, y: number, width: number, color: string, p: Text3dPaint, env: Env): void {
  const n = p.steps;
  ctx.save();
  for (let i = n; i >= 1; i--) {
    const f = i / n;
    if (i === n && p.shadow) {
      // The cast shadow comes from the back of the letters, away from the light.
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = p.px * 0.3;
      ctx.shadowOffsetX = -env.toLight.x * p.px * 0.12;
      ctx.shadowOffsetY = -env.toLight.y * p.px * 0.12;
    } else if (i === n - 1) {
      ctx.shadowColor = "rgba(0,0,0,0)";
    }
    ctx.fillStyle = mix(p.side, "#000000", 0.4 * f);
    ctx.fillText(text, x + p.back.dx * f, y + p.back.dy * f);
  }
  ctx.shadowColor = "rgba(0,0,0,0)";
  if (p.bevel) {
    const o = Math.max(1, p.px * 0.022);
    ctx.fillStyle = mix(color, env.light.color, 0.75);
    ctx.fillText(text, x + env.toLight.x * o, y + env.toLight.y * o);
  }
  // The face: lit on the side facing the light, a little darker away from it (turned faces get darker).
  const r = { x, y: y - p.px * 0.5, w: width, h: p.px };
  if (p.material) {
    // Metal and glass faces have bright bands: a dark outline keeps the letters readable on any background.
    ctx.strokeStyle = mix(p.side, "#000000", 0.55);
    ctx.lineWidth = Math.max(1.5, p.px * 0.04);
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = materialFill(ctx, p.material, color, r, env);
  } else {
    const lx = env.toLight.x;
    const ly = env.toLight.y;
    const cx = x + width / 2;
    const g = ctx.createLinearGradient(cx + lx * p.px * 0.6, y + ly * p.px * 0.6, cx - lx * p.px * 0.6, y - ly * p.px * 0.6);
    const I = env.light.intensity * (1 - 0.5 * Math.sin(p.spin));
    g.addColorStop(0, mix(color, env.light.color, 0.5 * I));
    g.addColorStop(0.5, color);
    g.addColorStop(1, mix(color, "#000000", 0.18 + 0.3 * Math.sin(p.spin)));
    ctx.fillStyle = g;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---- Turntable -----------------------------------------------------------------------------------------------------------

const COLUMNS = 24;

/**
 * The size of a turntable's picture in its box (`r` in pixels) and its centre (from the box's top): contained, leaving
 * the lower part of the box for the floor and reflection, and small enough that its near edge (taller in perspective at
 * the widest swing, and while it floats up) never leaves the box, so text placed outside the box is never covered. Pure.
 */
export function turntableFit(r: { w: number; h: number }, imgW: number, imgH: number, angleDeg: number): { w: number; h: number; centre: number } {
  const grow = turntableColumn(0, (angleDeg * Math.PI) / 180).scale;
  const fit = Math.min((r.w * 0.98) / imgW, (r.h * 0.76) / imgH) / grow;
  const h = imgH * fit;
  // Its tallest edge (h * grow) fits between the top of the box and the floor, with room for the float (2.5%).
  return { w: imgW * fit, h, centre: (h * grow) / 2 + r.h * 0.03 };
}
const BANDS = 6;

/**
 * A photo on a 3D turntable inside `r` (local pixels, centred on 0): it swings round in perspective (drawn in vertical
 * columns that shrink as they turn away), floats a little over a contact shadow, mirrors in a reflective floor that fades
 * out, is shaded by the key light as it turns, and a specular shine glides across it.
 */
export function drawTurntable(ctx: Ctx, layer: PhotoLayer, r: Rect, img: Img | undefined, progress: number, env: Env, cutout = false): void {
  const tt = layer.turntable ?? {};
  const { yaw, lift, sweep } = turntableAt(tt, progress);
  const iw0 = img && img.width > 0 ? img.width : 1;
  const ih0 = img && img.width > 0 ? img.height : 1;
  const { w, h, centre } = turntableFit(r, iw0, ih0, tt.angle ?? 35);
  const float = lift * r.h * 0.025;
  const cy = r.y + centre - float;
  const floorY = r.y + centre + h / 2 + r.h * 0.01;
  const cols = Array.from({ length: COLUMNS + 1 }, (_, i) => turntableColumn(i / COLUMNS, yaw));
  const X = (i: number) => cols[i].x * w;
  const half = (i: number) => (h * cols[i].scale) / 2;

  // The floor: a soft pool of the key light's colour where the product stands (no floor shape needed in the design).
  ctx.save();
  const poolRx = Math.max(8, w * 0.75);
  ctx.translate(0, floorY);
  ctx.scale(1, 0.16);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, poolRx);
  pool.addColorStop(0, mix(env.light.color, env.light.color, 0, 0.22 * (0.4 + 0.6 * env.light.intensity)));
  pool.addColorStop(0.6, mix(env.light.color, env.light.color, 0, 0.08 * (0.4 + 0.6 * env.light.intensity)));
  pool.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(0, 0, poolRx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Contact shadow on the floor, shifted away from the light, softer while the product floats up.
  ctx.save();
  const sx = -env.toLight.x * w * 0.08;
  const rx = Math.max(4, (Math.abs(X(COLUMNS) - X(0)) / 2) * 1.05);
  const ry = Math.max(2, h * 0.05);
  ctx.translate(sx, floorY);
  ctx.scale(1, ry / rx);
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  sg.addColorStop(0, `rgba(0,0,0,${0.55 * (1 - lift * 0.35)})`);
  sg.addColorStop(0.6, `rgba(0,0,0,${0.2 * (1 - lift * 0.35)})`);
  sg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Each column is drawn as tall as its taller edge and clipped to the outline, so the edges are clean straight lines.
  const column = (i: number, draw: (dx: number, dw: number, halfH: number, fullH: number, sx0: number, sw: number) => void) => {
    const x0 = X(i);
    const x1 = X(i + 1);
    const left = Math.min(x0, x1);
    // One pixel of overlap hides the seams between columns.
    const dw = Math.abs(x1 - x0) + 1;
    const hh = Math.max(half(i), half(i + 1));
    // Turned past 90 degrees the picture would show its back; the swing never goes that far (angle <= 60).
    draw(left, dw, hh, hh * 2, (i * iw0) / COLUMNS, iw0 / COLUMNS);
  };

  // Its outline in perspective (a trapezoid: the projection keeps edges straight), and the outline of its reflection.
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(X(0), cy - half(0));
    ctx.lineTo(X(COLUMNS), cy - half(COLUMNS));
    ctx.lineTo(X(COLUMNS), cy + half(COLUMNS));
    ctx.lineTo(X(0), cy + half(0));
    ctx.closePath();
  };
  const mirroredOn = (c: Ctx) => {
    c.beginPath();
    c.moveTo(X(0), cy + half(0) + 2 * float);
    c.lineTo(X(COLUMNS), cy + half(COLUMNS) + 2 * float);
    c.lineTo(X(COLUMNS), cy + half(COLUMNS) * 1.9 + 2 * float);
    c.lineTo(X(0), cy + half(0) * 1.9 + 2 * float);
    c.closePath();
  };
  const mirrored = () => mirroredOn(ctx);

  // The reflection: each column mirrored under the floor line, fading out. With a scratch buffer it is drawn opaque
  // there (same transform as the frame), faded with a mask and laid on in one go; without one, in fading bands.
  const reflection = tt.reflection ?? 0.35;
  const scratch = reflection > 0.01 ? env.scratch() : null;
  const transform = scratch && "getTransform" in ctx ? ctx.getTransform() : null;
  if (scratch && transform && typeof transform.a === "number") {
    const b = scratch.ctx;
    b.save();
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    b.globalCompositeOperation = "source-over";
    b.filter = "none";
    b.clearRect(0, 0, env.W, env.H);
    b.setTransform(transform);
    mirroredOn(b);
    b.clip();
    for (let i = 0; i < COLUMNS; i++) {
      column(i, (dx, dw, hh, fullH, sx0, sw) => {
        const reach = fullH * 0.45;
        b.save();
        // Mirrored at the column's shorter edge, so no gap opens under the slanted floor line (the clip trims the rest).
        b.translate(0, cy + Math.min(half(i), half(i + 1)) + 2 * float);
        b.scale(1, -1);
        if (img && img.width > 0) b.drawImage(img, sx0, ih0 * (1 - reach / fullH), sw, (ih0 * reach) / fullH, dx, -reach, dw, reach);
        else {
          b.fillStyle = env.palette.primary;
          b.fillRect(dx, -reach, dw, reach);
        }
        b.restore();
      });
    }
    const top = cy + Math.min(half(0), half(COLUMNS)) + 2 * float;
    const bottom = cy + Math.max(half(0), half(COLUMNS)) * 1.9 + 2 * float;
    const fade = b.createLinearGradient(0, top, 0, bottom);
    fade.addColorStop(0, `rgba(0,0,0,${0.6 * reflection})`);
    fade.addColorStop(0.45, `rgba(0,0,0,${0.18 * reflection})`);
    fade.addColorStop(1, "rgba(0,0,0,0)");
    b.globalCompositeOperation = "destination-in";
    b.fillStyle = fade;
    b.fillRect(X(0) - 2, top - 2, X(COLUMNS) - X(0) + 4, bottom - top + 4);
    b.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratch.canvas, 0, 0, env.W, env.H);
    ctx.restore();
  } else if (reflection > 0.01) {
    ctx.save();
    mirrored();
    ctx.clip();
    for (let i = 0; i < COLUMNS; i++) {
      column(i, (dx, dw, hh, fullH, sx0, sw) => {
        const base = cy + hh + float;
        const reach = fullH * 0.45;
        for (let b = 0; b < BANDS; b++) {
          const a = reflection * 0.55 * Math.pow(1 - (b + 0.5) / BANDS, 1.6);
          if (a < 0.005) continue;
          const d0 = (b / BANDS) * reach;
          const d1 = ((b + 1) / BANDS) * reach;
          ctx.save();
          ctx.globalAlpha *= a;
          ctx.translate(0, base + float);
          ctx.scale(1, -1);
          if (img && img.width > 0) ctx.drawImage(img, sx0, ih0 * (1 - d1 / fullH), sw, (ih0 * (d1 - d0)) / fullH, dx, -d1, dw, d1 - d0 + 0.5);
          else {
            ctx.fillStyle = env.palette.primary;
            ctx.fillRect(dx, -d1, dw, d1 - d0 + 0.5);
          }
          ctx.restore();
        }
      });
    }
    ctx.restore();
  }

  // The card's edge: turned, the side nearer the camera shows its thickness (a cut-out product has no card).
  if (!cutout && Math.abs(yaw) > 0.02) {
    const e = yaw > 0 ? 0 : COLUMNS;
    const d = (yaw > 0 ? -1 : 1) * w * 0.035 * Math.abs(Math.sin(yaw));
    const he = half(e);
    const edge = ctx.createLinearGradient(0, cy - he, 0, cy + he);
    edge.addColorStop(0, mix("#f2f4f8", env.light.color, 0.3));
    edge.addColorStop(1, mix("#9aa3b5", "#000000", 0.35));
    ctx.save();
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.moveTo(X(e), cy - he);
    ctx.lineTo(X(e) + d, cy - he * 1.012);
    ctx.lineTo(X(e) + d, cy + he * 1.012);
    ctx.lineTo(X(e), cy + he);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // The product itself, then its shading and shine. On a cut-out the light must land on the product's pixels only
  // ("source-atop"), which needs the scratch buffer; without one a cut-out is drawn unshaded.
  const left = Math.min(X(0), X(COLUMNS));
  const right = Math.max(X(0), X(COLUMNS));
  const paintFace = (c: Ctx, shade: boolean, atop: boolean) => {
    c.save();
    c.beginPath();
    c.moveTo(X(0), cy - half(0));
    c.lineTo(X(COLUMNS), cy - half(COLUMNS));
    c.lineTo(X(COLUMNS), cy + half(COLUMNS));
    c.lineTo(X(0), cy + half(0));
    c.closePath();
    c.clip();
    for (let i = 0; i < COLUMNS; i++) {
      column(i, (dx, dw, hh, fullH, sx0, sw) => {
        if (img && img.width > 0) c.drawImage(img, sx0, 0, sw, ih0, dx, cy - hh, dw, fullH);
        else {
          c.fillStyle = env.palette.primary;
          c.fillRect(dx, cy - hh, dw, fullH);
        }
      });
    }
    if (shade) {
      // A positive yaw sends the right edge back, so the face turns to the right; turned towards the light it is
      // brighter, turned away darker.
      const facing = Math.sin(yaw) * Math.sign(env.toLight.x || 1);
      const I = env.light.intensity;
      const shadeG = c.createLinearGradient(left, 0, right, 0);
      const lit = `rgba(255,255,255,${(0.1 + 0.15 * Math.max(0, facing)) * I})`;
      const dark = `rgba(0,0,0,${(0.08 + 0.32 * Math.max(0, -facing)) * I})`;
      shadeG.addColorStop(0, env.toLight.x < 0 ? lit : dark);
      shadeG.addColorStop(1, env.toLight.x < 0 ? dark : lit);
      if (atop) c.globalCompositeOperation = "source-atop";
      c.fillStyle = shadeG;
      c.fillRect(left, cy - h, right - left, h * 2);
      if (tt.sweep !== false) {
        // The shine: a slanted bright band that glides across as the face turns through the light.
        const at = left + (right - left) * sweep;
        const band = (right - left) * 0.22;
        const g = c.createLinearGradient(at - band, cy - h * 0.3, at + band, cy + h * 0.3);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, mix(env.light.color, env.light.color, 0, 0.55 * (0.5 + 0.5 * I)));
        g.addColorStop(1, "rgba(255,255,255,0)");
        c.globalCompositeOperation = atop ? "source-atop" : "screen";
        c.fillStyle = g;
        c.fillRect(left, cy - h, right - left, h * 2);
      }
    }
    c.restore();
  };
  const faceBuffer = cutout ? env.scratch() : null;
  const faceTransform = faceBuffer && "getTransform" in ctx ? ctx.getTransform() : null;
  if (faceBuffer && faceTransform && typeof faceTransform.a === "number") {
    const b = faceBuffer.ctx;
    b.save();
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    b.globalCompositeOperation = "source-over";
    b.filter = "none";
    b.clearRect(0, 0, env.W, env.H);
    b.setTransform(faceTransform);
    paintFace(b, true, true);
    b.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(faceBuffer.canvas, 0, 0, env.W, env.H);
    ctx.restore();
  } else paintFace(ctx, !cutout, false);
  if (cutout) return;
  if (layer.border) {
    ctx.save();
    ctx.strokeStyle = layer.border;
    ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.012);
    outline();
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * A cut-out product (no background, cutout.ts) in a "contain" photo layer: it floats free of any frame, with a shadow
 * that follows its own shape (away from the key light when the scene has one).
 */
export function drawCutout(ctx: Ctx, layer: PhotoLayer, r: Rect, img: Img, progress: number, env: Env): void {
  const zoom = 1 + ((layer.zoomTo ?? 1) - 1) * ease("inOut", progress);
  const s = Math.min(r.w / img.width, r.h / img.height) * zoom;
  const w = img.width * s;
  const h = img.height * s;
  ctx.save();
  if (layer.shadow) {
    const m = Math.min(w, h);
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = m * 0.06;
    ctx.shadowOffsetX = env.light.set ? -env.toLight.x * m * 0.05 : 0;
    ctx.shadowOffsetY = env.light.set ? -env.toLight.y * m * 0.05 : m * 0.03;
  }
  ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  ctx.restore();
}

/** The key light on a flat photo (scenes with a light only): a highlight on the near side, shade on the far side. */
export function lightPhoto(ctx: Ctx, r: Rect, env: Env): void {
  if (!env.light.set || env.light.intensity < 0.05) return;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const half = Math.max(r.w, r.h) / 2;
  const g = ctx.createLinearGradient(cx + env.toLight.x * half, cy + env.toLight.y * half, cx - env.toLight.x * half, cy - env.toLight.y * half);
  g.addColorStop(0, mix(env.light.color, env.light.color, 0, 0.22 * env.light.intensity));
  g.addColorStop(0.45, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${0.32 * env.light.intensity})`);
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

// ---- Particles -----------------------------------------------------------------------------------------------------------

const PARTICLE_SIZE = { dust: 0.004, sparkles: 0.014, bokeh: 0.05, confetti: 0.012, bubbles: 0.026 } as const;

/** A particle field inside `r` (local pixels). Each particle parallaxes by its own depth on top of the layer's. */
export function drawParticles(ctx: Ctx, layer: ParticlesLayer, r: Rect, env: Env): void {
  const kind = layer.particle;
  const colors = layer.colors?.length ? layer.colors : kind === "confetti" ? [env.palette.accent, env.palette.primary, "#ffffff", "#ffd23f", "#ff5c8a"] : ["#ffffff"];
  const base = (layer.size ?? PARTICLE_SIZE[kind] ?? 0.01) * env.W;
  const t = env.tMs / 1000;
  const count = layer.count ?? 30;
  ctx.save();
  const layerAlpha = ctx.globalAlpha;
  for (let i = 0; i < count; i++) {
    const p = particleAt(kind, i, layer.seed ?? 1, t, layer.speed ?? 1);
    const x = r.x + p.x * r.w + (p.depth - 0.5) * env.cam.orbit * env.W * 0.9 + (p.depth - 0.5) * env.cam.panX * env.W * 0.5;
    const y = r.y + p.y * r.h + (p.depth - 0.5) * env.cam.panY * env.H * 0.5;
    const s = Math.max(0.5, base * p.size);
    const color = colors[p.color % colors.length];
    ctx.globalAlpha = layerAlpha * clamp01(p.alpha) * (kind === "bokeh" ? 0.55 : 1);
    if (kind === "bokeh") {
      const g = ctx.createRadialGradient(x, y, 0, x, y, s);
      g.addColorStop(0, mix(color, color, 0, 0.5));
      g.addColorStop(0.75, mix(color, color, 0, 0.3));
      g.addColorStop(1, mix(color, color, 0, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "sparkles") {
      // A four-point star with a soft glow, twinkling in size.
      const a = s * (0.6 + 0.4 * p.alpha);
      ctx.fillStyle = mix(color, color, 0, 0.25);
      ctx.beginPath();
      ctx.arc(x, y, a * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let j = 0; j < 4; j++) {
        const ang = p.rotate * 0.2 + (j * Math.PI) / 2;
        const tipX = x + Math.cos(ang) * a * 1.6;
        const tipY = y + Math.sin(ang) * a * 1.6;
        const mid = ang + Math.PI / 4;
        if (j === 0) ctx.moveTo(tipX, tipY);
        else ctx.lineTo(tipX, tipY);
        ctx.lineTo(x + Math.cos(mid) * a * 0.28, y + Math.sin(mid) * a * 0.28);
      }
      ctx.closePath();
      ctx.fill();
    } else if (kind === "confetti") {
      // A paper piece tumbling in 3D: it turns (rotate) and flips over (its height follows the flip).
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rotate);
      ctx.scale(1, Math.max(0.08, Math.abs(p.flip)));
      ctx.fillStyle = p.flip < 0 ? mix(color, "#000000", 0.25) : color;
      ctx.fillRect(-s * 0.8, -s * 0.45, s * 1.6, s * 0.9);
      ctx.restore();
    } else if (kind === "bubbles") {
      ctx.fillStyle = mix(color, color, 0, 0.08);
      ctx.strokeStyle = mix(color, color, 0, 0.55);
      ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // The glint sits on the side facing the key light.
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(x + env.toLight.x * s * 0.45, y + env.toLight.y * s * 0.45, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
