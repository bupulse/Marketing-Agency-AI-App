// Format recipes (docs/AD_BRAIN.md, section 5): the shape of an ad, beat by beat. The brain fills each beat (lines,
// scene, title, screens); the planner (plan.ts) turns the filled beats into the EDL with real timings. Phase 1 builds
// the three recipes below; the others in the spec (split-screen reveal, kinetic cinematic, filmed-monitor walkthrough,
// digital product formats) come with the learning phase. Pure.

import type { SegmentSource } from "./effects";

export type BeatPicture = "clip" | "still" | "screens" | "end_card";

export type Beat = {
  id: string;
  /** What the beat must do, for the brain. */
  purpose: string;
  picture: BeatPicture;
  /** "line": one spoken line; "none": no speech; "cta": the spoken call to action (always the last). */
  speech: "line" | "none" | "cta";
  /** The spoken line is heard over a still (the narrator's clip is used for its sound only). */
  voiceOver?: boolean;
  /** Re-use another beat's picture (the loop story's crash still comes back). */
  samePictureAs?: string;
  /** Seconds when there is no speech to time it. */
  seconds?: number;
  /** The beat may carry a title (and how many words at most). */
  titleWords?: number;
  /** Where each signature effect may go: the planner puts an effect on the first beat that lists it. */
  slots: readonly string[];
  /** Effects this beat always has (not counted as signature choices). */
  always?: readonly string[];
  /** How this beat comes in (overridden by a signature transition placed on it). */
  transition?: string;
  /** The music's beat drop lands at the start of this beat. */
  drop?: boolean;
  /** Screens beat: how many real screens, at least / at most. */
  screens?: { min: number; max: number };
  /** Two real screen cards float beside the actor (the twist's "which one is AI?"). */
  cards?: boolean;
  /** A robot voice on this beat's line. */
  robot?: boolean;
};

export type Recipe = {
  id: string;
  name: string;
  /** One paragraph for the brain: the format's mechanics (never a reference reel's content). */
  mechanics: string;
  /** Characters: how many people and whether some are edits of the first (same photo, other identity). */
  characters: { count: number; variants: number };
  beats: readonly Beat[];
  /** Signature effects this recipe can place (the union of its beats' slots). */
  required: readonly string[];
  captionStyles: readonly string[];
  titleStyles: readonly string[];
  musicMoods: readonly string[];
  /** A separate quiet intro track before the drop (Lyria ignores timing: drops are built in the edit). */
  musicIntro: boolean;
  /** The judge's scores so far (10 Nov 2026 hand-made ads); learning adds more. */
  scores: readonly number[];
};

