// Premium 3D (docs/BLENDER.md): the scene Claude writes for one Blender clip, its checking and defaults, and the
// Blender command line. Pure: shared by the job runner (video-lab/blender-jobs.ts), the studio and the tests.
// tools/blender/render.py applies the same defaults again, so a hand-written scene cannot break a render either.

export const BLENDER_RATIOS = ["9:16", "3:4", "4:5", "1:1", "4:3", "16:9"] as const;
export const BLENDER_QUALITIES = ["480p", "540p", "720p", "1080p"] as const;
export const BLENDER_FPS = [24, 25, 30] as const;
/** studio: the dark showroom; daylight: a bright white set with a brand-colour accent wall; neon: a dark set lit by a
 * neon arch and tubes in the brand colour; gradient and solid: plain sets. */
export const BLENDER_BACKGROUNDS = ["solid", "gradient", "studio", "daylight", "neon"] as const;
export const BLENDER_LIGHTS = ["studio", "soft", "dramatic", "warm"] as const;
/** The studio's camera moves (lib/video-engine/spec.ts, CAMERA_MOVES) that a real 3D camera does well. */
export const BLENDER_CAMERA_MOVES = ["static", "orbitLeft", "orbitRight", "dollyIn", "dollyOut", "craneUp", "craneDown", "pushPull"] as const;
export const BLENDER_EASES = ["linear", "in", "out", "inOut", "back", "elastic", "bounce"] as const;
export const BLENDER_MATERIALS = ["metal", "chrome", "glass", "matte", "gloss", "neon"] as const;
/** The studio's fonts (lib/video-engine/spec.ts, FONTS), read from public/fonts/video. */
export const BLENDER_FONTS = ["inter", "poppins", "nunito", "space-grotesk", "anton", "playfair", "dm-serif"] as const;
export const BLENDER_ENTERS = ["none", "spinIn", "rise", "drop", "scale", "pop"] as const;
export const BLENDER_IDLES = ["none", "float", "turntable", "swing", "spin"] as const;
export const BLENDER_PROPS = ["sphere", "box", "ring", "cylinder", "plinth"] as const;
export const BLENDER_PARTICLES = ["confetti", "sparkles", "bubbles", "dust"] as const;
export const BLENDER_CONTRASTS = ["base", "medium", "high", "punchy"] as const;

export const BLENDER_LIMITS = { minSeconds: 1, maxSeconds: 15, texts: 6, textLength: 60, props: 12, particleGroups: 3, particles: 150, colors: 5 } as const;

type Vec3 = [number, number, number];
type Of<T extends readonly unknown[]> = T[number];

/** Entrance (at `enterAt` seconds, lasting `enterFor`) and the motion after it. */
export interface BlenderMotion {
  enter: Of<typeof BLENDER_ENTERS>;
  enterAt: number;
  enterFor: number;
  idle: Of<typeof BLENDER_IDLES>;
  /** swing: swings over the clip; turntable: full turns over the clip; spin: turns per second of `angle` degrees. */
  spin: number;
  /** swing: degrees each way; spin: degrees per turn step. */
  angle: number;
}

export interface BlenderProduct extends BlenderMotion {
  /** Which of the server's photos it is (1-based; null for a hand-written path). Kept so a checked scene can be checked
   * again with the same photo list. */
  photo: number | null;
  /** The product photo (a path the server resolved from `photo`). */
  image: string | null;
  /** The product cut out of its background (PNG with transparency): stands free on the floor. */
  cutout: string | null;
  /** Without a cutout the photo is printed on a rounded card, or on the faces of a box. */
  shape: "card" | "box";
  height: number;
  /** Bottom centre of the product. */
  position: Vec3;
  radius: number;
  frame: string;
}

export interface BlenderText extends BlenderMotion {
  text: string;
  font: Of<typeof BLENDER_FONTS>;
  /** Font size in scene units (capitals are about 0.65 x size tall; the product is about 2.5 tall). */
  size: number;
  /** Centre of the text. */
  position: Vec3;
  /** Turn around the vertical axis, degrees. */
  rotation: number;
  /** Extrusion, 0 to 1 (1 = half the letter height). */
  depth: number;
  /** Rounded edge, 0 to 1. */
  bevel: number;
  material: Of<typeof BLENDER_MATERIALS>;
  color: string;
  /** How much the text turns to face the camera as it moves, 0 to 1 (default 0.6). */
  face: number;
  /** bold (title) or regular (lines): the font's two weights (anton and dm-serif have one). */
  weight: "bold" | "regular";
  /** A clean flat label on a rounded bar of this colour (a phone number, a call to action), or null for 3D letters. */
  plate: string | null;
}

