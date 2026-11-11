// The planner: the brain's script becomes (1) the list of assets to make, with their prompts, and (2) once they exist,
// the EDL with real timings from the clips' lengths and word timings. Deterministic, so the same script and assets
// always give the same plan, and the tests can check the prompts keep the hard rules. Pure.

import { CANVAS, AD_SECONDS, type Edl, type EdlAsset, type EdlEffect, type EdlSegment, type EdlTitle, type EdlVoice, type Word } from "./edl";
import { effectById, withDefaults, type SfxKind } from "./effects";
import { beatSource, type Beat, type Recipe } from "./recipes";
import { clipSecondsFor, speakable, speechSeconds, type Script, type ScriptBeat, type ScriptCharacter } from "./script-rules";
import { clipCost, UNIT_USD, type CostLine } from "./budget";

export type Concept = { recipe: string; effects: string[]; captionStyle: string; titleStyle: string; musicMood: string; line: string };

export type BrandInfo = { name: string; url: string; primary: string; accent: string; logoRef?: string | null };

/** A real screen capture the ad may show (hard rule 1), from the screen robot or an upload, with its useful crop. */
export type ScreenCapture = { id: string; page: string; label: string; capturedAt: string; ref: string; crop?: [number, number, number, number]; tap?: [number, number] };

// ---- 1. What to make ------------------------------------------------------------------------------------------------

export type AssetNeed =
  | { key: string; kind: "frame"; prompt: string; from: string | null }
  | { key: string; kind: "clip"; prompt: string; from: string; seconds: number; speech: string | null; silentPrompt: string; speaker: string }
  | { key: string; kind: "music"; prompt: string; role: "main" | "intro" }
  | { key: string; kind: "voice"; text: string; voiceName: string; speaker: string };

/** Looks real, never cinematic; no text; any screen faces away (hard rule 1: no AI-drawn screens). */
const REAL_PHOTO = "Looks like a real smartphone photo, not cinematic: natural skin texture with visible pores, real fabric, realistic slightly imperfect light. No text, no logos, no watermarks. Any phone, laptop, monitor or TV screen faces away from the camera or is out of shot.";
const REAL_VIDEO = "Authentic smartphone video, not cinematic: handheld with subtle natural shake, natural skin texture, real micro-expressions and natural eye blinks. No on-screen text, no music. Any phone, laptop, monitor or TV screen stays facing away from the camera.";

/** The Gemini TTS voice for a character (only when Omni speech is not available): Sadachbia was the best male match. */
export const TTS_VOICES: Record<ScriptCharacter["gender"], string> = { man: "Sadachbia", woman: "Kore", other: "Puck" };

const oneLine = (s: string | null | undefined, max = 600) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function portraitPrompt(c: ScriptCharacter): string {
  return `A vertical 9:16 photo that looks like a frame from a real smartphone video. ${oneLine(c.look)}. Framed from the waist up, centered, looking straight into the lens with a natural expression, about to speak. ${REAL_PHOTO}`;
}

export function variantPrompt(change: string): string {
  return `Edit this exact photo. Keep the same framing, pose, hands, clothes, room, lighting and camera angle exactly. ${oneLine(change)}. Photorealistic, like a real phone photo. No text, no logos, no readable screens.`;
}

export function scenePrompt(scene: string, still: boolean): string {
  return `The same person as in the reference photo (same face, hair and clothes). ${oneLine(scene)}.${still ? " A single frozen moment, mid-action." : ""} Vertical 9:16. ${REAL_PHOTO}`;
}

export function clipPrompt(input: { action?: string | null; speech: string | null; seconds: number; robot?: boolean }): string {
  const action = oneLine(input.action) || "Small natural head and hand movements, looking into the lens.";
  const voice = input.speech
    ? input.robot
      ? `Its metal jaw and lips move as it speaks to the lens in English, precise and mechanical. It says exactly: "${input.speech}"`
      : `Speaking straight into the lens in clear English with a natural Rwandan accent, the person says exactly: "${input.speech}"`
    : "The person does not speak: natural reactions only, no dialogue.";
  return `Live motion video throughout, continuing exactly from the first frame. ${action} ${voice} ${input.robot ? "Photorealistic, like a real phone video of a real android. No on-screen text, no music." : REAL_VIDEO} One continuous shot of about ${input.seconds} seconds.`;
}

