// The EDL (edit decision list): the Ad Brain's plan of one ad as JSON, the single source of truth that the renderer
// (tools/ad-render) and the dashboard both read (docs/AD_BRAIN.md, section 3.4). validateEdl checks its shape, its
// timeline and the hard rules a plan can break before anything is paid or rendered. Pure.

import { z } from "zod";
import { checkParams, effectById, SFX_KINDS, CAPTION_STYLES, TITLE_STYLES, SEGMENT_SOURCES, type SegmentSource } from "./effects";
import { carriesCta, ctaById, ctaOf } from "./ctas";
import { hasMoneyWords, looksKinyarwanda, mentionsSite } from "./script-rules";

/** 9:16 at 720p, 24 frames a second (what Omni makes). */
export const CANVAS = { w: 720, h: 1280, fps: 24 } as const;
/** An ad's length: 30 s is the target. */
export const AD_SECONDS = { min: 20, target: 30, max: 34 } as const;
/** Music stays under the voices (hard rule 7). gainDb is its level between lines, relative to the voices (at most 0); under
 * speech it dips by duckDb (at least DUCK_MIN_DB), ending at least MUSIC_UNDER_VOICE_DB under the voices. */
export const MUSIC_MAX_DB = 0;
export const MUSIC_UNDER_VOICE_DB = -12;
export const DUCK_MIN_DB = 6;
/** The spoken call to action starts within this many seconds of the end. */
export const CTA_WITHIN_S = 8;

const num = z.number().finite();
const fraction = num.min(0).max(1);

export const wordSchema = z.object({ w: z.string().min(1).max(60), s: num.min(0), e: num.min(0) });
export type Word = z.infer<typeof wordSchema>;

const effectSchema = z.object({ id: z.string().min(1).max(40), params: z.record(z.string(), z.union([num, z.string().max(60), z.boolean()])).default({}) });
export type EdlEffect = z.infer<typeof effectSchema>;

const assetSchema = z.object({
  kind: z.enum(["image", "video", "audio", "screen"]),
  /** Where the file is: "ad:<AdAsset id>", "store:<path in the ad-brain bucket>" or "file:<absolute path>" (fixtures). */
  ref: z.string().min(3).max(600),
  seconds: num.min(0).optional(),
  /** Spoken words in the file, its own timeline (seconds). */
  words: z.array(wordSchema).max(200).optional(),
  /** A real screen capture: its page and the date it was captured (hard rule 1). */
  capture: z.object({ page: z.string().max(60), capturedAt: z.string().max(40) }).optional(),
  /** Which part of a screen capture to show, as fractions [x0, y0, x1, y1]. */
  crop: z.tuple([fraction, fraction, fraction, fraction]).optional(),
  /** Where a real button is on the (cropped) screen, as fractions, for the tap ripple. */
  tap: z.tuple([fraction, fraction]).optional(),
  bpm: num.min(40).max(220).optional(),
});
export type EdlAsset = z.infer<typeof assetSchema>;

const segmentSchema = z.object({
  id: z.string().min(1).max(40),
  beat: z.string().max(40).optional(),
  start: num.min(0),
  end: num.min(0),
  source: z.enum(SEGMENT_SOURCES as [SegmentSource, ...SegmentSource[]]),
  asset: z.string().max(80).optional(),
  /** Seconds into the asset where this segment starts (clips). */
  clipOffset: num.min(0).default(0),
  effects: z.array(effectSchema).max(8).default([]),
  transitionIn: z.object({ id: z.string().max(40), seconds: num.min(0).max(1.5) }).optional(),
  /** Real screen cards floating beside the actor: asset keys of screens and a letter each. */
  overlays: z.array(z.object({ asset: z.string().max(80), label: z.string().max(2) })).max(2).optional(),
  /** split: the real screen shown below the actor (the segment's asset is the actor's clip). */
  screen: z.string().max(80).optional(),
  /** wall: the pick this spin lands on (0-based, edl.wall.picks); a pick clip: its own index. */
  wallPick: z.number().int().min(0).max(8).optional(),
  /** A small label chip over a clip (the poster wall's "Example ad · bakery"). */
  chip: z.string().max(48).optional(),
  /** The dashboard's tagged script line: [CAM] [ACT] [AUDIO] [FX] [TITLE]. */
  tags: z.object({ cam: z.string().max(200).optional(), act: z.string().max(300).optional(), audio: z.string().max(200).optional(), fx: z.string().max(200).optional(), title: z.string().max(120).optional() }).optional(),
});
export type EdlSegment = z.infer<typeof segmentSchema>;

