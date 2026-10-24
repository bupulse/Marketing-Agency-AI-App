// The owner's spellings applied to what an engine wrote (docs/TRAINING_LAB.md): each whole word the owner marked wrong, with
// the right spelling given, is replaced; then the language check runs on the result. No AI call, no rewrite, no retry. Pure.
import { checkLanguage, type LanguageExtra, type LanguageIssue } from "@/lib/video-engine/brain/language";

export type SpellingFix = { from: string; to: string };

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `fix` in the case of the word it replaces: a capital first letter stays a capital. */
const sameCase = (found: string, fix: string) => (found[0] !== found[0].toLowerCase() && found[0] === found[0].toUpperCase() ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix);

/**
 * Replaces each whole-word spelling the owner marked wrong that has a fix (case-insensitive, the first letter's case kept).
 * A wrong word with no fix is left alone (the language check reports it). Returns the text and every change made.
 */
export function fixSpellings(text: string, extra: LanguageExtra | null | undefined): { text: string; changes: SpellingFix[] } {
  const fixes = new Map<string, string>();
  for (const w of extra?.wrong ?? []) {
    const word = w.word.trim();
    const fix = w.fix?.trim();
    if (word && fix && !fixes.has(word.toLowerCase())) fixes.set(word.toLowerCase(), fix);
  }
  if (!text || fixes.size === 0) return { text, changes: [] };
  const words = [...fixes.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(?<![\\p{L}\\p{N}'])(?:${words.join("|")})(?![\\p{L}\\p{N}'])`, "giu");
  const changes: SpellingFix[] = [];
  const out = text.replace(re, (found) => {
    const to = sameCase(found, fixes.get(found.toLowerCase())!);
    if (to !== found) changes.push({ from: found, to });
    return to;
  });
  return { text: out, changes };
}

export type ReelTexts = { title: string; caption: string; clips: { line: string }[] };
export type LanguageNote = { where: string; found: string; message: string; suggestion: string | null };
export type SpellingFixNote = SpellingFix & { where: string };

/**
 * A reel plan's title, caption and spoken lines with the owner's spellings fixed, and the language issues that remain.
 * The lines are the ones Veo will speak and the subtitles show: a fix changes only the text, and nothing has been filmed
 * at planning time, so no clip is made twice. Plans without anything to fix come back with equal text.
 */
export function polishReelTexts<T extends ReelTexts>(plan: T, language: string, extra: LanguageExtra | null | undefined): { plan: T; fixes: SpellingFixNote[]; issues: LanguageNote[] } {
  const fixes: SpellingFixNote[] = [];
  const fix = (text: string, where: string) => {
    const r = fixSpellings(text, extra);
    for (const c of r.changes) fixes.push({ where, ...c });
    return r.text;
  };
  const polished: T = { ...plan, title: fix(plan.title, "title"), caption: fix(plan.caption, "caption"), clips: plan.clips.map((c, i) => ({ ...c, line: fix(c.line, `clip ${i + 1} line`) })) };
  const texts = [
    { where: "title", text: polished.title, kind: "caption" as const },
    { where: "caption", text: polished.caption, kind: "caption" as const },
    ...polished.clips.map((c, i) => ({ where: `clip ${i + 1} line`, text: c.line, kind: "screen" as const })),
  ];
  const issues = checkLanguage(texts, language, extra ?? {}).map((i: LanguageIssue) => ({ where: i.where, found: i.found, message: i.message, suggestion: i.suggestion }));
  return { plan: polished, fixes, issues };
}