export function musicPrompt(mood: string, role: "main" | "intro"): string {
  return role === "intro"
    ? `A quiet, tense, minimal instrumental intro: soft pulsing synth pad and a ticking hi-hat, building suspense, no drums hits, no vocals. Mood: ${oneLine(mood, 120)}.`
    : `An instrumental track for a 30 second social media ad, about 130 BPM, with a clear punchy beat from the start and an energetic hook. Mood: ${oneLine(mood, 120)}. No vocals, no spoken words.`;
}

const beatOf = (script: Script, id: string): ScriptBeat | undefined => script.beats.find((b) => b.beat === id);
const charKey = (id: string) => `char:${id}`;

/** The character who speaks a beat (or appears in it): the line's speaker, else the first character. */
function speakerOf(script: Script, b: ScriptBeat | undefined): ScriptCharacter {
  const id = b?.line?.speaker;
  return script.characters.find((c) => c.id === id) ?? script.characters[0];
}

/**
 * Everything the ad needs made, in order (portraits first, then frames from them, clips from frames, music, voices).
 * Lines spoken by AI video go into the clip (lip-sync); lines with money words or a TTS source get a TTS voice.
 */
export function assetNeeds(recipe: Recipe, script: Script, concept: Concept): AssetNeed[] {
  const out: AssetNeed[] = [];
  for (const c of script.characters) {
    if (c.variantOf && script.characters.some((x) => x.id === c.variantOf)) out.push({ key: charKey(c.id), kind: "frame", prompt: variantPrompt(c.change ?? c.look), from: charKey(c.variantOf) });
    else out.push({ key: charKey(c.id), kind: "frame", prompt: portraitPrompt(c), from: null });
  }
  for (const beat of recipe.beats) {
    const b = beatOf(script, beat.id);
    const who = speakerOf(script, b);
    const line = beat.speech === "cta" ? script.cta : b?.line ?? null;
    const omniLine = line && line.source === "omni" ? speakable(line.text, "omni") : null;
    if (beat.picture === "clip" || (beat.picture === "still" && !beat.samePictureAs)) {
      const frameKey = b?.scene ? `frame:${beat.id}` : charKey(who.id);
      if (b?.scene) out.push({ key: frameKey, kind: "frame", prompt: scenePrompt(b.scene, beat.picture === "still"), from: charKey(who.id) });
      if (beat.picture === "clip") {
        const seconds = omniLine ? clipSecondsFor(omniLine) : 4;
        out.push({ key: `clip:${beat.id}`, kind: "clip", from: frameKey, seconds, speech: omniLine, speaker: who.id, prompt: clipPrompt({ action: b?.action, speech: omniLine, seconds, robot: beat.robot }), silentPrompt: clipPrompt({ action: b?.action, speech: null, seconds, robot: beat.robot }) });
      }
    }
    // A voice-over line (heard over a still or the end card): the narrator's own talking clip, used for its sound.
    if (line && (beat.voiceOver || beat.speech === "cta") && omniLine) {
      const seconds = clipSecondsFor(omniLine);
      out.push({ key: `clip:${beat.id}`, kind: "clip", from: charKey(who.id), seconds, speech: omniLine, speaker: who.id, prompt: clipPrompt({ action: "Handheld selfie, talking to the lens.", speech: omniLine, seconds }), silentPrompt: clipPrompt({ action: "Handheld selfie.", speech: null, seconds }) });
    }
    if (line && line.source === "tts") out.push({ key: `voice:${beat.id}`, kind: "voice", text: speakable(line.text, "tts"), voiceName: TTS_VOICES[who.gender] ?? TTS_VOICES.other, speaker: who.id });
  }
  out.push({ key: "music:main", kind: "music", prompt: musicPrompt(concept.musicMood, "main"), role: "main" });
  if (recipe.musicIntro) out.push({ key: "music:intro", kind: "music", prompt: musicPrompt(concept.musicMood, "intro"), role: "intro" });
  return out;
}

/** The cost of making these assets (cached ones are free), for the plan check and Admin. */
export function needsCost(needs: AssetNeed[], cached: ReadonlySet<string> = new Set()): CostLine[] {
  return needs
    .filter((n) => !cached.has(n.key))
    .map((n) => ({ label: n.kind === "clip" ? `${n.key} (${n.seconds} s AI clip)` : n.key, usd: n.kind === "frame" ? UNIT_USD.frame : n.kind === "clip" ? clipCost(n.seconds) + UNIT_USD.words : n.kind === "music" ? UNIT_USD.music : UNIT_USD.voice + UNIT_USD.words }));
}

