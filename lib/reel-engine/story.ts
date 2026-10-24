// The temporary reel engine's story (docs/REEL_ENGINE.md): a 30-second reel is 4 clips of 8 seconds by Google's video
// model in story order (hook, in use, result, call to action), each a variant the company has not had lately, each filmed
// from a start frame made by the image engine (so the company's presenter and the real product stay the same), with its
// own camera move and a spoken line. Then it is edited like a viral reel (buildReelSpec: a punch-in inside every clip,
// flash and whip cuts on the music's beat, captions that pop in word by word, a hook sticker, the brand, the contact and
// the price at the end) and encoded in the browser by lib/video-engine/encode.ts. Pure and client-safe, so it is tested.
// Owner's direction (23 October 2026): human, fun and interactive like real viral reels, real physics, the product in
// the place it is really used, and rules that work for any business, not only the first test company.
import type { Layer, MotionSpec, Scene, TextLayer, Transition, VideoLayer } from "@/lib/video-engine/spec";

export const REEL_LANGUAGES = ["Kinyarwanda", "English"] as const;
export type ReelLanguage = (typeof REEL_LANGUAGES)[number];
export type ReelTier = "lite" | "fast";
export const CLIP_SECONDS = 8;
/** On average each clip shows 7.5 of its 8 seconds, so 4 clips make exactly 30 seconds (the engine's limit). */
export const SCENE_SECONDS = 7.5;
export const REEL_SECONDS = 30;

export type BeatId = "hook" | "use" | "result" | "cta" | "broll";
export type Beat = { id: BeatId; label: string; variants: { id: string; idea: string; presenter: boolean }[] };

/**
 * The four beats, each with variants: the Director picks the ones the company had least. Learned from viral reels
 * (docs/VIRAL_RECIPES.md, and the owner's examples: a presenter walking up to a phone camera in a car showroom with quick
 * cuts and stickers; a comedy ad where the product is the payoff). Ideas the video model films badly are gone: close-ups
 * of fingers on small parts, crowds, many copies of the product.
 */
export const BEATS: readonly Beat[] = [
  {
    id: "hook",
    label: "Hook",
    variants: [
      { id: "walk-up", idea: "The presenter walks quickly towards the phone camera from beside the product, stops close with a big grin and says the hook with real energy.", presenter: true },
      { id: "struggle", idea: "A friend struggles with the everyday problem in a funny, relatable way (a small, gentle mishap, never dangerous); the presenter steps in beside them with a knowing look and speaks to camera.", presenter: true },
      { id: "question", idea: "The presenter looks straight into the camera, raises an eyebrow and asks a question the customer has every day.", presenter: true },
      { id: "reveal", idea: "The presenter pulls a cloth off the product in one clean move (the cloth slides off, the product stays still) and turns to camera, speaking.", presenter: true },
    ],
  },
  {
    id: "use",
    label: "In use",
    variants: [
      { id: "demo", idea: "The presenter shows one clear, simple action with the product, her hand firmly on it, while talking to camera.", presenter: true },
      { id: "walkthrough", idea: "The presenter walks around the product in its real place, showing it working, talking as they go.", presenter: true },
      { id: "customer-try", idea: "One local customer tries the product for the first time while the presenter guides them; one simple action.", presenter: true },
      { id: "working", idea: "A medium shot of the product working in its real place, one or two people around it, while the presenter explains in a voice-over.", presenter: false },
    ],
  },
  {
    id: "result",
    label: "Result",
    variants: [
      { id: "reaction", idea: "One customer's genuine, happy reaction to what the product gave them: a laugh or a surprised face, medium close-up, the product beside them.", presenter: false },
      { id: "before-after", idea: "The same place before and after the product: the change is clear (never bodies or health).", presenter: false },
      { id: "family", idea: "A local family or team enjoys what the product gave them, at home or at work, natural and unposed; the product in the background as it really is.", presenter: false },
    ],
  },
  {
    id: "cta",
    label: "Call to action",
    variants: [
      { id: "comment", idea: "The presenter, next to the product, playfully asks viewers to comment one word or send a message now, pointing at the camera with a smile.", presenter: true },
      { id: "point", idea: "The presenter stands next to the product and tells viewers exactly what to do next, pointing to it.", presenter: true },
      { id: "shop", idea: "The presenter at the business's place, with the product, invites viewers to come or to message now.", presenter: true },
      { id: "hand-over", idea: "The presenter hands the product (or what it made) to a smiling customer and turns to the camera with the next step.", presenter: true },
    ],
  },
];