export interface BlenderProp extends BlenderMotion {
  kind: Of<typeof BLENDER_PROPS>;
  /** Sphere and ring: centre. Box, cylinder and plinth: bottom centre (they stand on the floor at z 0). */
  position: Vec3;
  /** Diameter (sphere, ring, cylinder, plinth) or width (box). */
  size: number;
  /** Box, cylinder and plinth height (0 = automatic). */
  height: number;
  material: Of<typeof BLENDER_MATERIALS>;
  color: string;
}

export interface BlenderParticles {
  kind: Of<typeof BLENDER_PARTICLES>;
  count: number;
  colors: string[];
  size: number;
  speed: number;
  center: Vec3;
  /** Width, depth and height of the box they fill. */
  area: Vec3;
  seed: number;
}

export interface BlenderScene {
  version: 1;
  title: string;
  canvas: { ratio: Of<typeof BLENDER_RATIOS>; quality: Of<typeof BLENDER_QUALITIES>; fps: Of<typeof BLENDER_FPS>; samples: number };
  duration: number;
  seed: number;
  background: {
    kind: Of<typeof BLENDER_BACKGROUNDS>;
    /** solid: [colour]; gradient: [low, high]; studio: [backdrop, glow behind the product]; daylight: [light set, accent
     * wall]; neon: [dark set, neon colour]. */
    colors: [string, string];
    floor: { color: string; reflect: number };
    light: { preset: Of<typeof BLENDER_LIGHTS>; intensity: number; rim: string; side: "left" | "right" };
  };
  camera: {
    move: Of<typeof BLENDER_CAMERA_MOVES>;
    intensity: number;
    ease: Of<typeof BLENDER_EASES>;
    /** The point the camera looks at. */
    target: Vec3;
    distance: number;
    /** Camera height above the floor (crane moves go around the target instead). */
    height: number;
    lens: number;
    /** Depth of field: 0 = off (faster), else the f-stop (1.4 = very blurry background, 8 = slight). */
    fstop: number;
  };
  product: BlenderProduct | null;
  texts: BlenderText[];
  props: BlenderProp[];
  particles: BlenderParticles[];
  look: { contrast: Of<typeof BLENDER_CONTRASTS>; exposure: number; bloom: number };
  /**
   * When the voice starts and how loud each track is. The sound files themselves never come from the scene: the
   * server passes them to renderBlenderScene (`audio`, `music`), from the job's own folder.
   */
  sound: { voiceAt: number; voiceVolume: number; musicVolume: number | null };
}

/** A photo the designer was given: the photo and, when one was made, its cutout (transparent PNG). */
export type BlenderPhoto = { image: string; cutout?: string | null };

export type NormalizeOptions = {
  /** The photos Claude may use, in order: `product.photo` 1 is the first. */
  photos?: BlenderPhoto[];
  /** Accept raw `image` and `cutout` paths in the scene (hand-written scenes only, never Claude's). */
  allowPaths?: boolean;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function num(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}
function pick<T extends readonly (string | number)[]>(v: unknown, options: T, def: Of<T>): Of<T> {
  return (options as readonly unknown[]).includes(v) ? (v as Of<T>) : def;
}
function color(v: unknown, def: string): string {
  return typeof v === "string" && COLOR.test(v.trim()) ? v.trim().toLowerCase() : def;
}
function vec3(v: unknown, def: Vec3): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) return [...def];
  return [num(v[0], def[0], -50, 50), num(v[1], def[1], -50, 50), num(v[2], def[2], -50, 50)];
}
function motion(o: Record<string, unknown>, enter: BlenderMotion["enter"], idle: BlenderMotion["idle"]): BlenderMotion {
  return {
    enter: pick(o.enter, BLENDER_ENTERS, enter),
    enterAt: num(o.enterAt, 0, 0, BLENDER_LIMITS.maxSeconds),
    enterFor: num(o.enterFor, 0.9, 0.1, 5),
    idle: pick(o.idle, BLENDER_IDLES, idle),
    spin: num(o.spin, 1, 0, 4),
    angle: num(o.angle, 30, 5, 360),
  };
}