const voiceSchema = z.object({
  id: z.string().min(1).max(40),
  character: z.string().max(40).optional(),
  text: z.string().min(1).max(400),
  source: z.enum(["omni", "tts", "recorded"]),
  language: z.enum(["en", "fr", "rw"]).default("en"),
  asset: z.string().max(80),
  /** The part of the asset that is heard (its own timeline), and where it starts in the ad. */
  from: num.min(0),
  to: num.min(0),
  at: num.min(0),
  effects: z.array(effectSchema).max(3).default([]),
  cta: z.boolean().default(false),
});
export type EdlVoice = z.infer<typeof voiceSchema>;

const titleSchema = z.object({ text: z.string().min(1).max(60), start: num.min(0), end: num.min(0), style: z.string().max(20), y: fraction.default(0.12) });
export type EdlTitle = z.infer<typeof titleSchema>;

export const edlSchema = z.object({
  version: z.literal(1),
  recipe: z.string().max(40),
  /** An ad, or a normal content video (both end on a spoken CTA). */
  kind: z.enum(["ad", "content"]).default("ad"),
  /** The planned CTA (ctas.ts id). */
  ctaId: z.string().max(40).optional(),
  /** The poster wall: the cards on it (images or real screens) and, in order, the card each pick lands on. */
  wall: z.object({ cards: z.array(z.string().max(80)).min(1).max(24), picks: z.array(z.string().max(80)).min(1).max(8) }).optional(),
  /** The ad's 3 to 5 signature effects (the look that must not repeat). */
  effects: z.array(z.string().max(40)).min(3).max(5),
  canvas: z.object({ w: z.literal(CANVAS.w), h: z.literal(CANVAS.h), fps: z.literal(CANVAS.fps), seconds: num }),
  brand: z.object({ name: z.string().min(1).max(60), url: z.string().min(3).max(80), primary: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), logo: z.string().max(80).optional() }),
  characters: z.array(z.object({ id: z.string().max(40), name: z.string().max(60), asset: z.string().max(80).optional() })).max(4).default([]),
  assets: z.record(z.string().max(80), assetSchema),
  segments: z.array(segmentSchema).min(2).max(40),
  voice: z.array(voiceSchema).max(20),
  titles: z.array(titleSchema).max(30).default([]),
  captions: z.object({ style: z.string().max(20), y: fraction.default(0.7) }),
  music: z.object({ asset: z.string().max(80).optional(), intro: z.string().max(80).optional(), gainDb: num.min(-40).max(0), duckDb: num.min(0).max(30), dropAt: num.min(0).optional(), mainOffset: num.min(0).default(0), bpm: num.min(40).max(220).optional(), beatPulse: z.boolean().default(false) }).nullable(),
  sfx: z.array(z.object({ at: num.min(0), kind: z.enum(SFX_KINDS as [string, ...string[]]), gainDb: num.min(-40).max(6).default(-8) })).max(60).default([]),
  endCard: z.object({ headline: z.string().min(1).max(60), button: z.string().min(1).max(40), sub: z.string().max(80).default(""), face: z.string().max(80).optional() }),
});
export type Edl = z.infer<typeof edlSchema>;

export type EdlCheck = { ok: boolean; errors: string[]; warnings: string[]; edl: Edl | null };

const KIND_FOR: Record<SegmentSource, EdlAsset["kind"][] | null> = { ai_clip: ["video"], ai_still_fx: ["image"], real_screen: ["screen"], brand_card: null, end_card: null, split: ["video"], wall: null };

/** The words of a watermark the platform's own AI label replaces (hard rule 5). */
const WATERMARK = /\bai[\s-]*(generated|made)\b|\bmade (with|by) ai\b\s*$|#ai\b/i;

/**
 * Checks an EDL: its shape, a timeline with no gaps or overlaps from 0 to the end, assets and effects that exist and
 * fit, and the hard rules a plan can break (real screens only, a spoken call to action at the end, no AI Kinyarwanda,
 * no money words in Omni speech, no watermark, music under the voices). Errors stop the job; warnings are kept.
 */
