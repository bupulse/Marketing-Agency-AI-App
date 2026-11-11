// Cached plans for tests and free renders: the "Who's real?" twist ad (judge 9/10) hand-made on 10 November 2026, as
// an EDL over the prototype's cached files (~/bupulse-ugc-ads, AD_BRAIN_FIXTURE_DIR). No paid call is needed to render
// it, so the renderer, the judge and delivery can be tried end to end for a few cents. Refs are "fixture:<path>" under
// that folder. Pure (the word timings are read from the folder by the caller: fixtureWordFiles).

import type { Edl } from "./edl";

const BAR = (60 / 140) * 4;
const DROP = 10.1;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Fractions of a 1516 x 784 dashboard capture. */
const crop = (x0: number, y0: number, x1: number, y1: number): [number, number, number, number] => [r3(x0 / 1516), r3(y0 / 784), r3(x1 / 1516), r3(y1 / 784)];

const SCREENS: { key: string; file: string; page: string; crop: [number, number, number, number]; title: string; fx: number; fy: number; zoom: number; tap?: [number, number] }[] = [
  { key: "screen:posts-week", file: "twist/screens/posts-today.jpg", page: "Posts", crop: crop(262, 370, 880, 784), title: "A WEEK OF POSTS", fx: 0, fy: 0, zoom: 1.15 },
  { key: "screen:cards", file: "twist/screens/posts-cards.jpg", page: "Posts", crop: crop(262, 340, 880, 600), title: "WRITTEN FOR YOU", fx: 0.3, fy: 0.5, zoom: 1.2 },
  { key: "screen:posts-rw", file: "twist/screens/posts-today.jpg", page: "Posts", crop: crop(890, 440, 1500, 784), title: "IN KINYARWANDA TOO", fx: 0.5, fy: 0.4, zoom: 1.15 },
  { key: "screen:photos", file: "twist/screens/photos.jpg", page: "Designs", crop: crop(510, 360, 1010, 600), title: "DESIGNED IN YOUR BRAND", fx: 0.5, fy: 0.5, zoom: 1.15 },
  { key: "screen:autopilot", file: "twist/screens/autopilot.jpg", page: "Autopilot", crop: crop(285, 380, 610, 780), title: "EVERY NETWORK", fx: 0.5, fy: 0.3, zoom: 1.12 },
  { key: "screen:approve", file: "twist/screens/posts-today.jpg", page: "Posts", crop: crop(1100, 365, 1516, 560), title: "APPROVE ALL. ONE TAP.", fx: 0.78, fy: 0.2, zoom: 1.3, tap: [0.78, 0.2] },
  { key: "screen:calendar", file: "twist/screens/calendar.jpg", page: "Calendar", crop: crop(262, 160, 900, 520), title: "POSTED ON TIME", fx: 0.45, fy: 0.5, zoom: 1.25 },
  { key: "screen:home", file: "twist/screens/home.jpg", page: "Home", crop: crop(262, 170, 880, 400), title: "YOUR MARKETING. DONE.", fx: 0, fy: 0.6, zoom: 1.15 },
];

/** The fixture's words files, by asset key (relative to the fixture folder). */
export const fixtureWordFiles: Record<string, string> = {
  "clip:hook": "twist/man_a.words.json",
  "clip:transform": "twist/robot.words.json",
  "clip:reveal": "twist/woman.words.json",
  "clip:drop": "twist/man_b.words.json",
  "voice:cta": "story/cta_line.words.json",
};

