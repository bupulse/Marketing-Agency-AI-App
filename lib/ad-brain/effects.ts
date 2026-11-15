// The Ad Brain's effects library (docs/AD_BRAIN.md, section 6): every effect the renderer (tools/ad-render/effects.py)
// can draw, its parameters and where it fits. The brain picks effects by id, the EDL stores their parameters, the
// renderer looks them up in the same registry (a test checks both lists match). Pure: no server imports.
//
// Kinds:
//   segment     drawn on a segment's picture (a clip, a still): glitch, shake, freeze, grades...
//   transition  how a segment comes in (segment.transitionIn): scan wipe, flash, whip-pan
//   screen      how a REAL screen capture is shown (hard rule 1: screens are always real captures)
//   title       a title style (titles[].style)
//   caption     a caption style (captions.style)
//   audio       a sound treatment (a voice line's effects, or the music's beat grid)

export type EffectKind = "segment" | "transition" | "screen" | "title" | "caption" | "audio";
/** Pictures a segment can show; "split" is an actor on top and a real screen below, "wall" the poster wall of ad cards. */
export type SegmentSource = "ai_clip" | "ai_still_fx" | "real_screen" | "brand_card" | "end_card" | "split" | "wall";
export const SEGMENT_SOURCES: readonly SegmentSource[] = ["ai_clip", "ai_still_fx", "real_screen", "brand_card", "end_card", "split", "wall"];

export type ParamSpec =
  | { type: "number"; min: number; max: number; default: number }
  | { type: "enum"; values: readonly string[]; default: string }
  | { type: "bool"; default: boolean }
  | { type: "text"; max: number; default: string };

export type EffectDef = {
  id: string;
  name: string;
  kind: EffectKind;
  /** Segment sources it may be drawn on (segment and screen kinds). */
  sources?: readonly SegmentSource[];
  params: Record<string, ParamSpec>;
  /** May be one of the ad's 3 to 5 signature effects (the ones that make it look different from the last ads). */
  signature: boolean;
  /** One of the ~12 core effects ported from the prototypes first. */
  core: boolean;
  /** One line for the brain's prompt. */
  describe: string;
  /** The sound effect that goes with it by default, if any. */
  sfx?: SfxKind;
};

export type SfxKind = "whoosh" | "boom" | "glitch" | "scratch" | "rewind" | "typewriter" | "click" | "crash" | "riser";
export const SFX_KINDS: readonly SfxKind[] = ["whoosh", "boom", "glitch", "scratch", "rewind", "typewriter", "click", "crash", "riser"];

const PICTURE: readonly SegmentSource[] = ["ai_clip", "ai_still_fx"];
const ANY_VISUAL: readonly SegmentSource[] = ["ai_clip", "ai_still_fx", "real_screen", "brand_card", "split"];