/**
 * The product shots (B-roll) a viral reel cuts to: 4-second clips with no talking, a bold camera move and a whoosh,
 * learned from the owner's example (a car seller's reel: fast spins round the car, low-angle reveals, details, the
 * presenter talking in between). Never hands on small parts, never the product changing.
 */
export const BROLL_SHOTS = [
  { id: "spin", idea: "The camera circles fast around the product on a tilted (dutch) angle and settles square on it; the product stays still and whole." },
  { id: "low-reveal", idea: "From the ground, the camera tilts up the whole product to the sky behind it, slow then fast." },
  { id: "detail", idea: "A slow push-in on the product's best detail (its texture, what it holds, what it makes), no hands." },
  { id: "in-place", idea: "A whip pan lands on the product in its real place, working, the presenter or a customer smiling beside it." },
  { id: "result", idea: "A close look at what the product gives (the fresh result, the finished look), lit by the sun, a little movement." },
] as const;

export const REEL_CAMERAS = [
  "handheld phone camera walking backwards in front of the subject",
  "handheld phone camera at eye level, gentle natural shake",
  "slow push-in towards the subject",
  "locked-off shot at eye level, the subject moves",
  "slow orbit around the subject",
  "low angle tilting up",
  "slow sideways move",
] as const;

export type ReelClip = {
  beat: BeatId;
  variant: string;
  camera: string;
  presenter: boolean;
  /** For the start frame (image engine): who, where, the product, the light. No words. */
  frame: string;
  /** For the video model: the action and the camera move over 8 seconds. */
  motion: string;
  /** What is said, in the reel's language (spoken by the video model, and the caption on screen). */
  line: string;
  /** One or two words of the line painted in the brand colour in the caption. */
  stress?: string[];
  /** A talking clip (8 s, the presenter or a voice speaks) or a product shot (4 s, no talking). Old reels: talking. */
  kind?: "talk" | "broll";
  /** How long the clip is filmed (4 or 8 s; old reels: 8). */
  seconds?: number;
  framePath?: string | null;
  operation?: string | null;
  clipPath?: string | null;
  /** "checking": the clip is saved and the Checker watches it in the next step. */
  status: "planned" | "framed" | "filming" | "checking" | "done" | "failed";
  error?: string | null;
  /** How many times the video model refused this clip (a refusal costs nothing, so it is sent again, up to 2 times). */
  tries?: number;
  /** Google was at its limit: the clip waits until this time (ms) before it is sent again; the wait is not a try. */
  retryAt?: number | null;
  /** When Google first said it was at its limit for this clip (ms); after BUSY_GIVE_UP_MS of that the clip fails. */
  busySince?: number | null;
  /** The Checker found slop in the first start frame: the next one is painted and kept as it is. */
  repainted?: boolean;
  /** What the clip checker saw wrong in an earlier take, told to the video model on the next one. */
  avoid?: string[];
  /** What the clip checker saw in the take that was kept (empty when it passed). */
  problems?: string[];
};

export type ReelPlan = {
  title: string;
  caption: string;
  hashtags: string[];
  music: string | null;
  clips: ReelClip[];
  presenter: string;
  /** The product's price from Business info, shown as text on the last scene (Google refuses it spoken). */
  price?: string | null;
  /** A sticker on the hook, at most 4 words in the reel's language ("No land? No problem."). */
  hook?: string | null;
  /** Where the product is really used, for every clip (a greenhouse, a salon chair, a showroom). */
  setting?: string | null;
  /** How many clips the checker sent back to be filmed again (at most MAX_REFILMS a reel). */
  refilms?: number;
  /** The viral videos the reel borrowed its techniques from (ids of docs/research/viral). */
  sources?: string[];
  /** The product's name as a big sticker in the montage, at most 3 words ("LEAF TOWER"). */
  tag?: string | null;
  /**
   * The one product photo every start frame is painted from (a Storage path in "media"). A product's album can show
   * several models (LEAF's Hydro Tower album has 8 different towers), and one reel shows one of them: the round-3
   * montage took the next photo for each clip and showed a different tower in every shot.
   */
  productPhoto?: string | null;
};

/** Least used first, ties broken by the seed; never twice in a reel. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The owner's taste from the Training Lab (lib/training-lab/director.ts labPreferences): variant keys ("hook:walk-up",
 * "broll:spin") and REEL_CAMERAS entries to lean towards, and ones never to use.
 */
