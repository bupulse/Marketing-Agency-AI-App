// The "video plan": scenes, durations, captions and photos for a 10 to 30 second vertical slideshow video, made on the
// server from the video script and rendered later in the owner's browser (lib/visuals/timeline.ts,
// components/visuals/video-renderer.ts). Pure, so it is unit tested.
import { buildTheme } from "@/lib/designs/layout";
import type { PackId } from "@/lib/designs/packs";
import { totalDuration } from "./timeline";
import { VIDEO_LIMITS, type Motion, type VideoPlan, type VideoScene } from "./types";
import { getVideoLook } from "./video-looks";

const MOTIONS: Motion[] = ["zoom-in", "pan-right", "zoom-out", "pan-left"];

// Script lines that direct the shoot rather than say something: "[0-3s]", "0:03 –", "Scene 2:", "(B-roll of ...)".
const TIMESTAMP = /^\s*[[(]?\s*\d{1,2}(?::\d{2})?\s*(?:s|sec|seconds)?\s*(?:[-–—to]+\s*\d{1,2}(?::\d{2})?\s*(?:s|sec|seconds)?)?\s*[\])]?\s*[:.\-–—]?\s*/i;
const LABEL = /^\s*(?:scene|shot|hook|intro|outro|cta|call to action|voice ?over|vo|narrator|on[- ]screen(?: text)?|text|caption|visual|b-?roll|music|sfx|audio)\s*\d*\s*[:\-–—]\s*/i;
const STAGE = /^\s*[[(][^\])]*[\])]\s*$/;
const DIRECTION_ONLY = /^\s*(?:visual|b-?roll|music|sfx|audio|shot|camera|cut to|transition)\b/i;

/** Clips text to `max` characters at a word, with "…". */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const room = clean.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > max / 2 ? room.slice(0, space) : room).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/**
 * The lines of a video script a viewer should read: timestamps, scene labels and stage directions removed, quotes
 * unwrapped, long lines split at sentence ends. Empty lines dropped.
 */
export function scriptLines(script: string): string[] {
  const out: string[] = [];
  for (const raw of script.replace(/\r/g, "").split("\n")) {
    if (STAGE.test(raw) || DIRECTION_ONLY.test(raw)) continue;
    let line = raw;
    for (let i = 0; i < 3; i++) line = line.replace(TIMESTAMP, "").replace(LABEL, "");
    line = line
      .replace(/[[(][^\])]*[\])]/g, " ")
      .replace(/^[-*•\d.)\s]+/, "")
      .replace(/^["“”'«»]+|["“”'«»]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line.length < 2) continue;
    // A long line becomes one scene per sentence.
    const sentences = line.length > VIDEO_LIMITS.sceneText ? line.split(/(?<=[.!?])\s+/) : [line];
    for (const s of sentences) if (s.trim().length >= 2) out.push(s.trim());
  }
  return out;
}

/** Time a scene stays on screen: long enough to read its caption, within the per-scene limits. */
export function sceneDuration(text: string): number {
  const ms = 1600 + text.length * 50;
  return Math.round(Math.min(VIDEO_LIMITS.maxSceneMs, Math.max(VIDEO_LIMITS.minSceneMs, ms)) / 100) * 100;
}

/** Scales scene durations so the video lasts between 10 and 30 seconds (crossfades included). */
export function fitDurations(durations: number[], crossfadeMs: number = VIDEO_LIMITS.crossfadeMs): number[] {
  if (durations.length === 0) return [];
  const fades = crossfadeMs * (durations.length - 1);
  const total = durations.reduce((a, b) => a + b, 0) - fades;
  const target = Math.min(VIDEO_LIMITS.maxMs, Math.max(VIDEO_LIMITS.minMs, total));
  if (target === total) return durations;
  const k = (target + fades) / (total + fades);
  const scaled = durations.map((d) => Math.floor((d * k) / 10) * 10);
  // Rounding down keeps it inside the limit; give the missing milliseconds to the last scene.
  const now = scaled.reduce((a, b) => a + b, 0) - fades;
  scaled[scaled.length - 1] += Math.max(0, target - now);
  return scaled;
}

