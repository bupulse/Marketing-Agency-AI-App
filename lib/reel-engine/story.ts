// The temporary reel engine's story (docs/REEL_ENGINE.md): a 30-second reel is 4 Veo clips of 8 seconds in story order
// (hook, in use, result, call to action), each a variant the company has not had lately, each filmed from a start frame
// made by the image engine (so the company's presenter and the real product stay the same), with its own camera move and
// a spoken line. Then it is joined into one reel with subtitles and music (buildReelSpec, encoded in the browser by
// lib/video-engine/encode.ts). Pure and client-safe, so it is tested.
import type { Layer, MotionSpec, Scene, TextLayer } from "@/lib/video-engine/spec";

export const REEL_LANGUAGES = ["Kinyarwanda", "English"] as const;
export type ReelLanguage = (typeof REEL_LANGUAGES)[number];
export type ReelTier = "lite" | "fast";
export const CLIP_SECONDS = 8;
/** Each clip shows 7.5 of its 8 seconds, so 4 clips make exactly 30 seconds (the engine's limit). */
export const SCENE_SECONDS = 7.5;

export type BeatId = "hook" | "use" | "result" | "cta";
export type Beat = { id: BeatId; label: string; variants: { id: string; idea: string; presenter: boolean }[] };

/** The four beats, each with variants: the Director picks the ones the company had least. */
export const BEATS: readonly Beat[] = [
  {
    id: "hook",
    label: "Hook",
    variants: [
      { id: "question", idea: "The presenter looks straight into the camera and asks a question the customer has every day.", presenter: true },
      { id: "bold-claim", idea: "The presenter walks into frame holding the product and states one surprising, true fact about it.", presenter: true },
      { id: "problem", idea: "A customer struggles with the everyday problem the product solves; the presenter steps in and speaks to camera.", presenter: true },
      { id: "reveal", idea: "The presenter pulls a cloth off the product or opens a door to reveal it, speaking to camera.", presenter: true },
    ],
  },
  {
    id: "use",
    label: "In use",
    variants: [
      { id: "hands", idea: "Close shots of hands using the product step by step in its real place, while the presenter explains.", presenter: false },
      { id: "walkthrough", idea: "The presenter walks through the place showing the product working, talking as they go.", presenter: true },
      { id: "customer-try", idea: "A local customer tries the product for the first time while the presenter guides them.", presenter: true },
    ],
  },
  {
    id: "result",
    label: "Result",
    variants: [
      { id: "happy-customer", idea: "A happy local customer enjoys the result the product gave them, natural and unposed.", presenter: false },
      { id: "before-after", idea: "The same place before and after the product: the change is clear (never bodies or health).", presenter: false },
      { id: "scale", idea: "Many of the product at work in a bigger, busy setting with a team, showing it scales.", presenter: false },
    ],
  },
  {
    id: "cta",
    label: "Call to action",
    variants: [
      { id: "point", idea: "The presenter stands next to the product and tells viewers exactly what to do next, pointing to it.", presenter: true },
      { id: "shop", idea: "The presenter at the business's place, with the product, invites viewers to come or to message now.", presenter: true },
      { id: "hand-over", idea: "The presenter hands the product to a smiling customer and turns to the camera with the next step.", presenter: true },
    ],
  },
];

export const REEL_CAMERAS = [
  "slow push-in on a gimbal",
  "handheld, walking with the subject",
  "slow orbit around the subject",
  "static tripod, the subject moves",
  "low angle tilting up",
  "slow dolly sideways",
  "over-the-shoulder, then racking focus",
] as const;

export type ReelClip = {
  beat: BeatId;
  variant: string;
  camera: string;
  presenter: boolean;
  /** For the start frame (image engine): who, where, the product, the light. No words. */
  frame: string;
  /** For Veo: the action and the camera move over 8 seconds. */
  motion: string;
  /** What is said, in the reel's language (spoken by Veo, and the subtitle). */
  line: string;
  framePath?: string | null;
  operation?: string | null;
  clipPath?: string | null;
  status: "planned" | "framed" | "filming" | "done" | "failed";
  error?: string | null;
};

export type ReelPlan = { title: string; caption: string; hashtags: string[]; music: string | null; clips: ReelClip[]; presenter: string };