export type DirectorTaste = { prefer?: readonly string[]; avoid?: readonly string[] };

/** The options without the avoided ones, unless that leaves none (then all of them). */
const allowed = <T>(options: T[], id: (o: T) => string, avoid: ReadonlySet<string>): T[] => {
  const kept = avoid.size ? options.filter((o) => !avoid.has(id(o))) : options;
  return kept.length ? kept : options;
};

/**
 * The Director: one variant per beat and a camera move per clip, those the company had least (recent: newest first).
 * With the owner's taste, a tie on "least used" goes to a preferred one, and an avoided one is never picked while
 * another is left. Without it the plan is the same as ever for the same seed.
 */
export function directReel(recent: readonly { variant: string; camera: string }[], seed: string, taste: DirectorTaste = {}): Pick<ReelClip, "beat" | "variant" | "camera" | "presenter">[] {
  const used = (key: "variant" | "camera", v: string) => recent.reduce((s, r, i) => s + (r[key] === v ? Math.pow(0.9, i) : 0), 0);
  const prefer = new Set(taste.prefer ?? []);
  const avoid = new Set(taste.avoid ?? []);
  const liked = (id: string) => (prefer.has(id) ? 1 : 0);
  const cams: string[] = [];
  return BEATS.map((beat, i) => {
    const key = (v: { id: string }) => `${beat.id}:${v.id}`;
    const variant = allowed([...beat.variants], key, avoid).sort((a, b) => used("variant", key(a)) - used("variant", key(b)) || liked(key(b)) - liked(key(a)) || hash(`${seed}:${i}:${a.id}`) - hash(`${seed}:${i}:${b.id}`))[0];
    const camera = allowed([...REEL_CAMERAS].filter((c) => !cams.includes(c)), (c) => c, avoid).sort((a, b) => used("camera", a) - used("camera", b) || liked(b) - liked(a) || hash(`${seed}:c${i}:${a}`) - hash(`${seed}:c${i}:${b}`))[0];
    cams.push(camera);
    return { beat: beat.id, variant: key(variant), camera, presenter: variant.presenter };
  });
}

export const variantOf = (key: string): { id: string; idea: string; presenter: boolean } | null => {
  const [beatId, id] = key.split(":");
  if (beatId === "broll") {
    const shot = BROLL_SHOTS.find((b) => b.id === id);
    return shot ? { id: shot.id, idea: shot.idea, presenter: false } : null;
  }
  return BEATS.find((b) => b.id === beatId)?.variants.find((v) => v.id === id) ?? null;
};

export const BROLL_SECONDS = 4;

/**
 * The montage Director (the owner's viral example): 3 talking clips (the hook, how it works, the call to action) and
 * 4 product shots between them, each the variant and camera the company had least (with the owner's Lab taste: ties
 * go to preferred ones, avoided ones only when nothing else is left). Clip order is story order: hook, 2 shots, how it
 * works, 2 shots, call to action.
 */
export function directMontage(recent: readonly { variant: string; camera: string }[], seed: string, taste: DirectorTaste = {}): Pick<ReelClip, "beat" | "variant" | "camera" | "presenter" | "kind" | "seconds">[] {
  const talk = directReel(recent, seed, taste).filter((b) => b.beat !== "result").map((b) => ({ ...b, kind: "talk" as const, seconds: CLIP_SECONDS }));
  const used = (v: string) => recent.reduce((s, r, i) => s + (r.variant === v ? Math.pow(0.9, i) : 0), 0);
  const prefer = new Set(taste.prefer ?? []);
  const liked = (id: string) => (prefer.has(id) ? 1 : 0);
  // Four of the five shots: an avoided one only when fewer than four are left without it.
  const avoid = new Set(taste.avoid ?? []);
  const free = BROLL_SHOTS.filter((b) => !avoid.has(`broll:${b.id}`));
  const pool = free.length >= 4 ? [...free] : [...free, ...BROLL_SHOTS.filter((b) => avoid.has(`broll:${b.id}`))];
  const order = (list: typeof pool) => list.sort((a, b) => used(`broll:${a.id}`) - used(`broll:${b.id}`) || liked(`broll:${b.id}`) - liked(`broll:${a.id}`) || hash(`${seed}:b:${a.id}`) - hash(`${seed}:b:${b.id}`));
  const shots = (free.length >= 4 ? order(pool) : [...order([...free]), ...order(pool.slice(free.length))]).slice(0, 4);
  const broll = shots.map((s) => ({ beat: "broll" as const, variant: `broll:${s.id}`, camera: "a bold, smooth move as described", presenter: false, kind: "broll" as const, seconds: BROLL_SECONDS }));
  return [talk[0], broll[0], broll[1], talk[1], broll[2], broll[3], talk[2]];
}

