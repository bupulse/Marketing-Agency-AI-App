// The script rules (docs/AD_BRAIN.md, section 3.3 and the hard rules): checked on the brain's script before anything
// is paid for. A script that breaks one goes back to the brain once with the problems listed; a second failure stops
// the ad with the problems in plain English. Pure.
//
// 11 Nov 2026 (owner): money words ("free quote") are allowed in AI-video speech (Omni accepted one; a refused clip
// falls back to a TTS voice, pipeline.ts), and the spoken CTA may be any planned soft CTA (ctas.ts), not only the site.

import { carriesCta, type Cta } from "./ctas";

/** Spoken English runs at about 2.5 words a second. */
export const WORDS_PER_SECOND = 2.5;
/** Omni talking clips are at most 10 s, so one line is at most about 25 words. */
export const CLIP_MAX_SECONDS = 10;
export const LINE_MAX_WORDS = 25;
/** The hook must land in the first 2 s: the first line's opening words. */
export const HOOK_WORDS = 5;

export const wordCount = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** About how long a line takes to say, in seconds. */
export const speechSeconds = (text: string) => wordCount(text) / WORDS_PER_SECOND;

/**
 * The Omni clip length to ask for: the line's time plus a breath before and after, 3 to 10 s. A clip is billed per
 * second, so it is never padded more than that.
 */
export const clipSecondsFor = (text: string) => Math.max(3, Math.min(CLIP_MAX_SECONDS, Math.ceil(speechSeconds(text) + 1.5)));

/**
 * Money in speech: Omni refuses a line with a price or "free" (unbilled), and prices belong on screen and in the end
 * card's voice. Matches amounts with a currency, percentages and the usual money words.
 */
const MONEY = /\d[\d.,\s]*\s*(?:rwf|frw|usd|kes|ksh|ugx|tzs|eur|€|\$|£|%)|(?:rwf|frw|usd|kes|ksh|ugx|tzs|eur|€|\$|£)\s*\d|\b(?:free|price[ds]?|pricing|prix|gratuit|cost[s]?|cheap(?:er|est)?|discount(?:ed)?|sale|promo(?:tion)?|deal|francs?|dollars?|shillings?|amafaranga|igiciro)\b/i;
export const hasMoneyWords = (text: string) => MONEY.test(text);

/**
 * A line that reads as Kinyarwanda (hard rule 3: no AI Kinyarwanda voice). A few very common words that do not occur
 * in English or French; two of them in one line is enough.
 */
const KINYARWANDA = /\b(muraho|murakoze|amakuru|ndabona|cyane|ariko|kandi|mwiriwe|mwaramutse|yego|oya|ubu|ibyo|uyu|iyi|aho|nka|kuri|ndashaka|nawe|turi|mufite|mushaka|ubucuruzi|abakiriya|imbuga|nkoranyambaga)\b/gi;
export const looksKinyarwanda = (text: string) => (text.match(KINYARWANDA) ?? []).length >= 2;

/** True when a spoken line tells people where to go: the site's name, said or written ("bupulse dot com"). */
export function mentionsSite(text: string, url: string): boolean {
  const host = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  const [name] = host.split(".");
  const t = text.toLowerCase().replace(/[-\s]+/g, " ");
  const said = t.replace(/\s+dot\s+/g, ".").replace(/\s/g, "");
  // "boo pulse", "bu pulse" and "bupulse" all count as the brand's name.
  const loose = (s: string) => s.replace(/oo/g, "u").replace(/\s/g, "");
  return said.includes(host) || (loose(t).includes(loose(name)) && /\b(dot com|\.com|com)\b|\.com/.test(t));
}

/**
 * The text a voice engine reads. Gemini TTS reads everything aloud (no style words: "Say excitedly:" is spoken), so the
 * text is plain; the brand is spelled the way it should sound ("Boo Pulse", "Boo Pulse dot com").
 */
export function speakable(text: string, source: "omni" | "tts" | "recorded", brand = "BuPulse"): string {
  let t = text.replace(/\s+/g, " ").trim();
  // A style direction in brackets or before a colon would be read aloud.
  t = t.replace(/^\s*\(?(say|says|said|whisper|shout)[^:)]*[:)]\s*/i, "").replace(/\[[^\]]*\]/g, "").trim();
  if (source !== "tts") return t;
  if (/^bupulse$/i.test(brand)) {
    t = t.replace(/\bbupulse\.com\b/gi, "Boo Pulse dot com").replace(/\bbupulse\b/gi, "Boo Pulse");
  }
  return t.replace(/\b([a-z0-9-]+)\.com\b/gi, "$1 dot com");
}

export type ScriptLine = { speaker: string; text: string; source: "omni" | "tts" };
export type ScriptBeat = { beat: string; line?: ScriptLine | null; scene?: string | null; action?: string | null; title?: string | null; screens?: { id: string; title: string }[]; product?: string | null };
export type ScriptCharacter = { id: string; gender: "man" | "woman" | "other"; look: string; variantOf?: string | null; change?: string | null };
export type Script = {
  characters: ScriptCharacter[];
  beats: ScriptBeat[];
  cta: ScriptLine;
  caption: string;
  hashtags: string[];
  endCard: { headline: string; button: string; sub: string };
};

