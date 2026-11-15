// Format recipes (docs/AD_BRAIN.md, section 5; docs/research/ad-formats.md): the shape of a video, beat by beat. The
// brain fills each beat (lines, scene, title, screens); the planner (plan.ts) turns the filled beats into the EDL with
// real timings. Each recipe is tagged by kind (owner, 11 Nov 2026): "ad" (a UGC ad) or "content" (a normal content
// video: tips, behind the scenes, a day in the life), and carries its preferred soft CTAs (ctas.ts). Pure.

import type { SegmentSource } from "./effects";

/** An ad sells; content is a normal post (useful or fun, the brand mentioned lightly), still ending on a spoken CTA. */
export type AdKind = "ad" | "content";
export const AD_KINDS: readonly AdKind[] = ["ad", "content"];
export const isAdKind = (v: unknown): v is AdKind => v === "ad" || v === "content";

/**
 * clip: an AI clip; still: an AI picture with edit effects; screens: real screen captures; end_card: the end card;
 * split: the actor on top, a real screen below (split-screen reveal); wall: the poster wall of ad cards spinning.
 */
export type BeatPicture = "clip" | "still" | "screens" | "end_card" | "split" | "wall";

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
  /** A pick from the poster wall: the wall spins and lands on this beat's card, which expands into its clip. */
  wallPick?: boolean;
  /** The honest challenge timer runs over this beat (the 60-second challenge; labelled "sped up"). */
  timer?: boolean;
  /** This beat's titles use this style (e.g. "list" for numbered tips) instead of the concept's. */
  titleStyle?: string;
  /** A different person speaks in this beat (the poster wall's sample creators): the brain gives it its own character. */
  ownCharacter?: boolean;
};