/**
 * Checks a scene and fills every default. Never throws: unknown values fall back to safe ones and each repair is
 * listed in `warnings`. Paths come only from `photos` (Claude writes `"photo": 1`), unless `allowPaths` is set.
 */
export function normalizeBlenderScene(input: unknown, opts: NormalizeOptions = {}): { scene: BlenderScene; warnings: string[] } {
  const warnings: string[] = [];
  const s = isObj(input) ? input : {};
  if (!isObj(input)) warnings.push("The scene is not an object: using an empty scene.");
  const canvas = isObj(s.canvas) ? s.canvas : {};
  const duration = num(s.duration, 4, BLENDER_LIMITS.minSeconds, BLENDER_LIMITS.maxSeconds);
  if (s.duration !== undefined && duration !== s.duration) warnings.push(`Duration set to ${duration} s (1 to 15).`);
  const seed = Math.round(num(s.seed, 1, 0, 1_000_000));

  const bg = isObj(s.background) ? s.background : {};
  const rawColors = Array.isArray(bg.colors) ? bg.colors.map((c) => color(c, "")).filter(Boolean) : [];
  const colors: [string, string] = rawColors.length ? [rawColors[0], rawColors[1] ?? rawColors[0]] : ["#1a1d24", "#3a4255"];
  const floor = isObj(bg.floor) ? bg.floor : {};
  const light = isObj(bg.light) ? bg.light : {};
  const cam = isObj(s.camera) ? s.camera : {};

  const scene: BlenderScene = {
    version: 1,
    title: typeof s.title === "string" ? s.title.slice(0, 120) : "Premium 3D clip",
    canvas: {
      ratio: pick(canvas.ratio, BLENDER_RATIOS, "9:16"),
      quality: pick(canvas.quality, BLENDER_QUALITIES, "540p"),
      fps: pick(canvas.fps, BLENDER_FPS, 24),
      samples: Math.round(num(canvas.samples, 16, 1, 128)),
    },
    duration,
    seed,
    background: {
      kind: pick(bg.kind, BLENDER_BACKGROUNDS, "studio"),
      colors,
      floor: { color: color(floor.color, colors[0]), reflect: num(floor.reflect, 0.55, 0, 1) },
      light: {
        preset: pick(light.preset, BLENDER_LIGHTS, "studio"),
        intensity: num(light.intensity, 1, 0.2, 3),
        rim: color(light.rim, "#bcd4ff"),
        side: light.side === "right" ? "right" : "left",
      },
    },
    camera: {
      move: pick(cam.move, BLENDER_CAMERA_MOVES, "orbitRight"),
      intensity: num(cam.intensity, 0.5, 0, 1),
      ease: pick(cam.ease, BLENDER_EASES, "inOut"),
      target: vec3(cam.target, [0, 0, 1.6]),
      distance: num(cam.distance, 8, 2, 20),
      height: num(cam.height, 1.8, -2, 10),
      lens: num(cam.lens, 50, 18, 135),
      fstop: num(cam.fstop, 0, 0, 32),
    },
    product: null,
    texts: [],
    props: [],
    particles: [],
    look: (() => {
      const look = isObj(s.look) ? s.look : {};
      return { contrast: pick(look.contrast, BLENDER_CONTRASTS, "medium"), exposure: num(look.exposure, 0, -3, 3), bloom: num(look.bloom, 0.2, 0, 1) };
    })(),
    sound: { voiceAt: 0.3, voiceVolume: 1, musicVolume: null },
  };
  if (isObj(s.sound)) {
    const snd = s.sound;
    scene.sound = {
      voiceAt: num(snd.voiceAt, 0.3, 0, BLENDER_LIMITS.maxSeconds),
      voiceVolume: num(snd.voiceVolume, 1, 0, 2),
      musicVolume: snd.musicVolume === undefined || snd.musicVolume === null ? null : num(snd.musicVolume, 0.18, 0, 1),
    };
    if (snd.voice !== undefined || snd.music !== undefined) warnings.push("Sound files are not taken from the scene: the server passes them (audio, music).");
  }
  if (cam.move !== undefined && scene.camera.move !== cam.move) warnings.push(`Camera move "${String(cam.move)}" is not available in 3D: using ${scene.camera.move}.`);

  if (isObj(s.product)) {
    const p = s.product;
    let image: string | null = null;
    let cutout: string | null = null;
    let photoNumber: number | null = null;
    if (p.photo !== undefined && p.photo !== null) {
      const i = Math.round(num(p.photo, 0, 0, 99)) - 1;
      const photo = opts.photos?.[i];
      if (photo) {
        photoNumber = i + 1;
        image = photo.image;
        cutout = photo.cutout ?? null;
      } else warnings.push(`Product photo ${String(p.photo)} does not exist: the clip has no product.`);
    } else if (opts.allowPaths) {
      image = typeof p.image === "string" ? p.image : null;
      cutout = typeof p.cutout === "string" ? p.cutout : null;
    } else if (p.image !== undefined || p.cutout !== undefined) {
      warnings.push("Product paths are not allowed here: use \"photo\": 1 for the first photo.");
    }
    if (image || cutout) {
      scene.product = {
        photo: photoNumber,
        image,
        cutout,
        shape: p.shape === "box" ? "box" : "card",
        height: num(p.height, 2.4, 0.3, 6),
        position: vec3(p.position, [0, 0, 0]),
        radius: num(p.radius, 0.08, 0, 0.5),
        frame: color(p.frame, "#f4f4f4"),
        ...motion(p, "rise", "float"),
      };
    }
  }

  const texts = Array.isArray(s.texts) ? s.texts : [];
  for (const t of texts) {
    if (!isObj(t) || typeof t.text !== "string" || !t.text.trim()) continue;
    if (scene.texts.length >= BLENDER_LIMITS.texts) {
      warnings.push(`Only ${BLENDER_LIMITS.texts} texts are kept.`);
      break;
    }
    if (t.text.length > BLENDER_LIMITS.textLength) warnings.push(`Text "${t.text.slice(0, 20)}..." was cut to ${BLENDER_LIMITS.textLength} characters.`);
    scene.texts.push({
      text: t.text.slice(0, BLENDER_LIMITS.textLength),
      font: pick(t.font, BLENDER_FONTS, "anton"),
      size: num(t.size, 0.6, 0.1, 3),
      position: vec3(t.position, [0, 0, 3]),
      rotation: num(t.rotation, 0, -90, 90),
      depth: num(t.depth, 0.25, 0, 1),
      bevel: num(t.bevel, 0.5, 0, 1),
      material: pick(t.material, BLENDER_MATERIALS, "metal"),
      color: color(t.color, "#ffffff"),
      face: num(t.face, 0.6, 0, 1),
      weight: t.weight === "regular" ? "regular" : "bold",
      plate: t.plate === undefined || t.plate === null ? null : color(t.plate, "#111111"),
      ...motion(t, "spinIn", "none"),
    });
  }

  const props = Array.isArray(s.props) ? s.props : [];
  for (const pr of props.filter(isObj).slice(0, BLENDER_LIMITS.props)) {
    scene.props.push({
      kind: pick(pr.kind, BLENDER_PROPS, "sphere"),
      position: vec3(pr.position, [0, 0, 0]),
      size: num(pr.size, 0.5, 0.05, 6),
      height: num(pr.height, 0, 0, 6),
      material: pick(pr.material, BLENDER_MATERIALS, "gloss"),
      color: color(pr.color, "#ffffff"),
      ...motion(pr, "none", "none"),
    });
  }
  if (props.length > BLENDER_LIMITS.props) warnings.push(`Only ${BLENDER_LIMITS.props} props are kept.`);

  const particles = Array.isArray(s.particles) ? s.particles : [];
  for (const pa of particles.filter(isObj).slice(0, BLENDER_LIMITS.particleGroups)) {
    const cols = Array.isArray(pa.colors) ? pa.colors.map((c) => color(c, "")).filter(Boolean).slice(0, BLENDER_LIMITS.colors) : [];
    scene.particles.push({
      kind: pick(pa.kind, BLENDER_PARTICLES, "sparkles"),
      count: Math.round(num(pa.count, 40, 1, BLENDER_LIMITS.particles)),
      colors: cols.length ? cols : ["#ffffff"],
      size: num(pa.size, 1, 0.2, 4),
      speed: num(pa.speed, 1, 0, 3),
      center: vec3(pa.center, [0, 0, 2.5]),
      area: vec3(pa.area, [6, 4, 6]),
      seed: Math.round(num(pa.seed, seed, 0, 1_000_000)),
    });
  }

  for (const m of [scene.product, ...scene.texts, ...scene.props]) {
    if (m && m.enter !== "none" && m.enterAt >= scene.duration) {
      warnings.push(`An entrance at ${m.enterAt} s is after the end of the clip: it starts at 0 s instead.`);
      m.enterAt = 0;
    }
  }
  return { scene, warnings };
}

