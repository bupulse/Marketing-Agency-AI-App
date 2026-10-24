// The Kinyarwanda the owner teaches (kind "voice" examples, docs/TRAINING_LAB.md): the spellings to avoid and the words
// that are right, kept in the example's `notes` beside the AI-drafted note fields. languageExtraFrom turns the examples
// into what checkLanguage (lib/video-engine/brain/language.ts) takes as `extra`. Pure; the database read is language-reader.ts.
import type { LanguageExtra } from "@/lib/video-engine/brain/language";

export type Wrong = { word: string; fix?: string };
export type VoiceExtras = { wrong: Wrong[]; words: string[] };
export type LanguageExample = { kind: string; rating: number | null; transcript: string | null; notes: unknown; engines: string[]; language?: string | null };

export const WORD_MAX = 60;
export const LINES_MAX = 200;
const MIN_WORD = 3;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** The first of each key. */
const uniqBy = <T>(list: T[], key: (t: T) => string) => {
  const seen = new Set<string>();
  return list.filter((t) => !seen.has(key(t)) && !!seen.add(key(t)));
};

/** The extras stored in a voice example's notes; anything malformed is skipped. */
export function readVoiceExtras(notes: unknown): VoiceExtras {
  const o = notes && typeof notes === "object" && !Array.isArray(notes) ? (notes as Record<string, unknown>) : {};
  const wrong = (Array.isArray(o.wrong) ? o.wrong : []).flatMap((w): Wrong[] => {
    if (!w || typeof w !== "object") return [];
    const { word, fix } = w as Record<string, unknown>;
    const x = typeof word === "string" ? clean(word) : "";
    const f = typeof fix === "string" ? clean(fix) : "";
    return x && x.length <= WORD_MAX ? [{ word: x, ...(f ? { fix: f } : {}) }] : [];
  });
  const words = (Array.isArray(o.words) ? o.words : []).filter((w): w is string => typeof w === "string").map(clean).filter((w) => w && w.length <= WORD_MAX);
  return { wrong, words };
}

/** "wrong -> right" or just "wrong", one per line. */
export function parseWrongSpellings(text: string | null | undefined): { wrong: Wrong[]; problem: string | null } {
  const lines = (text ?? "").split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.length > LINES_MAX) return { wrong: [], problem: `Keep the spellings to avoid to ${LINES_MAX} lines.` };
  const wrong: Wrong[] = [];
  for (const line of lines) {
    const [a, ...rest] = line.split(/\s*(?:->|→|=>)\s*/);
    const word = clean(a ?? "");
    const fix = clean(rest.join(" "));
    if (!word) return { wrong: [], problem: `"${line}": write the wrong spelling first, like "wrong -> right".` };
    if (word.length > WORD_MAX || fix.length > WORD_MAX) return { wrong: [], problem: `"${line.slice(0, 30)}…" is too long: one word or short phrase per line.` };
    if (line.includes("->") && !fix) return { wrong: [], problem: `"${line}": write the right spelling after the arrow, or leave the arrow out.` };
    wrong.push({ word, ...(fix ? { fix } : {}) });
  }
  return { wrong: uniqBy(wrong, (w) => w.word.toLowerCase()), problem: null };
}

/** Words or short phrases separated by commas or new lines. */
export function parseApprovedWords(text: string | null | undefined): { words: string[]; problem: string | null } {
  const words = (text ?? "").split(/[,\n]+/).map(clean).filter(Boolean);
  if (words.some((w) => w.length > WORD_MAX)) return { words: [], problem: "Each right word or phrase must be short; separate them with commas." };
  if (words.length > LINES_MAX) return { words: [], problem: `Keep the right words to ${LINES_MAX}.` };
  return { words: uniqBy(words, (w) => w.toLowerCase()), problem: null };
}

/** The form's two boxes as the extras, or the first plain-English problem. */
export function buildVoiceExtras(form: { wrong?: string; words?: string } | null | undefined): { extras: VoiceExtras; problem: string | null } {
  const w = parseWrongSpellings(form?.wrong);
  const a = parseApprovedWords(form?.words);
  return { extras: { wrong: w.wrong, words: a.words }, problem: w.problem ?? a.problem };
}