export type Recipe = {
  id: string;
  name: string;
  /** "ad" and/or "content". */
  kinds: readonly AdKind[];
  /** The format's own CTAs (ctas.ts ids, from the research), tried first when not used recently. */
  ctas: readonly string[];
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
    kinds: ["ad"],
    ctas: ["link-in-bio", "request-quote"],
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
    kinds: ["ad", "content"],
    ctas: ["save-this", "link-in-bio"],
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
    kinds: ["ad"],
    ctas: ["request-quote", "tap-link"],
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

  // ---- docs/research/ad-formats.md (11 Nov 2026) ------------------------------------------------------------------
  {
    id: "identity_reveal",
    name: "Identity twist reveal (\"you've been watching it\")",
    kinds: ["ad"],
    ctas: ["comment-ad", "link-in-bio"],
    mechanics:
      "Opens like a normal organic post the viewer would watch anyway: a shop owner proudly shows a post that got attention (real post cards float beside her). In the last third she reveals the post, the design and the caption were made by BuPulse, proven on real screens. The reveal is the payoff, so people watch to the end and replay. No ring-light testimonial.",
    characters: { count: 1, variants: 0 },
    beats: [
      { id: "hook", purpose: "Scenario first, like a normal post: \"Okay, I have to show you this post...\" (about 5 s). Never open with the brand.", picture: "clip", speech: "line", cards: true, titleWords: 5, slots: ["punch_in", "slam"] },
      { id: "feed", purpose: "Her real feed: the post, then two more, with short titles.", picture: "screens", speech: "none", titleWords: 4, screens: { min: 2, max: 3 }, slots: ["filmed_monitor", "browser_window", "whip_pan"] },
      { id: "reveal", purpose: "The reveal, with a small real laugh: nobody designed it, BuPulse wrote it in her voice with her logo (about 6 s).", picture: "clip", speech: "line", slots: ["white_flash", "punch_in", "rgb_split"], transition: "white_flash" },
      { id: "proof", purpose: "Real screens: the calendar with the posts scheduled, one-tap approve.", picture: "screens", speech: "none", titleWords: 4, screens: { min: 2, max: 3 }, slots: ["tap_ripple", "beat_cut", "browser_window", "slam"] },
      { id: "end", purpose: "End card while the call to action is spoken, relaxed, like content.", picture: "end_card", speech: "cta", slots: [] },
    ],
    required: [],
    captionStyles: ["karaoke"],
    titleStyles: ["slam", "pop"],
    musicMoods: ["soft warm afro-pop under the voice", "light acoustic groove"],
    musicIntro: false,
    scores: [9],
  },
  {
    id: "split_reveal",
    name: "Split-screen reveal (reaction on top, real screen below)",
    kinds: ["ad"],
    ctas: ["request-quote", "link-in-bio"],
    mechanics:
      "The top half is a person reacting, the bottom half the real BuPulse screen doing the work: proof and a human reaction at once. Short lines, she is not touching anything, it plans the week by itself. Ends full-frame on her saying the call to action.",
    characters: { count: 1, variants: 0 },
    beats: [
      { id: "hook", purpose: "\"Watch this. I'm not touching anything.\" style line; the bottom shows a real screen (about 3 s).", picture: "split", speech: "line", screens: { min: 1, max: 1 }, titleWords: 6, slots: ["punch_in", "slam"] },
      { id: "demo", purpose: "She reacts while the real screen shows posts written in her voice (about 5 s).", picture: "split", speech: "line", screens: { min: 1, max: 1 }, slots: ["slow_push"] },
      { id: "payoff", purpose: "One tap: the whole week (about 4 s).", picture: "split", speech: "line", screens: { min: 1, max: 1 }, slots: ["white_flash"] },
      { id: "cta", purpose: "Full frame, she says the call to action (about 4 s).", picture: "clip", speech: "cta", slots: ["punch_in"], transition: "white_flash" },
      { id: "end", purpose: "A short end card.", picture: "end_card", speech: "none", seconds: 2.4, slots: [] },
    ],
    required: [],
    captionStyles: ["karaoke"],
    titleStyles: ["slam"],
    musicMoods: ["minimal tech pulse, quiet under speech", "light electronic groove"],
    musicIntro: false,
    scores: [8],
  },
  {
    id: "sixty_second",
    name: "60-second challenge",
    kinds: ["ad"],
    ctas: ["comment-ad", "tap-link"],
    mechanics:
      "A visible clock gives the hook and the stakes: can a week of posts be planned, designed and scheduled in one minute? The clock is honest: the screen montage is labelled \"sped up\" and the claim never goes beyond the facts.",
    characters: { count: 1, variants: 0 },
    beats: [
      { id: "hook", purpose: "\"One minute. A full week of posts for my shop. Go.\" style line (about 3 s).", picture: "clip", speech: "line", titleWords: 4, slots: ["punch_in", "camera_shake"] },
      { id: "race", purpose: "Real screens racing the clock: captions in her voice, designs with the logo, the schedule. A 2 to 4 word title each.", picture: "screens", speech: "none", titleWords: 4, timer: true, screens: { min: 3, max: 5 }, slots: ["browser_window", "filmed_monitor", "whip_pan", "beat_cut", "tap_ripple", "slam"], always: ["timer"] },
      { id: "finish", purpose: "\"Done. Time check...\" style line, a shrug (about 3 s).", picture: "clip", speech: "line", slots: ["white_flash", "rgb_split"], transition: "white_flash" },
      { id: "end", purpose: "End card while the call to action is spoken.", picture: "end_card", speech: "cta", slots: [] },
    ],
    required: ["timer"],
    captionStyles: ["karaoke", "one_word"],
    titleStyles: ["slam", "pop"],
    musicMoods: ["ticking clock beat building to a drop", "fast energetic afrobeats"],
    musicIntro: false,
    scores: [7],
  },
  {
    id: "things_i_wish",
    name: "Selfie: things I wish I knew",
    kinds: ["content"],
    ctas: ["save-this", "send-this", "follow-next"],
    mechanics:
      "A first-person list of mistakes, like advice from a peer, not an ad: three things a shop owner wishes someone told her about posting. Each tip is shown on a real screen with a numbered title. BuPulse appears as how she fixed it, never as a pitch.",
    characters: { count: 1, variants: 0 },
    beats: [
      { id: "hook", purpose: "\"Three things I wish somebody told me about posting for my shop.\" style line, walking in her shop (about 4 s).", picture: "clip", speech: "line", titleWords: 6, slots: ["punch_in", "camera_shake"] },
      { id: "tips", purpose: "The three tips, said by her over three real screens, each with a numbered title such as \"1. POST EVERY WEEK\".", picture: "screens", speech: "line", voiceOver: true, titleWords: 5, titleStyle: "list", screens: { min: 3, max: 3 }, slots: ["filmed_monitor", "browser_window", "whip_pan"] },
      { id: "end", purpose: "End card while she says the call to action, like a friend.", picture: "end_card", speech: "cta", slots: [] },
    ],
    required: [],
    captionStyles: ["karaoke"],
    titleStyles: ["list"],
    musicMoods: ["calm lo-fi beat, very quiet", "soft acoustic morning"],
    musicIntro: false,
    scores: [6.5],
  },
  {
    id: "behind_scenes",
    name: "Behind the scenes: how a week of posts gets made",
    kinds: ["content"],
    ctas: ["save-this", "follow-next", "comments-which"],
    mechanics:
      "A relaxed behind-the-scenes look at how a small shop gets its week of posts ready: the owner explains her Sunday routine over real screens. Useful and calm, the brand mentioned once, no hard sell.",
    characters: { count: 1, variants: 0 },
    beats: [
      { id: "hook", purpose: "A behind-the-scenes opener: \"Here's how my posts for the week actually get made.\" style line (about 4 s).", picture: "clip", speech: "line", titleWords: 5, slots: ["punch_in", "slam"] },
      { id: "routine", purpose: "Her routine on real screens, narrated by her (about 8 s): what she checks, what she approves.", picture: "screens", speech: "line", voiceOver: true, titleWords: 4, screens: { min: 3, max: 4 }, slots: ["filmed_monitor", "browser_window", "whip_pan", "tap_ripple"] },
      { id: "close", purpose: "Back on her, one honest line about what changed (about 4 s).", picture: "clip", speech: "line", slots: ["white_flash", "punch_in"] },
      { id: "end", purpose: "End card while she says the call to action, like content.", picture: "end_card", speech: "cta", slots: [] },
    ],
    required: [],
    captionStyles: ["karaoke", "one_word"],
    titleStyles: ["pop", "slam"],
    musicMoods: ["calm warm afro-soul, quiet", "soft lo-fi"],
    musicIntro: false,
    scores: [7],
  },
  {
    id: "day_in_life",
    name: "A day in the life of a shop owner",
    kinds: ["content"],
    ctas: ["follow-next", "save-this", "comments-which"],
    mechanics:
      "A day in a Kigali shop owner's life in short moments with timestamps: opening the shop, serving customers, a quick look at her phone where the day's post is already scheduled, closing at night. Feels like a vlog; BuPulse is one small honest moment.",
    characters: { count: 1, variants: 0 },
    beats: [
      { id: "morning", purpose: "Morning, opening the shop, a still with a voice-over line and a typewriter time such as \"7:30 AM\".", picture: "still", speech: "line", voiceOver: true, titleWords: 3, titleStyle: "typewriter", slots: ["slow_push", "white_flash"], always: ["slow_push"] },
      { id: "shop", purpose: "In the shop with a customer, talking to the phone (about 4 s).", picture: "clip", speech: "line", slots: ["punch_in", "whip_pan"] },
      { id: "phone", purpose: "The real screens: today's post already scheduled, a week planned.", picture: "screens", speech: "none", titleWords: 4, screens: { min: 2, max: 3 }, slots: ["filmed_monitor", "browser_window", "tap_ripple"] },
      { id: "night", purpose: "Closing at night, a still with a calm voice-over line and a camcorder time stamp.", picture: "still", speech: "line", voiceOver: true, slots: ["night_grade"], always: ["night_grade"] },
      { id: "end", purpose: "End card while she says the call to action, like a vlogger.", picture: "end_card", speech: "cta", slots: [] },
    ],
    required: [],
    captionStyles: ["one_word", "karaoke"],
    titleStyles: ["typewriter", "pop"],
    musicMoods: ["gentle vlog afro-pop", "warm acoustic day"],
    musicIntro: false,
    scores: [7],
  },

  // ---- The owner's hand-made poster wall (11 Nov 2026, judge 8/10; ~/bupulse-ugc-ads/wall/render_wall.py) -----------
  {
    id: "poster_wall",
    name: "Poster wall: which ad stops the scroll?",
    kinds: ["ad"],
    ctas: ["link-in-bio", "request-quote"],
    mechanics:
      "A streaming-style wall of UGC ad cards whose columns spin like a slot machine and slow down; a card is picked, glows in BuPulse blue-violet, expands to full screen and its short example ad plays, then it collapses and the wall spins again. Three example ads for sample Kigali businesses (each its own person, clearly labelled as an example, never claimed as a client or a result), then the narrator's card is picked and the narrator says the call to action.",
    characters: { count: 4, variants: 0 },
    beats: [
      { id: "intro", purpose: "The wall drifts while the narrator's voice asks what makes people stop scrolling (about 4 s).", picture: "wall", speech: "line", voiceOver: true, titleWords: 4, slots: ["slam"] },
      { id: "pick_1", purpose: "Example ad 1: a sample creator talks about a sample business, in UGC style (about 5 s).", picture: "clip", speech: "line", wallPick: true, ownCharacter: true, slots: [] },
      { id: "pick_2", purpose: "Example ad 2: another sample business, another person (about 5 s).", picture: "clip", speech: "line", wallPick: true, ownCharacter: true, slots: [] },
      { id: "pick_3", purpose: "Example ad 3: a third sample business, another person (about 5 s).", picture: "clip", speech: "line", wallPick: true, ownCharacter: true, slots: [] },
      { id: "cta", purpose: "The narrator's card is picked: \"Your business needs content like this.\" and the call to action (about 4 s).", picture: "clip", speech: "cta", wallPick: true, slots: [] },
      { id: "end", purpose: "A short end card.", picture: "end_card", speech: "none", seconds: 2.2, slots: [] },
    ],
    required: ["poster_wall"],
    captionStyles: ["karaoke"],
    titleStyles: ["slam"],
    musicMoods: ["dark playful synth with ticks", "punchy afrobeats with risers"],
    musicIntro: false,
    scores: [8],
  },
];

const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));
export const recipeById = (id: string) => BY_ID.get(id);

/** The signature effects a recipe can place (its beats' slots), with its required ones (e.g. the timer, the poster wall). */
export const recipeEffects = (r: Recipe): string[] => [...new Set([...r.required, ...r.beats.flatMap((b) => b.slots)])];

/** The segment source a beat's picture becomes in the EDL. */
export const beatSource = (b: Beat): SegmentSource =>
  b.picture === "clip" ? "ai_clip" : b.picture === "still" ? "ai_still_fx" : b.picture === "screens" ? "real_screen" : b.picture === "split" ? "split" : b.picture === "wall" ? "wall" : "end_card";

/** The recipes of one kind. */
export const recipesOfKind = (kind: AdKind, recipes: readonly Recipe[] = RECIPES) => recipes.filter((r) => r.kinds.includes(kind));

/**
 * Picks the format of a kind: never the one used last (two videos in a row must look different), else the best by
 * average judge score with a little chance for the others (a weighted draw). Pure.
 */
export function pickRecipe(input: { recent: readonly string[]; rng: () => number; recipes?: readonly Recipe[]; kind?: AdKind }): Recipe {
  const all = recipesOfKind(input.kind ?? "ad", input.recipes ?? RECIPES);
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