/** Least used first, ties broken by the seed; never twice in a reel. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The Director: one variant per beat and a camera move per clip, those the company had least (recent: newest first). */
export function directReel(recent: readonly { variant: string; camera: string }[], seed: string): Pick<ReelClip, "beat" | "variant" | "camera" | "presenter">[] {
  const used = (key: "variant" | "camera", v: string) => recent.reduce((s, r, i) => s + (r[key] === v ? Math.pow(0.9, i) : 0), 0);
  const cams: string[] = [];
  return BEATS.map((beat, i) => {
    const variant = [...beat.variants].sort((a, b) => used("variant", `${beat.id}:${a.id}`) - used("variant", `${beat.id}:${b.id}`) || hash(`${seed}:${i}:${a.id}`) - hash(`${seed}:${i}:${b.id}`))[0];
    const camera = [...REEL_CAMERAS].filter((c) => !cams.includes(c)).sort((a, b) => used("camera", a) - used("camera", b) || hash(`${seed}:c${i}:${a}`) - hash(`${seed}:c${i}:${b}`))[0];
    cams.push(camera);
    return { beat: beat.id, variant: `${beat.id}:${variant.id}`, camera, presenter: variant.presenter };
  });
}

export const variantOf = (key: string) => {
  const [beatId, id] = key.split(":");
  return BEATS.find((b) => b.id === beatId)?.variants.find((v) => v.id === id) ?? null;
};

/** Veo's prompt for one clip: the action and camera, the line spoken in the reel's language, real footage, no words. */
export function veoClipPrompt(clip: Pick<ReelClip, "motion" | "line" | "camera" | "presenter">, language: ReelLanguage): string {
  const speech = clip.line
    ? clip.presenter
      ? `The presenter speaks to the camera in ${language}, clearly and warmly, lips in sync: "${clip.line}"`
      : `A warm voice-over says in ${language}: "${clip.line}"`
    : "Only natural sound of the place.";
  return [
    `${clip.motion} Camera: ${clip.camera}.`,
    speech,
    "Real documentary footage shot on a phone or a cinema camera: natural light, true-to-life colour, real skin texture, natural movement and hands. No text, captions or subtitles on screen, no music, no logos added.",
  ].join("\n");
}

/** The words that may be shown as a subtitle: the line, clipped to two short lines. */
export const subtitleOf = (line: string) => line.replace(/\s+/g, " ").trim().slice(0, 140);

/**
 * The finished reel as a motion spec for the browser encoder: 4 scenes of 7.5 s, each one clip with its own sound and
 * its line as a subtitle near the bottom; the business name and the call to action over the last scene.
 */
export function buildReelSpec(plan: ReelPlan, clipUrls: string[], brand: { name: string; color: string }): MotionSpec {
  const text = (over: Partial<TextLayer> & Pick<TextLayer, "text" | "size" | "y" | "h">): TextLayer => ({
    kind: "text",
    font: "inter",
    weight: 800,
    color: "#FFFFFF",
    align: "center",
    x: 0.5,
    w: 0.86,
    ...over,
  });
  const scenes: Scene[] = plan.clips.map((clip, i) => {
    const layers: Layer[] = [{ kind: "video", url: clipUrls[i], fit: "cover", start: 0, sound: true, x: 0.5, y: 0.5, w: 1, h: 1 }];
    if (clip.line) layers.push(text({ text: subtitleOf(clip.line), size: 0.045, y: 0.82, h: 0.12, box: { color: "rgba(0,0,0,0.55)", padding: 0.02, radius: 0.02 }, from: 0.04, to: 0.98 }));
    if (i === plan.clips.length - 1) layers.push(text({ text: brand.name, size: 0.06, y: 0.12, h: 0.09, w: 0.8, box: { color: brand.color, padding: 0.025, radius: 0.04 }, from: 0.35 }));
    return { seconds: SCENE_SECONDS, background: { kind: "solid", colors: ["#000000"] }, layers, ...(i > 0 ? { transition: "cut" as const } : {}) };
  });
  return { version: 1, title: plan.title, ratio: "9:16", fps: 30, palette: { background: "#000000", primary: brand.color, accent: brand.color, text: "#FFFFFF" }, scenes, music: plan.music, caption: plan.caption, hashtags: plan.hashtags };
}

/** About what one reel costs the providers: 4 start frames (Nano Banana 2) and 4 Veo clips of 8 s. */
export function reelCostUsd(tier: ReelTier): number {
  const veoPerSecond = tier === "fast" ? 0.1 : 0.05;
  return Math.round((4 * 0.067 + 4 * CLIP_SECONDS * veoPerSecond + 0.02) * 100) / 100;
}