const MONEY = /amafaranga|igiciro|ibihumbi|miliyoni|\b(rwf|frw|francs?|price|prices|priced|cost|costs|usd|dollars?)\b|\$|€|£/i;

/**
 * The words that may be spoken: Google's video model refuses a clip whose spoken line says a price (first test, 23
 * October 2026: "Iboneka ku mafaranga ibihumbi magana abiri na mirongo itanu…" refused 5 times, the same clip without
 * that sentence filmed at once). So a sentence about money is never spoken; the price is in the caption.
 */
export function spokenLine(line: string): string {
  return (line.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s && !MONEY.test(s))
    .join(" ");
}

/**
 * The rules every clip is filmed by (the owner, after the first test: "it has AI slop… it doesn't obey physics… you
 * don't see hands touching the leaf and you can see people passing through products"; "make it feel human").
 */
export const CLIP_RULES = [
  "Filmed on a phone by a friend: handheld at eye level, natural light, a little natural shake; it feels like a real social video, not a cinematic ad.",
  "Real-world physics in every moment: every touch makes contact (fingers press on what they touch and it bends or moves), people walk around objects and never through them or through each other, objects keep their size, shape and number, nothing appears, melts or vanishes.",
  "At most two people in the frame and no crowd in the background. Hands stay simple: no close-ups of fingers on small parts.",
  "One continuous shot from the first frame to the last: no cuts, no jumps, the same people and the same product all through, exactly one of it, its shape unchanged.",
  "Sound: the speech, and crisp real sounds of what happens (steps, water, leaves, a door, a click), a quick whoosh on a fast camera move. No music.",
  "Real skin texture and true-to-life colour. No text, captions, subtitles or logos added. No cameras, phones on stands, tripods, microphones or lights in the frame: the camera is never seen.",
];