/** The twist ad as an EDL. `words` fills each talking asset's word timings (read from fixtureWordFiles). */
export function twistFixture(words: Record<string, { w: string; s: number; e: number }[]> = {}): Edl {
  const montageStart = DROP + BAR;
  const end = r3(montageStart + SCREENS.length * BAR);
  const capturedAt = "2026-11-10";
  const assets: Edl["assets"] = {
    "clip:hook": { kind: "video", ref: "fixture:twist/man_a.mp4", seconds: 7.04, words: words["clip:hook"] },
    "clip:transform": { kind: "video", ref: "fixture:twist/robot.mp4", seconds: 4.032, words: words["clip:transform"] },
    "clip:reveal": { kind: "video", ref: "fixture:twist/woman.mp4", seconds: 4.032, words: words["clip:reveal"] },
    "clip:drop": { kind: "video", ref: "fixture:twist/man_b.mp4", seconds: 5.035, words: words["clip:drop"] },
    "voice:cta": { kind: "audio", ref: "fixture:story/cta_line.wav", seconds: 3.6, words: words["voice:cta"] },
    "music:intro": { kind: "audio", ref: "fixture:twist/intro.mp3", seconds: 30.77 },
    "music:main": { kind: "audio", ref: "fixture:twist/music.mp3", seconds: 30.77, bpm: 140 },
    "screen:cardA": { kind: "screen", ref: "fixture:twist/screens/posts-today.jpg", capture: { page: "Posts", capturedAt }, crop: crop(1203, 442, 1497, 784) },
    "screen:cardB": { kind: "screen", ref: "fixture:twist/screens/posts-today.jpg", capture: { page: "Posts", capturedAt }, crop: crop(892, 442, 1186, 784) },
    logo: { kind: "image", ref: "repo:public/icon.png" },
  };
  for (const s of SCREENS) assets[s.key] = { kind: "screen", ref: `fixture:${s.file}`, capture: { page: s.page, capturedAt }, crop: s.crop, ...(s.tap ? { tap: s.tap } : {}) };
  // Strip undefined word lists (a fixture loaded without its words files still validates).
  for (const a of Object.values(assets)) if (a.words === undefined) delete a.words;
  const first = (key: string) => words[key]?.[0]?.s ?? 0;
  const last = (key: string, fallback: number) => words[key]?.at(-1)?.e ?? fallback;
  const voice = (id: string, key: string, text: string, segStart: number, clipOffset: number, fallbackEnd: number, extra: Partial<Edl["voice"][number]> = {}): Edl["voice"][number] => {
    const from = Math.max(clipOffset, first(key) - 0.05);
    return { id, character: "creator", text, source: "omni", language: "en", asset: key, from: r3(from), to: r3(last(key, fallbackEnd) + 0.12), at: r3(segStart + from - clipOffset), effects: [], cta: false, ...extra };
  };
  return {
    version: 1,
    recipe: "twist",
    effects: ["scan_wipe", "robot_voice", "browser_window", "slam", "beat_cut"],
    canvas: { w: 720, h: 1280, fps: 24, seconds: 30 },
    brand: { name: "BuPulse", url: "bupulse.com", primary: "#2f6bff", accent: "#7b5cff", logo: "logo" },
    characters: [{ id: "creator", name: "Creator" }],
    assets,
    segments: [
      { id: "hook", beat: "hook", start: 0, end: 6.18, source: "ai_clip", asset: "clip:hook", clipOffset: 0, effects: [], overlays: [{ asset: "screen:cardA", label: "A" }, { asset: "screen:cardB", label: "B" }], tags: { cam: "selfie, waist up", act: "presents two cards, leans in for the twist" } },
      { id: "transform", beat: "transform", start: 6.18, end: 8.45, source: "ai_clip", asset: "clip:transform", clipOffset: 0.23, effects: [{ id: "scanlines", params: { alpha: 26, desat: 0.2 } }], transitionIn: { id: "scan_wipe", seconds: 0.42 }, tags: { fx: "scan wipe, scan-lines, robot voice" } },
      { id: "reveal", beat: "reveal", start: 8.45, end: DROP, source: "ai_clip", asset: "clip:reveal", clipOffset: 0.3, effects: [], transitionIn: { id: "scan_wipe", seconds: 0.35 }, tags: { fx: "reverse scan wipe" } },
      { id: "drop", beat: "drop", start: DROP, end: r3(montageStart), source: "ai_clip", asset: "clip:drop", clipOffset: 0.45, effects: [{ id: "punch_in", params: { zoom: 1.08, seconds: 0.3 } }, { id: "camera_shake", params: { amp: 14, seconds: 0.5 } }, { id: "rgb_split", params: { amount: 14, seconds: 0.25 } }], transitionIn: { id: "white_flash", seconds: 0.08 }, tags: { audio: "beat drop" } },
      ...SCREENS.map((s, i) => ({
        id: `montage-${i + 1}`,
        beat: "montage",
        start: r3(montageStart + i * BAR),
        end: r3(montageStart + (i + 1) * BAR),
        source: "real_screen" as const,
        asset: s.key,
        clipOffset: 0,
        effects: [{ id: "browser_window", params: { zoom: s.zoom, fx: s.fx, fy: s.fy } as Record<string, number> }, ...(s.tap ? [{ id: "tap_ripple", params: {} as Record<string, number> }] : [])],
        tags: { cam: "real screen capture", title: s.title },
      })),
      { id: "end", beat: "end", start: end, end: 30, source: "end_card", clipOffset: 0, effects: [], tags: { audio: "spoken call to action" } },
    ],
    voice: [
      voice("line-hook", "clip:hook", "One of these was made by AI. Which one? Neither. I'm the one who's not real.", 0, 0, 6.6),
      voice("line-transform", "clip:transform", "I can even be a woman.", 6.18, 0.23, 3.4, { character: "android", effects: [{ id: "robot_voice", params: {} }] }),
      voice("line-reveal", "clip:reveal", "Like this.", 8.45, 0.3, 1.6, { character: "woman" }),
      voice("line-drop", "clip:drop", "If AI can make me, imagine what it can do for your business.", DROP, 0.45, 4.6),
      { id: "line-cta", character: "creator", text: "Check out BuPulse dot com and get a free quote.", source: "tts", language: "en", asset: "voice:cta", from: 0, to: r3(last("voice:cta", 3.3) + 0.1), at: r3(end + 0.35), effects: [], cta: true },
    ],
    titles: [
      { text: "WHICH ONE IS AI?", start: 2.2, end: 3.7, style: "slam", y: 175 / 1280 },
      ...SCREENS.map((s, i) => ({ text: s.title, start: r3(montageStart + i * BAR), end: r3(montageStart + (i + 1) * BAR - 0.01), style: "slam", y: 170 / 1280 })),
    ],
    captions: { style: "karaoke", y: 900 / 1280 },
    music: { asset: "music:main", intro: "music:intro", gainDb: -5, duckDb: 11, dropAt: DROP, mainOffset: 0.5, bpm: 140, beatPulse: true },
    sfx: [
      { at: 2.2, kind: "boom", gainDb: -12 },
      { at: 6.18, kind: "glitch", gainDb: -9 },
      { at: 8.45, kind: "glitch", gainDb: -11 },
      { at: DROP, kind: "boom", gainDb: -6 },
      ...SCREENS.map((_, i) => ({ at: r3(montageStart + i * BAR), kind: "whoosh" as const, gainDb: -16 })),
      { at: r3(montageStart + 5 * BAR + BAR * 0.6), kind: "click", gainDb: -6 },
      { at: end, kind: "whoosh", gainDb: -12 },
    ],
    endCard: { headline: "Your week of posts, done", button: "Get a free quote", sub: "We call you back · Mobile Money or card" },
  };
}

export const FIXTURES = { twist: twistFixture } as const;
export type FixtureName = keyof typeof FIXTURES;
export const isFixtureName = (v: unknown): v is FixtureName => typeof v === "string" && Object.hasOwn(FIXTURES, v);