/** Width and height in pixels (even, as H.264 needs). */
export function blenderCanvasSize(canvas: BlenderScene["canvas"]): { width: number; height: number } {
  const [w, h] = canvas.ratio.split(":").map(Number);
  const short = Number.parseInt(canvas.quality, 10);
  const k = short / Math.min(w, h);
  const even = (n: number) => Math.round((n * k) / 2) * 2;
  return { width: even(w), height: even(h) };
}

export const BLENDER_APP = "/Applications/Blender.app/Contents/MacOS/Blender";

/** Sound files Blender's FFmpeg reads well. */
export const BLENDER_SOUND_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"] as const;

/** An absolute POSIX path with "." and ".." resolved, or null when it is not absolute. Pure (no file system). */
function cleanAbsolute(p: string): string | null {
  if (!p.startsWith("/")) return null;
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

/**
 * Checks a sound file for a render: an absolute path inside the job's folder, with a sound extension. Returns the clean
 * path, or throws a plain-English error. Pure: the runner also checks the real file (links resolved) before rendering.
 */
export function checkSoundPath(file: string, jobDir: string): string {
  const f = cleanAbsolute(file);
  const dir = cleanAbsolute(jobDir);
  if (!f || !dir) throw new Error("A sound file and the job folder must be absolute paths.");
  if (dir === "/" || !f.startsWith(`${dir}/`)) throw new Error(`The sound file must be inside the job's folder (${dir}).`);
  const ext = f.slice(f.lastIndexOf(".")).toLowerCase();
  if (!(BLENDER_SOUND_EXTENSIONS as readonly string[]).includes(ext)) throw new Error(`The sound file must be ${BLENDER_SOUND_EXTENSIONS.join(", ")}.`);
  return f;
}

/**
 * The headless Blender command for a scene file: an MP4, or PNG stills at clip fractions (0 to 1) when given. With
 * `audio` (the voice) and/or `music` (checked paths), the MP4 carries an AAC track mixed by Blender's own FFmpeg.
 */
export function blenderCommand(o: {
  scenePath: string;
  outPath: string;
  repoDir: string;
  bin?: string;
  stills?: number[];
  stillsDir?: string;
  preview?: boolean;
  audio?: string;
  music?: string;
  voiceAt?: number;
  musicVolume?: number;
}): { bin: string; args: string[] } {
  const args = ["-b", "--factory-startup", "-noaudio", "-P", `${o.repoDir}/tools/blender/render.py`, "--", "--scene", o.scenePath, "--out", o.outPath, "--base-dir", o.repoDir];
  if (o.stills?.length) {
    args.push("--stills", o.stills.map((f) => Math.min(1, Math.max(0, f)).toFixed(3)).join(","));
    if (o.stillsDir) args.push("--stills-dir", o.stillsDir);
  }
  if (o.preview) args.push("--preview");
  if (!o.stills?.length) {
    if (o.audio) args.push("--audio", o.audio);
    if (o.music) args.push("--music", o.music);
    if (o.voiceAt !== undefined && Number.isFinite(o.voiceAt)) args.push("--voice-at", String(Math.min(BLENDER_LIMITS.maxSeconds, Math.max(0, o.voiceAt))));
    if (o.musicVolume !== undefined && Number.isFinite(o.musicVolume)) args.push("--music-volume", String(Math.min(1, Math.max(0, o.musicVolume))));
  }
  return { bin: o.bin || BLENDER_APP, args };
}

/** A "BLENDER_PROGRESS <frame> <total>" line from render.py as a fraction 0 to 1, or null for any other line. */
export function parseBlenderProgress(line: string): number | null {
  const m = /^BLENDER_PROGRESS (\d+) (\d+)/.exec(line.trim());
  if (!m) return null;
  const total = Number(m[2]);
  return total > 0 ? Math.min(1, Number(m[1]) / total) : null;
}

/**
 * The scene format, written for Claude's system prompt (the motion engine's "Premium 3D" quality). Claude answers with
 * one JSON object in this format; the server checks it with normalizeBlenderScene and queues the render.
 */
export const BLENDER_SCENE_FORMAT = `A Blender 3D scene, one JSON object. Units: the product is about 2.5 tall; x is left (-) to right (+), y is towards the camera (-) or away (+), z is up from the floor (0). The camera starts in front, at -y, looking at "target".
{
  "version": 1, "title": string,
  "canvas": { "ratio": "9:16"|"3:4"|"4:5"|"1:1"|"4:3"|"16:9", "quality": "540p"|"720p"|"1080p", "fps": 24|25|30 },
  "duration": seconds 2 to 8,
  "seed": integer,
  "background": { "kind": "studio"|"daylight"|"neon"|"gradient"|"solid", "colors": [hex, hex] (studio: near-black backdrop and the brand-colour glow behind the product; daylight: a light set colour and the brand-colour accent wall behind the product; neon: a near-black set and the neon colour; gradient: low and high; solid: one colour),
    "floor": { "color": hex, "reflect": 0 to 1 (0.6 to 0.85 for a glossy studio floor) },
    "light": { "preset": "studio"|"soft"|"dramatic"|"warm", "intensity": 0.5 to 1.5, "rim": hex (edge light colour), "side": "left"|"right" (key light side) } },
  "camera": { "move": "orbitRight"|"orbitLeft"|"dollyIn"|"dollyOut"|"craneUp"|"craneDown"|"pushPull"|"static", "intensity": 0 to 1, "ease": "inOut"|"out"|"in"|"linear"|"back",
    "target": [x, y, z] (usually [0, 0, 1.6 to 2.4]), "distance": 7 to 12, "height": 1 to 3, "lens": 35 to 85, "fstop": 0 (sharp) or 2 to 8 (blurred background) },
  "product": { "photo": 1-based photo number, "shape": "card"|"box" (when there is no cutout), "height": 2 to 3, "position": [x, y, z] (bottom centre; on a plinth z = its height),
    "enter": "rise"|"drop"|"pop"|"scale"|"spinIn"|"none", "enterAt": seconds, "enterFor": seconds, "idle": "swing"|"float"|"turntable"|"none", "angle": swing degrees (15 to 35), "spin": swings over the clip (0.5 to 1) } or null,
  "texts": up to 6 of { "text": short words (at most 60 characters, only facts from the brief), "font": "anton"|"poppins"|"inter"|"nunito"|"space-grotesk"|"playfair"|"dm-serif",
    "size": font size 0.5 to 2 (capitals are about 0.65 x size tall), "position": [x, y, z] (centre), "depth": extrusion 0 to 1, "bevel": 0 to 1, "material": "metal"|"chrome"|"gloss"|"matte"|"glass"|"neon", "color": hex,
    "enter": "spinIn"|"rise"|"drop"|"pop"|"scale"|"none", "enterAt": seconds, "enterFor": seconds, "idle": "float"|"none", "face": 0 to 1 (how much it turns to the camera),
    "weight": "bold"|"regular", "plate": null or hex (a flat label on a rounded bar of that colour, for the phone number or a call to action) },
  "props": up to 12 of { "kind": "plinth"|"sphere"|"ring"|"box"|"cylinder", "position": [x, y, z] (sphere and ring: centre; others: bottom centre), "size": diameter or width, "height": for plinth, box, cylinder,
    "material": as texts, "color": hex, "enter": as texts, "enterAt", "enterFor", "idle": "float"|"spin"|"swing"|"none" },
  "particles": up to 3 of { "kind": "confetti"|"sparkles"|"bubbles"|"dust", "count": 10 to 80, "colors": [hex], "center": [x, y, z], "area": [width, depth, height], "speed": 0.3 to 1.5 },
  "look": { "contrast": "medium"|"high"|"punchy"|"base", "exposure": -1 to 1, "bloom": 0 to 1 },
  "sound": { "voiceAt": seconds when the voice-over starts (0.2 to 1; the voice and music files are added by the studio) }
}
Framing: in 9:16 at distance 10 with lens 50 the frame is about 4 wide and 7 tall around the target; keep everything within x -1.6 to 1.6. Keep texts in front of the product (y -0.2 to -2) or above it, never inside it or a plinth. Use the brand colours.`;