/** The video model's prompt for one clip: the place, the action and camera, the line spoken, the rules, what to avoid. */
export function veoClipPrompt(clip: Pick<ReelClip, "motion" | "line" | "camera" | "presenter" | "avoid" | "kind" | "seconds">, language: ReelLanguage, setting?: string | null): string {
  const line = clip.kind === "broll" ? "" : spokenLine(clip.line);
  const speech = clip.kind === "broll"
    ? "No talking. Only the natural sound of the place and a quick whoosh on the fast camera move."
    : line
    ? clip.presenter
      ? `The presenter speaks to the camera in ${language}, clearly, warmly and with energy, lips in sync: "${line}"`
      : `A warm, lively voice-over says in ${language}: "${line}"`
    : "Only the natural sound of the place.";
  return [
    `A vertical 9:16 video clip of about ${clip.seconds ?? CLIP_SECONDS} seconds${setting ? `, in ${setting}` : ""}. ${clip.motion} Camera: ${clip.camera}.`,
    speech,
    ...CLIP_RULES,
    clip.avoid?.length ? `The last take went wrong, so avoid exactly this: ${clip.avoid.slice(0, 4).join("; ")}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The words that may be shown as a caption: the line, clipped to two short lines. */
export const subtitleOf = (line: string) => spokenLine(line).replace(/\s+/g, " ").trim().slice(0, 140);

/** The beat of the music (seconds between beats and the first beat), found in the browser (beats.ts), or none. */
export type MusicBeat = { period: number; offset: number } | null;

/** The beat nearest to `t` within [lo, hi], else `t` clamped (no beat known: the plain times). */
export function snapToBeat(t: number, lo: number, hi: number, beat: MusicBeat): number {
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  if (!beat || !(beat.period > 0.2 && beat.period < 2)) return clamp(t);
  const n = Math.round((t - beat.offset) / beat.period);
  for (const k of [n, n - 1, n + 1]) {
    const snapped = beat.offset + k * beat.period;
    if (snapped >= lo && snapped <= hi) return snapped;
  }
  return clamp(t);
}

/**
 * Where the edits fall: the 4 clips' lengths (each 6.8 to 8 s, 30 s in all) and two cuts inside each clip (3 shots of
 * about 2.5 s, the pace of the owner's viral example), all on the music's beat when it is known. The first cut comes
 * fast (about 1.8 s), the hook's pattern interrupt.
 */
export function reelCuts(beat: MusicBeat): { lengths: number[]; cuts: [number, number][] } {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const bounds = [0];
  for (let i = 1; i < 4; i++) bounds.push(snapToBeat(i * SCENE_SECONDS, Math.max(bounds[i - 1] + 6.8, REEL_SECONDS - (4 - i) * CLIP_SECONDS), bounds[i - 1] + CLIP_SECONDS, beat));
  bounds.push(REEL_SECONDS);
  const lengths = bounds.slice(1).map((b, i) => r2(b - bounds[i]));
  const cuts = lengths.map((len, i): [number, number] => {
    const first = snapToBeat(bounds[i] + (i === 0 ? 1.8 : len / 3), bounds[i] + 1.2, bounds[i] + len - 3, beat) - bounds[i];
    const second = snapToBeat(bounds[i] + (i === 0 ? (first + len) / 2 : (2 * len) / 3), bounds[i] + first + 1.2, bounds[i] + len - 1.2, beat) - bounds[i];
    return [r2(first), r2(second)];
  });
  return { lengths, cuts };
}

const BETWEEN: Transition[] = ["flash", "whip", "zoom"];

/**
 * The finished reel as a motion spec for the browser encoder, edited like a viral reel: each clip is three shots of the
 * same moving clip (its sound runs straight through): as filmed, a 30% punch-in, then a medium crop; flash, whip and zoom
 * cuts between clips on the beat; the line as a big caption that pops in word by word, a few words a shot, with its key
 * words in the brand colour; the hook sticker; at the end the business name, then the price, then how to reach it, one
 * after the other so they do not compete.
 */
export function buildReelSpec(plan: ReelPlan, clipUrls: string[], brand: { name: string; color: string; contact?: string | null }, beat: MusicBeat = null): MotionSpec {
  if (plan.clips.some((c) => c.kind === "broll")) return buildMontageSpec(plan, clipUrls, brand, beat);
  const text = (over: Partial<TextLayer> & Pick<TextLayer, "text" | "size" | "y" | "h">): TextLayer => ({
    kind: "text",
    font: "inter",
    weight: 900,
    color: "#FFFFFF",
    align: "center",
    x: 0.5,
    w: 0.86,
    shadow: true,
    ...over,
  });
  const { lengths, cuts } = reelCuts(beat);
  const scenes: Scene[] = [];
  plan.clips.forEach((clip, i) => {
    const words = subtitleOf(clip.line).split(" ").filter(Boolean);
    // The caption is split between the three shots, so each shows a few words at a time.
    const third = Math.ceil(words.length / 3);
    const parts = [0, 1, 2].map((k) => words.slice(k * third, (k + 1) * third).join(" "));
    const stress = (clip.stress ?? []).filter((w) => w.trim()).slice(0, 2);
    const [a, b] = cuts[i];
    const shots = [
      { start: 0, seconds: a, zoom: [1, 1.06] },
      { start: a, seconds: b - a, zoom: [1.3, 1.34] },
      { start: b, seconds: lengths[i] - b, zoom: [1.12, 1.16] },
    ];
    const last = shots.length - 1;
    shots.forEach((shot, s) => {
      const video: VideoLayer = { kind: "video", url: clipUrls[i], fit: "cover", start: shot.start, sound: true, x: 0.5, y: 0.5, w: 1, h: 1, keyframes: [{ at: 0, scale: shot.zoom[0] }, { at: 1, scale: shot.zoom[1] }] };
      const layers: Layer[] = [video];
      if (parts[s]) layers.push(text({ text: parts[s], size: 0.078, y: 0.66, h: 0.16, animate: "wordsPop", animateFor: Math.min(0.9, shot.seconds * 0.4), box: { color: "rgba(0,0,0,0.28)", padding: 0.015, radius: 0.02 }, highlight: stress.length ? { words: stress, color: "#FFE14D" } : null, from: 0.02 }));
      if (i === 0 && s === 0 && plan.hook?.trim())
        layers.push(text({ text: plan.hook.trim().slice(0, 40), size: 0.07, y: 0.18, h: 0.11, w: 0.82, uppercase: true, animate: "pop", animateFor: 0.35, box: { color: brand.color, padding: 0.025, radius: 0.03 }, keyframes: [{ at: 0, rotate: -3 }, { at: 1, rotate: -3 }] }));
      // The last clip's last two shots: the brand, then the price sticker; then how to reach the business on its own.
      if (i === plan.clips.length - 1 && s >= last - 1) {
        layers.push(text({ text: brand.name, size: 0.06, y: 0.11, h: 0.09, w: 0.8, animate: s === last - 1 ? "rise" : "none", box: { color: brand.color, padding: 0.025, radius: 0.04 } }));
        // The price as a sticker: buyers want it before they message, and only speaking it is refused.
        if (plan.price?.trim() && s === last - 1)
          layers.push(text({ text: plan.price.trim().slice(0, 40), size: 0.06, y: 0.22, h: 0.085, w: 0.7, animate: "pop", box: { color: "#FFFFFF", padding: 0.02, radius: 0.03 }, color: brand.color, shadow: false, from: 0.25, keyframes: [{ at: 0, rotate: 3 }, { at: 1, rotate: 3 }] }));
        // How to reach the business, so the call to action can be acted on (the first reel said "message us" with no number).
        if (brand.contact && s === last) layers.push(text({ text: brand.contact, size: 0.05, y: 0.22, h: 0.08, w: 0.84, animate: "pop", box: { color: brand.contact.startsWith("WhatsApp") ? "#1DA851" : "rgba(0,0,0,0.7)", padding: 0.022, radius: 0.04 }, from: 0.05 }));
      }
      const transition: Transition | undefined = scenes.length === 0 ? undefined : s > 0 ? "cut" : BETWEEN[(i - 1) % BETWEEN.length];
      scenes.push({ seconds: Math.round(shot.seconds * 100) / 100, background: { kind: "solid", colors: ["#000000"] }, layers, ...(transition ? { transition } : {}) });
    });
  });
  return { version: 1, title: plan.title, ratio: "9:16", fps: 30, palette: { background: "#000000", primary: brand.color, accent: brand.color, text: "#FFFFFF" }, scenes, music: plan.music, caption: plan.caption, hashtags: plan.hashtags };
}

/**
 * About what one reel costs the providers, from the price of an 8-second clip: 7 start frames (Nano Banana 2), 3
 * talking clips of 8 s and 4 product shots of 4 s (40 s of video), and the clip checks.
 */
export function reelCostUsd(clipUsd: number): number {
  return Math.round((7 * 0.067 + clipUsd * ((3 * CLIP_SECONDS + 4 * BROLL_SECONDS) / CLIP_SECONDS) + 0.03) * 100) / 100;
}

// ---- The montage edit (the owner's viral example) ----------------------------------------------------------------------

type Shot = { seconds: number; talk: { url: string; at: number } | null; show: { url: string; at: number; broll: boolean }; zoom: [number, number]; rotate?: number; words: string; stress: string[]; transition?: Transition };

/**
 * The montage as a motion spec: the hook (the presenter talking, with a product shot cut in on the beat while her voice
 * runs on), a product montage on the music (a cut every beat or two, spins and flashes, the product's name and the price
 * as big 3D stickers), how it works (talking, cutaways), then the call to action with the brand and how to reach it.
 * Talking clips play their sound under every shot of their section, so a cutaway never cuts the voice.
 */
export function buildMontageSpec(plan: ReelPlan, clipUrls: string[], brand: { name: string; color: string; contact?: string | null }, beat: MusicBeat = null): MotionSpec {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const talks = plan.clips.map((c, i) => ({ c, url: clipUrls[i] })).filter((x) => x.c.kind !== "broll");
  const rolls = plan.clips.map((c, i) => ({ c, url: clipUrls[i] })).filter((x) => x.c.kind === "broll");
  const step = beat && beat.period > 0.2 && beat.period < 2 ? (beat.period < 0.6 ? beat.period * 2 : beat.period) : 0.9;
  let rollAt = 0;
  const nextRoll = (len: number) => {
    const r = rolls[rollAt % Math.max(1, rolls.length)];
    // Each product shot is cut from a different moment of its 4 seconds, never past its end.
    const at = r2(((Math.floor(rollAt / Math.max(1, rolls.length)) * 1.3) % Math.max(0.1, BROLL_SECONDS - len - 0.2)) + 0.05);
    rollAt++;
    return { url: r?.url ?? clipUrls[0], at: Math.max(0, at), broll: true };
  };
  // Sections on the beat: hook 7.5 s, montage 7, how it works 7.5, call to action the rest (8 s at most).
  const b1 = snapToBeat(7.5, 6.8, 8, beat);
  const b2 = snapToBeat(b1 + 7, b1 + 6, b1 + 7.8, beat);
  const b3 = snapToBeat(b2 + 7.5, Math.max(b2 + 6.8, REEL_SECONDS - CLIP_SECONDS), b2 + 8, beat);
  const sections = [
    { kind: "talk" as const, from: 0, to: b1, talk: talks[0] },
    { kind: "montage" as const, from: b1, to: b2, talk: null },
    { kind: "talk" as const, from: b2, to: b3, talk: talks[1] },
    { kind: "talk" as const, from: b3, to: REEL_SECONDS, talk: talks[2] },
  ];
  const shots: Shot[] = [];
  sections.forEach((sec, si) => {
    const len = sec.to - sec.from;
    const first = shots.length;
    if (sec.kind === "montage" || !sec.talk) {
      // A cut every beat or two, each a different product shot, alternately spun and punched in.
      let t = 0;
      let n = 0;
      while (t < len - 0.01) {
        const d = len - t < step * 1.6 ? len - t : step;
        // Spun shots are zoomed enough that the tilt never shows the frame's edge.
        shots.push({ seconds: r2(d), talk: null, show: nextRoll(d), zoom: n % 2 ? [1.25, 1.15] : [1.24, 1.32], rotate: n % 2 ? 0 : n % 4 ? 5 : -5, words: "", stress: [], transition: n === 0 ? undefined : (["cut", "whip", "cut", "flash", "cut", "spin"] as Transition[])[n % 6] });
        t += d;
        n++;
      }
    } else {
      const talk = sec.talk;
      // Talking, with one or two product shots cut in on the beat while the voice runs on.
      // The presenter, a product shot (about a second), the presenter punched in, another product shot, the presenter:
      // each cut on the beat, every shot at most about 2.8 s (the call to action has one cutaway, then its end card).
      const plan = si === 0 ? [1.8, 0.95, 1.9, 0.95] : si === 3 ? [2.0, 0.95] : [2.0, 0.95, 1.9, 0.95];
      const marks = [0];
      for (const [k, gap] of plan.entries()) {
        const prev = marks[marks.length - 1];
        const t = snapToBeat(prev + gap, prev + (k % 2 ? 0.75 : 1.2), len - 1.2, beat);
        if (t <= prev + 0.5 || t >= len - 1.0) break;
        marks.push(t);
      }
      // A long last piece is split on the beat with a punch-in, so the presenter is never on screen 3 s without a cut.
      while (len - marks[marks.length - 1] > 2.8) {
        const prev = marks[marks.length - 1];
        marks.push(snapToBeat(prev + Math.min(2.4, (len - prev) / 2), prev + 1.2, len - 1.2, beat));
      }
      marks.push(len);
      for (let k = 0; k + 1 < marks.length; k++) {
        const d = marks[k + 1] - marks[k];
        const insert = k % 2 === 1 && k < plan.length;
        const punched = !insert && (k % 4 === 2 || (k >= plan.length && k % 2 === 1));
        shots.push({ seconds: r2(d), talk: { url: talk.url, at: r2(marks[k]) }, show: insert ? nextRoll(d) : { url: talk.url, at: r2(marks[k]), broll: false }, zoom: insert ? [1.12, 1.2] : punched ? [1.28, 1.32] : [1, 1.06], words: "", stress: talk.c.stress ?? [] });
      }
      // The caption runs over the section's shots, a few words a shot.
      const words = subtitleOf(talk.c.line).split(" ").filter(Boolean);
      const mine = shots.slice(first);
      let w = 0;
      mine.forEach((s, k) => {
        const take = k === mine.length - 1 ? words.length - w : Math.max(1, Math.round((words.length * s.seconds) / len));
        s.words = words.slice(w, w + take).join(" ");
        w += take;
      });
    }
    if (si > 0) shots[first].transition = (["flash", "whip", "zoom"] as Transition[])[si - 1];
  });

  const text = (over: Partial<TextLayer> & Pick<TextLayer, "text" | "size" | "y" | "h">): TextLayer => ({ kind: "text", font: "inter", weight: 900, color: "#FFFFFF", align: "center", x: 0.5, w: 0.86, shadow: true, ...over });
  const montage = { from: shots.findIndex((s) => !s.talk), to: shots.length - 1 - [...shots].reverse().findIndex((s) => !s.talk) };
  const ctaFrom = shots.length - shots.filter((s) => s.talk?.url === talks[2]?.url).length;
  const scenes: Scene[] = shots.map((s, i) => {
    const layers: Layer[] = [];
    // The talking clip's sound under the whole shot; drawn only when it is the picture.
    if (s.talk) layers.push({ kind: "video", url: s.talk.url, fit: "cover", start: s.talk.at, sound: true, x: 0.5, y: 0.5, w: 1, h: 1, keyframes: [{ at: 0, scale: s.zoom[0] }, { at: 1, scale: s.zoom[1] }] });
    if (!s.talk || s.show.broll) layers.push({ kind: "video", url: s.show.url, fit: "cover", start: s.show.at, sound: false, x: 0.5, y: 0.5, w: 1, h: 1, keyframes: [{ at: 0, scale: s.zoom[0], rotate: s.rotate ?? 0 }, { at: 1, scale: s.zoom[1], rotate: 0 }] });
    if (s.words) layers.push(text({ text: s.words, size: 0.078, y: 0.66, h: 0.16, animate: "wordsPop", animateFor: Math.min(0.8, s.seconds * 0.4), box: { color: "rgba(0,0,0,0.28)", padding: 0.015, radius: 0.02 }, highlight: s.stress.length ? { words: s.stress.slice(0, 2), color: "#FFE14D" } : null }));
    if (i === 0 && plan.hook?.trim()) layers.push(text({ text: plan.hook.trim().slice(0, 40), size: 0.07, y: 0.18, h: 0.11, w: 0.82, uppercase: true, animate: "pop", animateFor: 0.35, box: { color: brand.color, padding: 0.025, radius: 0.03 }, keyframes: [{ at: 0, rotate: -3 }, { at: 1, rotate: -3 }] }));
    // The montage's big 3D stickers: the product's name, then the price (written, never spoken).
    if (i >= montage.from && i <= montage.to && montage.from >= 0) {
      const half = montage.from + Math.ceil((montage.to - montage.from + 1) / 2);
      const tag = (plan.tag ?? "").trim().slice(0, 28);
      if (tag && i < half) layers.push(text({ text: tag, size: 0.1, y: 0.2, h: 0.14, w: 0.9, uppercase: true, color: "#FFD23F", animate: i === montage.from ? "zoom" : "none", text3d: { depth: 0.7, side: "#B3261E", bevel: true, spin: i === montage.from } }));
      if (plan.price?.trim() && i >= half) layers.push(text({ text: `+${plan.price.trim().slice(0, 30)}`, size: 0.085, y: 0.22, h: 0.12, w: 0.9, uppercase: true, color: "#39FF6A", animate: i === half ? "pop" : "none", text3d: { depth: 0.6, side: "#0B5D1E", bevel: true } }));
    }
    // The call to action: the brand, then how to reach the business on its own.
    if (i >= ctaFrom && talks[2]) {
      const late = i >= ctaFrom + Math.max(1, Math.floor((shots.length - ctaFrom) / 2));
      layers.push(text({ text: brand.name, size: 0.06, y: 0.11, h: 0.09, w: 0.8, animate: i === ctaFrom ? "rise" : "none", box: { color: brand.color, padding: 0.025, radius: 0.04 } }));
      if (brand.contact && late) layers.push(text({ text: brand.contact, size: 0.05, y: 0.22, h: 0.08, w: 0.84, animate: "pop", box: { color: brand.contact.startsWith("WhatsApp") ? "#1DA851" : "rgba(0,0,0,0.7)", padding: 0.022, radius: 0.04 } }));
    }
    return { seconds: s.seconds, background: { kind: "solid", colors: ["#000000"] }, layers, ...(i > 0 ? { transition: s.transition ?? "cut" } : {}) };
  });
  // Rounding never changes the length: the last shot takes what is left of the 30 seconds.
  const before = scenes.slice(0, -1).reduce((t, s) => t + s.seconds, 0);
  scenes[scenes.length - 1].seconds = r2(REEL_SECONDS - before);
  return { version: 1, title: plan.title, ratio: "9:16", fps: 30, palette: { background: "#000000", primary: brand.color, accent: brand.color, text: "#FFFFFF" }, scenes, music: plan.music, caption: plan.caption, hashtags: plan.hashtags, look: { grade: "vivid", glow: 0.12 } };
}