export const EFFECTS: readonly EffectDef[] = [
  // ---- On a segment's picture ---------------------------------------------------------------------------------------
  { id: "rgb_split", name: "RGB split glitch", kind: "segment", sources: ANY_VISUAL, core: true, signature: true, sfx: "glitch", describe: "colour channels torn apart for a digital glitch; strongest at the cut, fading out", params: { amount: { type: "number", min: 2, max: 30, default: 12 }, seconds: { type: "number", min: 0.05, max: 3, default: 0.3 } } },
  { id: "slice_glitch", name: "Slice displacement", kind: "segment", sources: ANY_VISUAL, core: true, signature: true, sfx: "glitch", describe: "horizontal slices of the picture jump sideways, like a broken signal", params: { strength: { type: "number", min: 0.1, max: 1, default: 0.6 }, seconds: { type: "number", min: 0.05, max: 2, default: 0.35 } } },
  { id: "camera_shake", name: "Camera shake", kind: "segment", sources: ANY_VISUAL, core: true, signature: true, sfx: "boom", describe: "a hit that shakes the camera, then settles", params: { amp: { type: "number", min: 2, max: 30, default: 12 }, seconds: { type: "number", min: 0.1, max: 2, default: 0.5 } } },
  { id: "punch_in", name: "Punch-in on cut", kind: "segment", sources: ANY_VISUAL, core: true, signature: true, describe: "the picture starts zoomed in and snaps back, so every cut lands", params: { zoom: { type: "number", min: 1.02, max: 1.3, default: 1.08 }, seconds: { type: "number", min: 0.1, max: 1, default: 0.3 } } },
  { id: "freeze_frame", name: "Freeze-frame", kind: "segment", sources: PICTURE, core: true, signature: true, sfx: "scratch", describe: "the picture freezes, colour drains to grey with film grain and a vignette (\"Yep, that's me\")", params: { at: { type: "number", min: 0, max: 0.9, default: 0.3 }, drain: { type: "number", min: 0, max: 1, default: 0.75 }, grain: { type: "number", min: 0, max: 30, default: 12 } } },
  { id: "tape_rewind", name: "Tape rewind", kind: "segment", sources: PICTURE, core: true, signature: true, sfx: "rewind", describe: "VHS rewind streaks, REWIND label and a running timecode, with a typewriter line such as \"3 HOURS EARLIER\"", params: { label: { type: "text", max: 28, default: "EARLIER THAT DAY" } } },
  { id: "night_grade", name: "Night grade + timestamp", kind: "segment", sources: PICTURE, core: true, signature: true, describe: "cold blue night colour, grain and a camcorder timestamp in the corner", params: { stamp: { type: "text", max: 12, default: "11:47 PM" } } },
  { id: "scanlines", name: "Robot scan-lines", kind: "segment", sources: PICTURE, core: true, signature: true, describe: "fine scan-lines, a little less colour and a rare flicker: a machine is talking", params: { alpha: { type: "number", min: 5, max: 80, default: 26 }, desat: { type: "number", min: 0, max: 0.8, default: 0.2 } } },
  { id: "debris", name: "Debris particles", kind: "segment", sources: PICTURE, core: false, signature: true, sfx: "crash", describe: "chunks of plaster or paper flying and falling with gravity", params: { count: { type: "number", min: 8, max: 60, default: 34 } } },
  { id: "bounce_cam", name: "Bouncing camera", kind: "segment", sources: PICTURE, core: false, signature: true, describe: "the picture bounces up and down on the beat (a celebration), then a fast push-in", params: { height: { type: "number", min: 10, max: 80, default: 46 }, speed: { type: "number", min: 0.5, max: 3, default: 1.6 } } },
  { id: "slow_push", name: "Slow push-in", kind: "segment", sources: ANY_VISUAL, core: false, signature: false, describe: "a slow steady zoom (keeps stills alive)", params: { zoom: { type: "number", min: 1.0, max: 1.25, default: 1.06 } } },

  // ---- How a segment comes in ---------------------------------------------------------------------------------------
  { id: "cut", name: "Straight cut", kind: "transition", core: true, signature: false, describe: "a plain cut", params: {} },
  { id: "scan_wipe", name: "Scan-line wipe", kind: "transition", core: true, signature: true, sfx: "glitch", describe: "a glowing scan line sweeps over the picture and leaves the next scene behind it, with glitches (a transformation)", params: { direction: { type: "enum", values: ["down", "up"], default: "down" }, color: { type: "enum", values: ["cyan", "pink", "brand"], default: "cyan" } } },
  { id: "white_flash", name: "White flash", kind: "transition", core: true, signature: true, sfx: "boom", describe: "a white flash on the cut, best on a beat drop", params: {} },
  { id: "whip_pan", name: "Whip-pan", kind: "transition", core: true, signature: true, sfx: "whoosh", describe: "a fast blurred sideways pan from one shot into the next", params: {} },
  { id: "wall_expand", name: "Wall card expands", kind: "transition", core: false, signature: false, sfx: "whoosh", describe: "the picked card on the poster wall grows into the full-screen clip", params: {} },
  { id: "wall_collapse", name: "Clip shrinks into the wall", kind: "transition", core: false, signature: false, describe: "the clip shrinks back into its card on the poster wall", params: {} },

  // ---- Layouts and overlays added with the research formats (11 Nov 2026) ----------------------------------------------
  { id: "poster_wall", name: "Poster wall", kind: "segment", sources: ["wall"], core: false, signature: true, sfx: "riser", describe: "a streaming-style wall of ad cards; columns spin like a slot machine with motion blur and decelerating ticks, the picked card glows blue-violet", params: {} },
  { id: "timer", name: "Honest challenge timer", kind: "segment", sources: ["real_screen", "split", "ai_clip"], core: false, signature: true, sfx: "click", describe: "a countdown clock in the corner that runs with the video, labelled \"sped up\" (never a faked time)", params: { from: { type: "number", min: 10, max: 120, default: 60 }, start: { type: "number", min: 0, max: 60, default: 0 }, label: { type: "text", max: 12, default: "SPED UP" } } },

  // ---- How a REAL screen capture is shown ---------------------------------------------------------------------------
  { id: "browser_window", name: "Browser window drift", kind: "screen", sources: ["real_screen"], core: true, signature: true, describe: "the real screenshot in a floating browser window with a slow 3D drift and push-in, on a dark tech grid", params: { zoom: { type: "number", min: 1, max: 1.4, default: 1.15 }, fx: { type: "number", min: 0, max: 1, default: 0.5 }, fy: { type: "number", min: 0, max: 1, default: 0.4 } } },
  { id: "filmed_monitor", name: "Phone-filmed monitor", kind: "screen", sources: ["real_screen"], core: true, signature: true, describe: "the real screenshot looks filmed off a monitor with a phone: perspective, moiré, glare, handheld drift, focus pull", params: {} },
  { id: "tap_ripple", name: "Tap ripple", kind: "screen", sources: ["real_screen"], core: true, signature: true, sfx: "click", describe: "a finger-tap ripple pinned to a real button on the screen (needs the segment's tap point)", params: {} },

  // ---- Titles and captions -------------------------------------------------------------------------------------------
  { id: "slam", name: "Kinetic slam title", kind: "title", core: true, signature: true, sfx: "boom", describe: "a bold skewed title slams in big and settles, with a shadow", params: {} },
  { id: "typewriter", name: "Typewriter text", kind: "title", core: true, signature: true, sfx: "typewriter", describe: "a line types itself on a black strip with a blinking cursor", params: {} },
  { id: "pop", name: "One-word pop", kind: "title", core: false, signature: false, describe: "one big yellow word pops in", params: {} },
  { id: "list", name: "Numbered list title", kind: "title", core: false, signature: false, describe: "a numbered tip (\"1. POST EVERY WEEK\") slides in on a card in the top third with a tick", params: {} },
  { id: "karaoke", name: "Word-by-word captions", kind: "caption", core: true, signature: false, describe: "CapCut-style captions, three words at a time, the spoken word in yellow", params: {} },
  { id: "one_word", name: "One-word pop captions", kind: "caption", core: true, signature: false, describe: "each spoken word pops alone, big, in the middle", params: {} },

  // ---- Sound ---------------------------------------------------------------------------------------------------------
  { id: "robot_voice", name: "Robot voice", kind: "audio", core: true, signature: true, describe: "the line sounds like a machine (pitch, robotize, echo)", params: {} },
  { id: "beat_cut", name: "Beat-grid cutting", kind: "audio", core: true, signature: true, describe: "after the beat drop the real screens cut on every bar of the music", params: {} },
];

const BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));
export const effectById = (id: string): EffectDef | undefined => BY_ID.get(id);
export const effectsOfKind = (kind: EffectKind) => EFFECTS.filter((e) => e.kind === kind);
export const SIGNATURE_EFFECTS = EFFECTS.filter((e) => e.signature).map((e) => e.id);
export const TITLE_STYLES = effectsOfKind("title").map((e) => e.id);
export const CAPTION_STYLES = [...effectsOfKind("caption").map((e) => e.id), "none"];

/**
 * Checks one effect's parameters against its definition: unknown names and out-of-range values are errors (the brain
 * may be wrong; the renderer must never guess). Returns plain-English problems, empty when fine.
 */
export function checkParams(id: string, params: Record<string, unknown> | undefined): string[] {
  const def = BY_ID.get(id);
  if (!def) return [`"${id}" is not an effect in the library.`];
  const out: string[] = [];
  for (const [name, value] of Object.entries(params ?? {})) {
    const spec = def.params[name];
    if (!spec) {
      out.push(`${id}: "${name}" is not one of its settings.`);
      continue;
    }
    if (spec.type === "number" && (typeof value !== "number" || !Number.isFinite(value) || value < spec.min || value > spec.max)) out.push(`${id}: ${name} must be a number from ${spec.min} to ${spec.max}.`);
    if (spec.type === "enum" && (typeof value !== "string" || !spec.values.includes(value))) out.push(`${id}: ${name} must be one of ${spec.values.join(", ")}.`);
    if (spec.type === "bool" && typeof value !== "boolean") out.push(`${id}: ${name} must be true or false.`);
    if (spec.type === "text" && (typeof value !== "string" || value.length > spec.max)) out.push(`${id}: ${name} must be text of at most ${spec.max} characters.`);
  }
  return out;
}