export type ScriptContext = {
  brandName: string;
  url: string;
  /** Everything the ad may claim: the brand brief's provable claims and facts, as text. */
  facts: string;
  /** Beat ids of the recipe, in order, and which ones carry a line. */
  beats: { id: string; speech: "line" | "none" | "cta"; picture?: string; titleWords?: number; screens?: { min: number; max: number } }[];
  screenIds: string[];
  /** The planned CTA (ctas.ts): the spoken CTA must carry it (or name the site). */
  cta?: Cta;
};

/** Numbers that read as claims: an amount, a percentage, a count of customers, sales, views, times... */
const CLAIM_NUMBER = /(\d[\d.,]*)\s*(%|x\b|times\b|percent\b|customers?\b|clients?\b|users?\b|businesses\b|sales\b|followers?\b|views?\b|likes?\b|leads?\b|orders?\b|stars?\b|k\b|rwf\b|frw\b|usd\b|\$)/gi;

/**
 * Checks a script against the rules. Returns problems in plain English (empty: fine). The brain gets them back once.
 */
export function checkScript(script: Script, ctx: ScriptContext): string[] {
  const out: string[] = [];
  const brand = ctx.brandName.toLowerCase();
  const byBeat = new Map(script.beats.map((b) => [b.beat, b]));
  for (const b of ctx.beats) {
    const got = byBeat.get(b.id);
    // The call to action is checked below; a silent end card needs nothing from the script.
    if (b.speech === "cta" || (b.picture === "end_card" && b.speech === "none")) continue;
    if (!got) {
      out.push(`Beat "${b.id}" is missing.`);
      continue;
    }
    if (b.speech === "line" && !got.line?.text?.trim()) out.push(`Beat "${b.id}" needs a spoken line.`);
    if (b.speech === "none" && got.line?.text?.trim()) out.push(`Beat "${b.id}" has no speech; move its line to a speaking beat or a title.`);
    if (got.title && b.titleWords && wordCount(got.title) > b.titleWords) out.push(`The title of "${b.id}" has ${wordCount(got.title)} words; at most ${b.titleWords}.`);
    if (b.screens) {
      const picks = got.screens ?? [];
      if (picks.length < b.screens.min) out.push(`Beat "${b.id}" needs at least ${b.screens.min} real screens (it has ${picks.length}).`);
      for (const p of picks) if (!ctx.screenIds.includes(p.id)) out.push(`Screen "${p.id}" is not one of the real captures.`);
    }
  }
  // Hook: the first spoken line opens the ad; it must not open with the brand.
  const firstSpeaking = ctx.beats.find((b) => b.speech === "line");
  const first = firstSpeaking ? byBeat.get(firstSpeaking.id)?.line?.text ?? "" : "";
  if (first && first.toLowerCase().split(/\s+/).slice(0, HOOK_WORDS).some((w) => w.replace(/[^\p{L}]/gu, "") === brand.replace(/[^\p{L}]/gu, ""))) out.push("The ad opens with the brand name; open with a claim, a confession, a question or a pattern break instead.");
  const lines = [...script.beats.flatMap((b) => (b.line?.text ? [{ ...b.line, beat: b.beat }] : [])), { ...script.cta, beat: "end" }];
  for (const l of lines) {
    const n = wordCount(l.text);
    if (l.source === "omni" && n > LINE_MAX_WORDS) out.push(`The line in "${l.beat}" has ${n} words; an AI clip holds at most ${LINE_MAX_WORDS} (10 s).`);
    if (looksKinyarwanda(l.text)) out.push(`The line in "${l.beat}" is in Kinyarwanda; AI voices speak English only (Kinyarwanda needs a real recorded voice).`);
    if (/\bai[\s-]*generated\b/i.test(l.text)) out.push(`The line in "${l.beat}" announces it is AI-generated; the platform's own AI label does that.`);
  }
  // The spoken call to action: last, names the site.
  if (!script.cta?.text?.trim()) out.push("There is no spoken call to action.");
  else if (!mentionsSite(script.cta.text, ctx.url) && !(ctx.cta && carriesCta(script.cta.text, ctx.cta))) out.push(ctx.cta ? `The spoken call to action must be the planned one: "${ctx.cta.spoken}" (the actor says it, in her own words around it).` : `The call to action must say where to go (${ctx.url}), for example "Check out ${ctx.brandName} dot com".`);
  // No invented numbers: a number that reads as a claim must come from the facts.
  const facts = ctx.facts.toLowerCase();
  const texts = [...lines.map((l) => l.text), ...script.beats.flatMap((b) => [b.title ?? "", ...(b.screens ?? []).map((s) => s.title)]), script.caption, script.endCard.headline, script.endCard.sub];
  for (const t of texts) {
    for (const m of t.matchAll(CLAIM_NUMBER)) if (!facts.includes(m[1].replace(/,/g, "")) && !facts.includes(m[1])) out.push(`"${m[0].trim()}" is a number that is not in the business's facts; never invent numbers.`);
  }
  if (!script.caption?.trim()) out.push("The post caption is missing.");
  return [...new Set(out)];
}