export function validateEdl(input: unknown): EdlCheck {
  const parsed = edlSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "plan"}: ${i.message}`), warnings: [], edl: null };
  const edl = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const total = edl.canvas.seconds;
  if (total < AD_SECONDS.min || total > AD_SECONDS.max) errors.push(`The ad is ${total.toFixed(1)} s long; it must be ${AD_SECONDS.min} to ${AD_SECONDS.max} s.`);

  // Timeline: in order, from 0, no gap and no overlap (a few frames of slack), ending at the ad's length.
  const slack = 1.5 / CANVAS.fps;
  let at = 0;
  const ids = new Set<string>();
  for (const s of edl.segments) {
    if (ids.has(s.id)) errors.push(`Two segments are called "${s.id}".`);
    ids.add(s.id);
    if (s.end - s.start < 0.2) errors.push(`Segment ${s.id} is shorter than 0.2 s.`);
    if (Math.abs(s.start - at) > slack) errors.push(`Segment ${s.id} starts at ${s.start.toFixed(2)} s, but the one before ends at ${at.toFixed(2)} s.`);
    at = s.end;
    const kinds = KIND_FOR[s.source];
    if (kinds) {
      const a = s.asset ? edl.assets[s.asset] : undefined;
      if (!a) errors.push(`Segment ${s.id} needs an asset.`);
      else if (!kinds.includes(a.kind)) errors.push(`Segment ${s.id} (${s.source}) cannot show a ${a.kind}.`);
      // Hard rule 1: a screen on camera is always a real capture, with its page and date.
      if (s.source === "real_screen" && a && !a.capture) errors.push(`Segment ${s.id} shows a screen that is not a real capture.`);
      if (a?.kind === "video" && a.seconds !== undefined && s.clipOffset + (s.end - s.start) > a.seconds + 0.5) warnings.push(`Segment ${s.id} runs past the end of its clip (it holds the last frame).`);
    }
    for (const o of s.overlays ?? []) if (edl.assets[o.asset]?.kind !== "screen" || !edl.assets[o.asset]?.capture) errors.push(`Segment ${s.id} floats a card that is not a real screen capture.`);
    // Hard rule 1 again: the split-screen's lower half is always a real capture.
    if (s.source === "split") {
      const scr = s.screen ? edl.assets[s.screen] : undefined;
      if (!scr || scr.kind !== "screen" || !scr.capture) errors.push(`Segment ${s.id} splits the screen without a real capture below.`);
    }
    if (s.source === "wall") {
      if (!edl.wall) errors.push(`Segment ${s.id} shows the poster wall, but the plan has no wall.`);
      else if (s.wallPick !== undefined && s.wallPick >= edl.wall.picks.length) errors.push(`Segment ${s.id} lands on a pick the wall does not have.`);
    }
    for (const e of s.effects) {
      const def = effectById(e.id);
      if (!def) errors.push(`Segment ${s.id}: "${e.id}" is not an effect in the library.`);
      else if (def.kind !== "segment" && def.kind !== "screen") errors.push(`Segment ${s.id}: "${e.id}" is a ${def.kind} effect, not one drawn on a picture.`);
      else if (def.sources && !def.sources.includes(s.source)) errors.push(`Segment ${s.id}: "${e.id}" cannot be drawn on a ${s.source}.`);
      else errors.push(...checkParams(e.id, e.params).map((m) => `Segment ${s.id}: ${m}`));
      if (e.id === "tap_ripple" && !(s.asset && edl.assets[s.asset]?.tap)) errors.push(`Segment ${s.id}: the tap ripple needs the real button's position on the screen.`);
    }
    if (s.transitionIn) {
      const def = effectById(s.transitionIn.id);
      if (def?.kind !== "transition") errors.push(`Segment ${s.id}: "${s.transitionIn.id}" is not a transition.`);
    }
  }
  if (Math.abs(at - total) > slack) errors.push(`The segments end at ${at.toFixed(2)} s, but the ad is ${total.toFixed(2)} s.`);
  if (edl.segments[edl.segments.length - 1]?.source !== "end_card") warnings.push("The ad does not end on an end card.");

  // Voices: real assets, inside the ad, and the hard rules on speech.
  for (const v of edl.voice) {
    if (!edl.assets[v.asset]) errors.push(`Voice line ${v.id} has no sound file.`);
    if (v.to - v.from < 0.2) errors.push(`Voice line ${v.id} is shorter than 0.2 s.`);
    if (v.at + (v.to - v.from) > total + slack) errors.push(`Voice line ${v.id} runs past the end of the ad.`);
    // Hard rule 3: Kinyarwanda only with real recorded voices.
    if (v.source !== "recorded" && (v.language === "rw" || looksKinyarwanda(v.text))) errors.push(`Voice line ${v.id} is AI speech in Kinyarwanda: Kinyarwanda needs a real recorded voice.`);
    // Omni refuses money words (and they are kept for the screen and the end card).
    // Omni took "get a free quote" on 11 Nov 2026: money words are allowed, and a refused clip falls back to a TTS voice.
    if (v.source === "omni" && hasMoneyWords(v.text)) warnings.push(`Voice line ${v.id} has money words in AI-video speech; if Omni refuses it, the line becomes a voice-over.`);
    for (const e of v.effects) if (effectById(e.id)?.kind !== "audio") errors.push(`Voice line ${v.id}: "${e.id}" is not a sound effect.`);
  }
  const sorted = [...edl.voice].sort((a, b) => a.at - b.at);
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].at + (sorted[i - 1].to - sorted[i - 1].from);
    if (sorted[i].at < prevEnd - 0.25) warnings.push(`Voice lines ${sorted[i - 1].id} and ${sorted[i].id} overlap.`);
  }
  // Hard rule 2: a spoken call to action, the last line, near the end, naming the site.
  const cta = edl.voice.filter((v) => v.cta);
  const last = sorted[sorted.length - 1];
  if (cta.length === 0) errors.push("There is no spoken call to action: the ad must end with the actor saying it.");
  else if (last && !last.cta) errors.push("The spoken call to action must be the last line.");
  else if (last && last.at < total - CTA_WITHIN_S) errors.push(`The spoken call to action starts ${(total - last.at).toFixed(1)} s before the end; it must be in the last ${CTA_WITHIN_S} s.`);
  // It names the site, or says the planned (or any known) CTA: "click the link in bio", "comment AD"... (ctas.ts).
  const planned = ctaById(edl.ctaId);
  if (cta.length && !cta.some((v) => mentionsSite(v.text, edl.brand.url) || (planned ? carriesCta(v.text, planned) : !!ctaOf(v.text)))) errors.push(`The spoken call to action does not say where to go or what to do (${planned ? `"${planned.text}"` : edl.brand.url}).`);

  // Titles: known styles, inside the ad, and never a burned-in "AI-generated" watermark (hard rule 5).
  for (const t of edl.titles) {
    if (!TITLE_STYLES.includes(t.style)) errors.push(`Title "${t.text}" has an unknown style "${t.style}".`);
    if (t.end <= t.start || t.end > total + slack) errors.push(`Title "${t.text}" is not inside the ad.`);
    if (WATERMARK.test(t.text)) errors.push(`Title "${t.text}" reads like an AI watermark; the platform's own AI label is used instead.`);
  }
  if (WATERMARK.test(edl.endCard.headline) || WATERMARK.test(edl.endCard.sub)) errors.push("The end card reads like an AI watermark.");
  if (!CAPTION_STYLES.includes(edl.captions.style)) errors.push(`"${edl.captions.style}" is not a caption style.`);

  // Hard rule 7: music under the voices.
  if (edl.music) {
    if (edl.music.gainDb > MUSIC_MAX_DB) errors.push(`The music is ${edl.music.gainDb} dB above the voices; it may be as loud as them at most.`);
    if (edl.music.duckDb < DUCK_MIN_DB) errors.push(`The music must dip at least ${DUCK_MIN_DB} dB under speech.`);
    else if (edl.music.gainDb - edl.music.duckDb > MUSIC_UNDER_VOICE_DB) errors.push(`Under speech the music is only ${edl.music.duckDb - edl.music.gainDb} dB below the voices; it must be at least ${-MUSIC_UNDER_VOICE_DB} dB below.`);
    if (edl.music.asset && !edl.assets[edl.music.asset]) errors.push("The music track is missing from the assets.");
    if (edl.music.intro && !edl.assets[edl.music.intro]) errors.push("The music intro is missing from the assets.");
  }
  for (const s of edl.sfx) if (s.at > total) warnings.push(`A ${s.kind} sound is placed after the end.`);

  // The signature effects must all be in the plan somewhere.
  const used = new Set<string>([
    ...edl.segments.flatMap((s) => [...s.effects.map((e) => e.id), ...(s.transitionIn ? [s.transitionIn.id] : [])]),
    ...edl.titles.map((t) => t.style),
    ...edl.voice.flatMap((v) => v.effects.map((e) => e.id)),
    ...(edl.music?.bpm && edl.segments.filter((s) => s.source === "real_screen").length > 1 ? ["beat_cut"] : []),
  ]);
  for (const id of edl.effects) if (!used.has(id)) errors.push(`The signature effect "${id}" is not used anywhere in the plan.`);

  return { ok: errors.length === 0, errors, warnings, edl };
}