/** The notes with the extras set (the AI-drafted fields stay). Null when nothing is left. */
export function withVoiceExtras(notes: unknown, extras: VoiceExtras): Record<string, unknown> | null {
  const base = notes && typeof notes === "object" && !Array.isArray(notes) ? { ...(notes as Record<string, unknown>) } : {};
  delete base.wrong;
  delete base.words;
  if (extras.wrong.length) base.wrong = extras.wrong;
  if (extras.words.length) base.words = extras.words;
  return Object.keys(base).length ? base : null;
}

/** The two boxes' text for the edit form. */
export function extrasText(notes: unknown): { wrong: string; words: string } {
  const e = readVoiceExtras(notes);
  return { wrong: e.wrong.map((w) => (w.fix ? `${w.word} -> ${w.fix}` : w.word)).join("\n"), words: e.words.join(", ") };
}

/** For the card: "Spellings to avoid: a → b; c" and "Words that are right: x, y" (null when empty). */
export function describeExtras(notes: unknown): { wrong: string | null; words: string | null } {
  const e = readVoiceExtras(notes);
  return { wrong: e.wrong.length ? e.wrong.map((w) => (w.fix ? `${w.word} → ${w.fix}` : w.word)).join("; ") : null, words: e.words.length ? e.words.join(", ") : null };
}

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}][\p{L}']*/gu) ?? [];

/**
 * What the Lab adds to checkLanguage: `words` = the approved words plus the words of the transcripts of voice
 * examples rated 3 or more (or unrated), lower case, no repeats, none shorter than 3 letters; `wrong` = every spelling to
 * avoid. Only voice examples switched on for the language engine count; a spelling marked wrong is never also approved.
 */
export function languageExtraFrom(examples: readonly LanguageExample[]): LanguageExtra {
  const voice = examples.filter((e) => e.kind === "voice" && e.engines.includes("language"));
  const wrong = uniqBy(voice.flatMap((e) => readVoiceExtras(e.notes).wrong), (w) => w.word.toLowerCase());
  const bad = new Set(wrong.map((w) => w.word.toLowerCase()));
  const approved = voice.flatMap((e) => readVoiceExtras(e.notes).words.map((w) => w.toLowerCase()));
  const spoken = voice.filter((e) => e.rating === null || e.rating >= 3).flatMap((e) => wordsOf(e.transcript ?? "").filter((w) => w.length >= MIN_WORD));
  const words = [...new Set([...approved, ...spoken])].filter((w) => !bad.has(w));
  return { ...(words.length ? { words } : {}), ...(wrong.length ? { wrong } : {}) };
}

// ---- Everything the Lab teaches about the language, in one place (the Words tab)

export type WordSource = { id: string; title: string; on: boolean };
export type WordsOverview = {
  wrong: (Wrong & WordSource)[];
  words: ({ word: string } & WordSource)[];
  phrases: ({ phrase: string } & WordSource)[];
  recordings: number;
};
type OverviewRow = LanguageExample & { id: string; title: string };

/**
 * The owner's spellings to avoid, right words and phrases from every recording, each with the recording it came from
 * (and whether it is switched on for the language engine). The first of each is kept; newest recordings first.
 */
export function wordsOverview(rows: readonly OverviewRow[], phrasesOf: (row: OverviewRow) => string[]): WordsOverview {
  const voice = rows.filter((r) => r.kind === "voice");
  const seen = { wrong: new Set<string>(), words: new Set<string>(), phrases: new Set<string>() };
  const out: WordsOverview = { wrong: [], words: [], phrases: [], recordings: voice.length };
  for (const r of voice) {
    const src: WordSource = { id: r.id, title: r.title, on: r.engines.includes("language") };
    const extras = readVoiceExtras(r.notes);
    const fresh = (set: Set<string>, key: string) => {
      if (set.has(key)) return false;
      set.add(key);
      return true;
    };
    for (const w of extras.wrong) if (fresh(seen.wrong, w.word.toLowerCase())) out.wrong.push({ ...w, ...src });
    for (const word of extras.words) if (fresh(seen.words, word.toLowerCase())) out.words.push({ word, ...src });
    for (const phrase of phrasesOf(r)) if (fresh(seen.phrases, phrase)) out.phrases.push({ phrase, ...src });
  }
  return out;
}