// ---- 2. The EDL from the made assets ----------------------------------------------------------------------------------

export type MadeAsset = { key: string; ref: string; kind: "image" | "video" | "audio"; seconds?: number; words?: Word[]; bpm?: number; firstBeat?: number; speechFallback?: boolean };

const TRANSITION_SECONDS: Record<string, number> = { scan_wipe: 0.42, white_flash: 0.12, whip_pan: 0.14, cut: 0 };
/** Omni clips open on a frozen first frame for a moment: skip it. */
export const CLIP_LEAD_IN = 0.45;
const r2 = (n: number) => Math.round(n * 1000) / 1000;

type Spoken = { asset: string; from: number; to: number; words?: Word[]; source: "omni" | "tts" };

/** The heard part of a talking asset: from just before the first word to just after the last. */
function spokenPart(m: MadeAsset | undefined, source: "omni" | "tts"): Spoken | null {
  if (!m || m.seconds === undefined) return null;
  const words = m.words?.filter((w) => w.e > w.s) ?? [];
  const lead = source === "omni" ? CLIP_LEAD_IN : 0;
  if (!words.length) return { asset: m.key, from: lead, to: Math.max(lead + 0.3, m.seconds - 0.1), source };
  return { asset: m.key, from: Math.max(lead, words[0].s - 0.08), to: Math.min(m.seconds, words[words.length - 1].e + 0.15), words, source };
}

export type BuildInput = { recipe: Recipe; script: Script; concept: Concept; made: Record<string, MadeAsset>; screens: ScreenCapture[]; brand: BrandInfo; target?: number };

/**
 * Builds the EDL: walks the recipe's beats, times each from its real asset (speech window of a talking clip, the voice
 * line over a still, bars of the music for the screens), places the signature effects on the first beat that takes
 * each, adds titles, captions, music with its drop, sound effects and the end card with the spoken call to action.
 */