/** The effect's parameters with defaults filled in (what the renderer receives). */
export function withDefaults(id: string, params: Record<string, unknown> = {}): Record<string, number | string | boolean> {
  const def = BY_ID.get(id);
  const out: Record<string, number | string | boolean> = {};
  if (!def) return out;
  for (const [name, spec] of Object.entries(def.params)) out[name] = (params[name] as number | string | boolean | undefined) ?? spec.default;
  return out;
}

// ---- Choosing the signature effects ---------------------------------------------------------------------------------

/** A small seeded random generator (mulberry32), so a job's choices can be replayed and tested. */
export function seededRandom(seed: string | number): () => number {
  let h = typeof seed === "number" ? seed >>> 0 : 2166136261;
  if (typeof seed === "string") for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How alike two effect combinations are (Jaccard: shared / all), 0 to 1. */
export function comboSimilarity(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const all = new Set([...A, ...B]);
  if (all.size === 0) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared += 1;
  return shared / all.size;
}

/** Two combinations at least this alike count as "the same look" and are not used again. */
export const COMBO_TOO_CLOSE = 0.6;
/** How many past ads' combinations are avoided. */
export const RECENT_COMBOS = 8;

/**
 * Picks the ad's 3 to 5 signature effects from those the recipe can place, avoiding the last ads' combinations (none
 * may be COMBO_TOO_CLOSE or more alike) and favouring effects used least recently. `required` effects (the recipe's
 * own, e.g. the twist's scan wipe) are always in. Deterministic for a given `rng`. Throws when no new combination is
 * left (then the recipe is changed).
 */
export function pickEffects(input: { allowed: readonly string[]; required?: readonly string[]; recent: readonly (readonly string[])[]; count?: number; rng: () => number }): string[] {
  const count = Math.max(3, Math.min(5, input.count ?? 4));
  const required = [...new Set(input.required ?? [])].filter((id) => input.allowed.includes(id));
  const pool = [...new Set(input.allowed)].filter((id) => effectById(id)?.signature && !required.includes(id));
  const recent = input.recent.slice(0, RECENT_COMBOS);
  // Recency: an effect in the newest past ad weighs least.
  const lastSeen = (id: string) => {
    const i = recent.findIndex((c) => c.includes(id));
    return i === -1 ? recent.length + 2 : i;
  };
  const weight = (id: string) => 1 + lastSeen(id) * 2;
  for (let attempt = 0; attempt < 200; attempt++) {
    const chosen = [...required];
    const left = [...pool];
    while (chosen.length < count && left.length) {
      const total = left.reduce((s, id) => s + weight(id), 0);
      let r = input.rng() * total;
      let at = 0;
      for (; at < left.length - 1; at++) {
        r -= weight(left[at]);
        if (r <= 0) break;
      }
      chosen.push(left.splice(at, 1)[0]);
    }
    if (chosen.length < 3) break;
    if (recent.every((c) => comboSimilarity(chosen, c) < COMBO_TOO_CLOSE)) return chosen;
  }
  throw new Error("No new effect combination is left for this format.");
}