export interface VideoPlanInput {
  script: string;
  /** The opening line (the content's headline or the product name). */
  hook: string;
  /** The closing line: a call to action from the content, else the business name. */
  cta?: string | null;
  businessName: string;
  /** Photos to show, best first (album photos, or the image visual's designs). */
  photos: string[];
  pack: PackId;
  colors?: readonly string[] | null;
  /** A video look id (chooseVideoLook); its motions and transition length apply. Unknown ids are ignored. */
  look?: string | null;
  /** Contact line for the closing scene (looks only). */
  contact?: string | null;
  /** Logo path for the closing scene (looks only). */
  logoPath?: string | null;
}

/** A video plan from a script. Always at least a hook and a closing scene, so even an empty script makes a video. */
export function buildVideoPlan(input: VideoPlanInput): VideoPlan {
  const lines = scriptLines(input.script);
  const hook = clip(input.hook || lines[0] || input.businessName, VIDEO_LIMITS.sceneText);
  const body = lines.filter((l) => l.toLowerCase() !== hook.toLowerCase()).map((l) => clip(l, VIDEO_LIMITS.sceneText));
  const cta = clip(input.cta?.trim() || input.businessName, VIDEO_LIMITS.sceneText);
  const roomForBody = VIDEO_LIMITS.maxScenes - 2;
  const texts = [hook, ...body.slice(0, roomForBody)];
  if (texts[texts.length - 1].toLowerCase() !== cta.toLowerCase()) texts.push(cta);

  const photos = input.photos.filter(Boolean);
  const look = getVideoLook(input.look);
  const crossfadeMs = look ? look.transition.ms : VIDEO_LIMITS.crossfadeMs;
  const motions = look ? look.motion.sequence : MOTIONS;
  const durations = fitDurations(texts.map(sceneDuration), crossfadeMs);
  const scenes: VideoScene[] = texts.map((text, i) => ({
    text,
    // Photos cycle through the scenes; the closing scene sits on the brand backdrop when there are few photos.
    photoPath: photos.length === 0 || (i === texts.length - 1 && photos.length < texts.length) ? null : photos[i % photos.length],
    durationMs: durations[i],
    motion: motions[i % motions.length],
    role: i === 0 ? "hook" : i === texts.length - 1 ? "cta" : "body",
  }));

  const theme = buildTheme(input.colors);
  return {
    version: 1,
    width: VIDEO_LIMITS.width,
    height: VIDEO_LIMITS.height,
    fps: VIDEO_LIMITS.fps,
    pack: input.pack,
    colors: { background: theme.deep, text: "#FFFFFF", accent: theme.primary, ...(look ? { highlight: theme.accent } : {}) },
    businessName: clip(input.businessName, 60),
    scenes,
    crossfadeMs,
    totalMs: totalDuration(scenes, crossfadeMs),
    ...(look ? { look: look.id, ...(input.contact?.trim() ? { contact: clip(input.contact, 60) } : {}), ...(input.logoPath ? { logoPath: input.logoPath } : {}) } : {}),
  };
}

/** The owner edited scene captions: keeps the plan's shape, clips the texts, recomputes the durations. */
export function withSceneTexts(plan: VideoPlan, texts: string[]): VideoPlan {
  const scenes = plan.scenes.map((s, i) => ({ ...s, text: clip(texts[i] ?? s.text, VIDEO_LIMITS.sceneText) || s.text }));
  const durations = fitDurations(scenes.map((s) => sceneDuration(s.text)), plan.crossfadeMs);
  const fitted = scenes.map((s, i) => ({ ...s, durationMs: durations[i] }));
  return { ...plan, scenes: fitted, totalMs: totalDuration(fitted, plan.crossfadeMs) };
}

/** A stored plan read back defensively (JSON from the database). Null when it is not a usable plan. */
export function readVideoPlan(value: unknown): VideoPlan | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<VideoPlan>;
  if (p.version !== 1 || !Array.isArray(p.scenes) || p.scenes.length === 0 || typeof p.totalMs !== "number") return null;
  if (p.totalMs > VIDEO_LIMITS.maxMs + 1 || !p.colors) return null;
  return p as VideoPlan;
}