export function buildEdl(input: BuildInput): Edl {
  const { recipe, script, concept, made, brand } = input;
  const target = input.target ?? AD_SECONDS.target;
  const chosen = new Set(concept.effects);
  // Each signature effect goes on the first beat whose slots take it.
  const placedOn = new Map<string, string>();
  for (const id of concept.effects) {
    const beat = recipe.beats.find((b) => b.slots.includes(id));
    if (beat) placedOn.set(id, beat.id);
  }
  const effectsFor = (beat: Beat) => [...new Set([...(beat.always ?? []), ...[...placedOn].filter(([, b]) => b === beat.id).map(([id]) => id)])];
  const music = made["music:main"];
  const bpm = music?.bpm && music.bpm > 60 ? music.bpm : 130;
  const bar = Math.max(1.2, Math.min(2.4, (4 * 60) / bpm));

  const assets: Record<string, EdlAsset> = {};
  const addAsset = (key: string, a: EdlAsset) => (assets[key] ??= a);
  const assetOf = (key: string): string | null => {
    const m = made[key];
    if (!m) return null;
    addAsset(key, { kind: m.kind === "image" ? "image" : m.kind === "video" ? "video" : "audio", ref: m.ref, ...(m.seconds !== undefined ? { seconds: r2(m.seconds) } : {}), ...(m.words ? { words: m.words } : {}), ...(m.bpm ? { bpm: m.bpm } : {}) });
    return key;
  };
  const screenAsset = (s: ScreenCapture) => addAsset(`screen:${s.id}`, { kind: "screen", ref: s.ref, capture: { page: s.page, capturedAt: s.capturedAt }, ...(s.crop ? { crop: s.crop } : {}), ...(s.tap ? { tap: s.tap } : {}) }) && `screen:${s.id}`;

  // Pass 1: each non-screen beat's length (and its heard line).
  /** `screens`/`span`: a screens beat's number of screens and how many seconds each one holds (whole bars). */
  type Planned = { beat: Beat; seconds: number; spoken: Spoken | null; picture: string | null; clipOffset: number; screens?: number; span?: number };
  const planned: Planned[] = [];
  for (const beat of recipe.beats) {
    const b = beatOf(script, beat.id);
    const line = beat.speech === "cta" ? script.cta : b?.line ?? null;
    const clip = made[`clip:${beat.id}`];
    const voice = made[`voice:${beat.id}`];
    // The line is heard from the clip (lip-sync) unless Omni speech failed or the line is a TTS line.
    const spoken = line ? (voice ? spokenPart(voice, "tts") : clip && !clip.speechFallback ? spokenPart(clip, "omni") : null) : null;
    const speechLen = spoken ? spoken.to - spoken.from : 0;
    if (beat.picture === "clip") {
      const fromClip = spoken?.source === "omni";
      const clipOffset = fromClip ? Math.max(CLIP_LEAD_IN, spoken.from - 0.15) : CLIP_LEAD_IN;
      const end = fromClip ? Math.min(clip?.seconds ?? 99, spoken.to + 0.35) : clipOffset + Math.max(2.5, speechLen + 0.5);
      planned.push({ beat, seconds: Math.max(1.2, end - clipOffset), spoken, picture: clip ? assetOf(`clip:${beat.id}`) : null, clipOffset });
    } else if (beat.picture === "still") {
      const frameKey = beat.samePictureAs ? `frame:${beat.samePictureAs}` : `frame:${beat.id}`;
      const pic = made[frameKey] ? frameKey : charKey(speakerOf(script, b).id);
      planned.push({ beat, seconds: Math.max(beat.seconds ?? 0, spoken ? speechLen + 0.5 : 0, 0.6), spoken, picture: assetOf(pic), clipOffset: 0 });
    } else if (beat.picture === "end_card") {
      planned.push({ beat, seconds: Math.max(3, speechLen + 1.2), spoken, picture: null, clipOffset: 0 });
    } else planned.push({ beat, seconds: 0, spoken: null, picture: null, clipOffset: 0 });
  }
  // Pass 2: the screens fill what is left, on whole bars: one bar each, or two or three when there are few screens.
  const fixed = planned.reduce((s, p) => s + p.seconds, 0);
  const screenBeats = planned.filter((x) => x.beat.picture === "screens");
  for (const p of screenBeats) {
    const picks = (beatOf(script, p.beat.id)?.screens ?? []).filter((pick) => input.screens.some((x) => x.id === pick.id));
    const range = p.beat.screens ?? { min: 3, max: 6 };
    const room = Math.max(range.min * bar, (target - fixed) / screenBeats.length);
    const n = Math.max(1, Math.min(picks.length, range.max, Math.max(Math.min(range.min, picks.length), Math.floor(room / bar + 0.25))));
    const bars = Math.max(1, Math.min(3, Math.floor(room / (n * bar) + 0.25)));
    p.screens = n;
    p.span = bars * bar;
    p.seconds = n * p.span;
  }
  // Still short of the shortest ad (few screens, short lines): the end card holds a little longer, up to 6 s.
  const short = AD_SECONDS.min + 0.5 - planned.reduce((s, p) => s + p.seconds, 0);
  const endCard = planned.find((p) => p.beat.picture === "end_card");
  if (short > 0 && endCard) endCard.seconds = Math.min(Math.max(endCard.seconds, 6), endCard.seconds + short);

  // Pass 3: segments, voices, titles, sound.
  const segments: EdlSegment[] = [];
  const voice: EdlVoice[] = [];
  const titles: EdlTitle[] = [];
  const sfx: { at: number; kind: SfxKind; gainDb: number }[] = [];
  const titleStyle = (beat: Beat) => {
    const placed = effectsFor(beat).find((id) => effectById(id)?.kind === "title");
    return placed ?? concept.titleStyle;
  };
  const sound = (at: number, kind: SfxKind | undefined, gainDb = -8) => kind && sfx.push({ at: r2(Math.max(0, at)), kind, gainDb });
  let t = 0;
  let dropAt: number | undefined;
  for (const p of planned) {
    const beat = p.beat;
    const b = beatOf(script, beat.id);
    const placed = effectsFor(beat);
    const transition = placed.find((id) => effectById(id)?.kind === "transition") ?? beat.transition;
    const segEffects: EdlEffect[] = placed.filter((id) => effectById(id)?.kind === "segment").map((id) => ({ id, params: paramsFor(id, b) }));
    if (beat.drop) dropAt = t;
    if (beat.picture === "screens") {
      const picks = (b?.screens ?? []).flatMap((pick) => {
        const s = input.screens.find((x) => x.id === pick.id);
        return s ? [{ s, title: pick.title }] : [];
      });
      const n = p.screens ?? Math.round(p.seconds / bar);
      const span = p.span ?? bar;
      const screenFx = placed.find((id) => id === "browser_window" || id === "filmed_monitor") ?? (recipe.id === "loop_story" ? "filmed_monitor" : "browser_window");
      const tapOn = chosen.has("tap_ripple") && placed.includes("tap_ripple") ? picks.findIndex((x) => x.s.tap) : -1;
      for (let i = 0; i < n; i++) {
        const pick = picks[i % Math.max(1, picks.length)];
        if (!pick) break;
        const start = r2(t + i * span);
        const end = r2(i === n - 1 ? t + p.seconds : t + (i + 1) * span);
        const fx: EdlEffect[] = [{ id: screenFx, params: withDefaults(screenFx, screenFx === "browser_window" ? { fx: pick.s.tap?.[0] ?? 0.5, fy: pick.s.tap?.[1] ?? 0.4 } : {}) }];
        if (i === tapOn) {
          fx.push({ id: "tap_ripple", params: {} });
          sound(start + (end - start) * 0.55, "click", -6);
        }
        if (placed.includes("punch_in")) fx.push({ id: "punch_in", params: withDefaults("punch_in", { seconds: 0.25 }) });
        const trans = placed.includes("whip_pan") && i > 0 ? "whip_pan" : i === 0 ? transition : undefined;
        segments.push({ id: `${beat.id}-${i + 1}`, beat: beat.id, start, end, source: "real_screen", asset: screenAsset(pick.s), clipOffset: 0, effects: fx, ...(trans && trans !== "cut" ? { transitionIn: { id: trans, seconds: TRANSITION_SECONDS[trans] ?? 0.2 } } : {}), tags: { cam: "real screen capture", title: pick.title, fx: fx.map((e) => e.id).join(", ") } });
        if (pick.title) titles.push({ text: pick.title.toUpperCase().slice(0, 40), start: r2(start + 0.02), end: r2(end - 0.02), style: titleStyle(beat), y: recipe.id === "loop_story" ? 0.84 : 0.13 });
        sound(start, trans === "whip_pan" ? "whoosh" : i > 0 ? "whoosh" : undefined, -14);
      }
      t = r2(t + p.seconds);
      continue;
    }
    const start = r2(t);
    const end = r2(t + p.seconds);
    if (beat.picture === "end_card") {
      segments.push({ id: beat.id, beat: beat.id, start, end, source: "end_card", clipOffset: 0, effects: [], tags: { cam: "end card", audio: "spoken call to action" } });
    } else {
      const overlays = beat.cards ? (beatOf(script, recipe.beats.find((x) => x.picture === "screens")?.id ?? "")?.screens ?? []).slice(0, 2).flatMap((pick, i) => {
        const s = input.screens.find((x) => x.id === pick.id);
        return s ? [{ asset: screenAsset(s), label: i === 0 ? "A" : "B" }] : [];
      }) : undefined;
      segments.push({
        id: beat.id,
        beat: beat.id,
        start,
        end,
        source: beatSource(beat),
        ...(p.picture ? { asset: p.picture } : {}),
        clipOffset: r2(p.clipOffset),
        effects: segEffects,
        ...(transition && transition !== "cut" ? { transitionIn: { id: transition, seconds: TRANSITION_SECONDS[transition] ?? 0.2 } } : {}),
        ...(overlays?.length ? { overlays } : {}),
        tags: { cam: beat.picture === "clip" ? "AI clip, handheld phone" : "AI still with edit effects", act: oneLine(b?.action ?? b?.scene, 300) || undefined, audio: p.spoken ? `"${oneLine(beat.speech === "cta" ? script.cta.text : b?.line?.text, 180)}"` : undefined, fx: [...segEffects.map((e) => e.id), ...(transition ? [transition] : [])].join(", ") || undefined, title: b?.title ?? undefined },
      });
      if (transition) sound(start, effectById(transition)?.sfx, -8);
      for (const e of segEffects) {
        const at = e.id === "freeze_frame" ? start + (end - start) * Number(e.params.at ?? 0.3) * 0.2 : start;
        sound(at, effectById(e.id)?.sfx, e.id === "rgb_split" || e.id === "slice_glitch" ? -12 : -8);
      }
      if (b?.title) {
        const style = titleStyle(beat);
        const tStart = beat.speech === "line" && beat.cards ? r2(start + Math.min(2.2, p.seconds * 0.35)) : r2(start + 0.15);
        const tEnd = r2(Math.min(end - 0.05, tStart + Math.max(1.4, Math.min(2.6, p.seconds - 0.3))));
        if (tEnd > tStart + 0.3) {
          titles.push({ text: b.title.toUpperCase().slice(0, 40), start: tStart, end: tEnd, style, y: style === "typewriter" ? 0.1 : 0.14 });
          sound(tStart, effectById(style)?.sfx, style === "typewriter" ? -14 : -9);
        }
      }
    }
    if (p.spoken) {
      const lineText = beat.speech === "cta" ? script.cta.text : b?.line?.text ?? "";
      // On a clip the heard part sits where its frames are; a voice-over starts a beat after the cut.
      const at = beat.picture === "clip" && p.spoken.source === "omni" ? start + (p.spoken.from - p.clipOffset) : start + (beat.picture === "end_card" ? 0.4 : 0.25);
      voice.push({
        id: `line-${beat.id}`,
        character: speakerOf(script, b).id,
        text: oneLine(lineText, 400),
        source: p.spoken.source,
        language: "en",
        asset: assetOf(p.spoken.asset) ?? p.spoken.asset,
        from: r2(p.spoken.from),
        to: r2(p.spoken.to),
        at: r2(Math.max(start, at)),
        effects: beat.robot && chosen.has("robot_voice") ? [{ id: "robot_voice", params: {} }] : [],
        cta: beat.speech === "cta",
      });
    }
    t = end;
  }

  const total = r2(t);
  const intro = made["music:intro"] ? assetOf("music:intro") : null;
  const main = music ? assetOf("music:main") : null;
  const face = recipe.id === "twist" ? undefined : assetOf(charKey(script.characters[0]?.id ?? ""));
  const logo = brand.logoRef ? (addAsset("logo", { kind: "image", ref: brand.logoRef }), "logo") : undefined;
  return {
    version: 1,
    recipe: recipe.id,
    effects: concept.effects,
    canvas: { w: CANVAS.w, h: CANVAS.h, fps: CANVAS.fps, seconds: total },
    brand: { name: brand.name, url: brand.url, primary: brand.primary, accent: brand.accent, ...(logo ? { logo } : {}) },
    characters: script.characters.map((c) => ({ id: c.id, name: c.id, ...(made[charKey(c.id)] ? { asset: assetOf(charKey(c.id)) ?? undefined } : {}) })),
    assets,
    segments,
    voice,
    titles,
    captions: { style: concept.captionStyle, y: concept.captionStyle === "one_word" ? 0.66 : 0.7 },
    music: main ? { asset: main, ...(intro ? { intro } : {}), gainDb: -5, duckDb: 11, ...(dropAt !== undefined && dropAt > 0 ? { dropAt: r2(dropAt) } : {}), mainOffset: r2(music?.firstBeat ?? 0), bpm: r2(bpm), beatPulse: chosen.has("beat_cut") } : null,
    sfx: sfx.filter((s) => s.at < total).sort((a, b) => a.at - b.at),
    endCard: { headline: oneLine(script.endCard.headline, 60) || brand.name, button: oneLine(script.endCard.button, 40) || "Get a quote", sub: oneLine(script.endCard.sub, 80), ...(face ? { face } : {}) },
  };
}

/** Effect parameters from the beat: the rewind's label is the beat's title, others take their defaults. */
function paramsFor(id: string, b: ScriptBeat | undefined): Record<string, number | string | boolean> {
  if (id === "tape_rewind") return withDefaults(id, b?.title ? { label: b.title.toUpperCase().slice(0, 28) } : {});
  return withDefaults(id);
}

/** About how long the spoken lines of a script take, to size clips before they exist. */
export const scriptSpeechSeconds = (script: Script) => script.beats.reduce((s, b) => s + (b.line?.text ? speechSeconds(b.line.text) : 0), speechSeconds(script.cta.text));

/** The beat a moment of the finished ad belongs to (for the judge's weakest moment). */
export function segmentAt(edl: Edl, seconds: number): EdlSegment | null {
  return edl.segments.find((s) => seconds >= s.start && seconds < s.end) ?? edl.segments[edl.segments.length - 1] ?? null;
}