export const RECIPES: readonly Recipe[] = [
  {
    id: "twist",
    name: "Twist / identity reveal",
    mechanics:
      "A creator asks which of two things was made by AI, then reveals HE is the AI: his own face scan-wipes into a chrome android that speaks with a robot voice, then into a different person, then back to him for the beat drop. After the drop, real dashboard screens cut on every bar with slam titles. The joke is the reveal; the product is the payoff.",
    characters: { count: 1, variants: 2 },
    beats: [
      { id: "hook", purpose: "Thumb-stop question in the first 2 s, then the twist line (\"I'm the one who's not real\"). Never open with the brand.", picture: "clip", speech: "line", titleWords: 5, cards: true, slots: ["slam", "punch_in", "rgb_split"], always: [] },
      { id: "transform", purpose: "The same person, now a chrome android, says one short line (about 4 s).", picture: "clip", speech: "line", robot: true, slots: ["scan_wipe", "scanlines", "slice_glitch", "robot_voice"], always: ["scanlines"], transition: "scan_wipe" },
      { id: "reveal", purpose: "The same framing, now another person, says one very short line (about 3 s).", picture: "clip", speech: "line", slots: ["slice_glitch", "rgb_split"], transition: "scan_wipe" },
      { id: "drop", purpose: "Back to the first person, energetic: the bridge from the joke to the business (about 4 s). The beat drops here.", picture: "clip", speech: "line", drop: true, slots: ["white_flash", "camera_shake", "rgb_split", "punch_in"], transition: "white_flash" },
      { id: "montage", purpose: "Real product screens, one per bar of music, each with a 2 to 4 word title of what it does.", picture: "screens", speech: "none", titleWords: 4, screens: { min: 4, max: 8 }, slots: ["browser_window", "filmed_monitor", "tap_ripple", "beat_cut", "slam", "punch_in", "whip_pan"], always: ["beat_cut"] },
      { id: "end", purpose: "End card while the call to action is spoken.", picture: "end_card", speech: "cta", slots: [] },
    ],
    required: ["scan_wipe", "robot_voice"],
    captionStyles: ["karaoke"],
    titleStyles: ["slam"],
    musicMoods: ["dark electronic build into a hard trap drop", "tense synth intro into an energetic afrobeats drop"],
    musicIntro: true,
    scores: [9],
  },
  {
    id: "loop_story",
    name: "Loop story",
    mechanics:
      "Cold open on a funny peak moment (a crash, a mess), freeze-frame with \"Yep, that's me\", a tape rewind to hours earlier, the problem at night, the discovery in a daylight selfie, the product on real screens, a celebration that goes a little too far and loops back to the opening moment. Humour carries it.",
    characters: { count: 1, variants: 0 },
    beats: [
      { id: "cold_open", purpose: "A funny peak moment as a still: something dramatic but harmless (nobody hurt). About 1.3 s, no speech.", picture: "still", speech: "none", seconds: 1.3, slots: ["camera_shake", "debris", "punch_in"], always: ["camera_shake"] },
      { id: "freeze", purpose: "The narrator says \"Yep, that's me\" style line over the frozen picture.", picture: "still", speech: "line", voiceOver: true, samePictureAs: "cold_open", titleWords: 4, slots: ["freeze_frame", "typewriter"], always: ["freeze_frame"] },
      { id: "rewind", purpose: "Rewind to earlier (a typewriter label such as \"3 HOURS EARLIER\"). No speech, under 1 s.", picture: "still", speech: "none", seconds: 0.8, samePictureAs: "cold_open", slots: ["tape_rewind"], always: ["tape_rewind"] },
      { id: "problem", purpose: "The problem the product solves, tired, at night; any laptop or phone screen faces away.", picture: "clip", speech: "line", slots: ["night_grade"], always: ["night_grade"] },
      { id: "discovery", purpose: "Excited daylight selfie: what the product does, in plain words, from the real facts.", picture: "clip", speech: "line", slots: ["punch_in", "white_flash"], transition: "white_flash", drop: true },
      { id: "montage", purpose: "Real product screens with one-word titles of what it does.", picture: "screens", speech: "none", titleWords: 2, screens: { min: 4, max: 6 }, slots: ["filmed_monitor", "browser_window", "whip_pan", "tap_ripple", "beat_cut"] },
      { id: "payoff", purpose: "Celebration still that goes a little too far (a voice-over line from the narrator).", picture: "still", speech: "line", voiceOver: true, slots: ["bounce_cam", "white_flash"] },
      { id: "loop_back", purpose: "Back to the opening moment (\"...and that's how\"). No speech, about 1.4 s.", picture: "still", speech: "none", seconds: 1.4, samePictureAs: "cold_open", titleWords: 4, slots: ["camera_shake", "debris", "typewriter"], always: ["camera_shake"] },
      { id: "end", purpose: "End card while the call to action is spoken.", picture: "end_card", speech: "cta", slots: [] },
    ],
    required: ["freeze_frame", "tape_rewind"],
    captionStyles: ["one_word", "karaoke"],
    titleStyles: ["typewriter", "pop"],
    musicMoods: ["playful bouncy afro-pop", "quirky upbeat funk with a light groove"],
    musicIntro: false,
    scores: [8],
  },
  {
    id: "testimonial_screens",
    name: "Creator talk + real screens",
    mechanics:
      "A creator talks straight to the phone with a strong hook, the real screens prove it, a second short line lands the benefit, then the call to action. Simple and cheap; it lives on its hook.",
    characters: { count: 1, variants: 0 },
    beats: [
      { id: "hook", purpose: "A strong opening claim or confession from the real facts (up to about 8 s). Never open with the brand.", picture: "clip", speech: "line", titleWords: 5, slots: ["punch_in", "slam", "rgb_split", "camera_shake"] },
      { id: "montage", purpose: "Real product screens with short titles.", picture: "screens", speech: "none", titleWords: 4, screens: { min: 3, max: 5 }, slots: ["browser_window", "filmed_monitor", "tap_ripple", "whip_pan", "beat_cut", "slam"] },
      { id: "benefit", purpose: "One short line that lands the benefit (about 4 s).", picture: "clip", speech: "line", slots: ["punch_in", "white_flash", "whip_pan"] },
      { id: "end", purpose: "End card while the call to action is spoken.", picture: "end_card", speech: "cta", slots: [] },
    ],
    required: [],
    captionStyles: ["karaoke", "one_word"],
    titleStyles: ["slam", "pop"],
    musicMoods: ["warm upbeat afrobeats", "light confident lo-fi pop"],
    musicIntro: false,
    scores: [6.5],
  },
];

const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));
export const recipeById = (id: string) => BY_ID.get(id);

/** The signature effects a recipe can place anywhere (its beats' slots). */
export const recipeEffects = (r: Recipe): string[] => [...new Set(r.beats.flatMap((b) => b.slots))];

/** The segment source a beat's picture becomes in the EDL. */
export const beatSource = (b: Beat): SegmentSource => (b.picture === "clip" ? "ai_clip" : b.picture === "still" ? "ai_still_fx" : b.picture === "screens" ? "real_screen" : "end_card");

/**
 * Picks the format: never the one used last (two ads in a row must look different), else the best by average judge
 * score with a little chance for the others (a weighted draw). Pure.
 */
export function pickRecipe(input: { recent: readonly string[]; rng: () => number; recipes?: readonly Recipe[] }): Recipe {
  const all = input.recipes ?? RECIPES;
  const usable = all.filter((r) => r.id !== input.recent[0]);
  const list = usable.length ? usable : [...all];
  const avg = (r: Recipe) => (r.scores.length ? r.scores.reduce((s, x) => s + x, 0) / r.scores.length : 7);
  // Scores 6 to 9 become weights 1 to 16: the best formats win most of the time, never all the time.
  const weight = (r: Recipe) => Math.pow(2, Math.max(0, avg(r) - 5)) / (input.recent.slice(0, 3).includes(r.id) ? 2 : 1);
  const total = list.reduce((s, r) => s + weight(r), 0);
  let x = input.rng() * total;
  for (const r of list) {
    x -= weight(r);
    if (x <= 0) return r;
  }
  return list[list.length - 1];
}
