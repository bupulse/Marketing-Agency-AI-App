// The owner's spellings applied to what an engine wrote (docs/TRAINING_LAB.md): each whole word the owner marked wrong, with
// the right spelling given, is replaced; then the language check runs on the result. No AI call, no rewrite, no retry. Pure.
import { checkLanguage, type LanguageExtra, type LanguageIssue } from "@/lib/video-engine/brain/language";

export type SpellingFix = { from: string; to: string };

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `fix` in the case of the word it replaces: a capital first letter stays a capital. */
const sameCase = (found: string, fix: string) => (found[0] !== found[0].toLowerCase() && found[0] === found[0].toUpperCase() ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix);

// Characters that make a word part of a longer one: "Nez-Beauty" and "a/b" are one word each, and so is "www.x.rw" (a "."
// between letters or digits); the "." that ends a sentence is not.
const BEFORE = String.raw`(?<![\p{L}\p{N}'\-/]|[\p{L}\p{N}]\.)`;
const AFTER = String.raw`(?![\p{L}\p{N}'\-/]|\.[\p{L}\p{N}])`;

/** The stretches of the text that must stay as written: links, emails, hashtags, @handles, and the given names. */
function protectedRanges(text: string, protect: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const token = m[0].replace(/^[("'“‘]+/, "");
    if (token.includes("://") || /www\./i.test(token) || token.includes("@") || token.startsWith("#")) out.push([m.index, m.index + m[0].length]);
  }
  for (const name of protect) {
    const n = name?.trim();
    if (!n || n.length < 2) continue;
    for (const m of text.matchAll(new RegExp(escapeRe(n), "giu"))) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/**
 * Replaces each whole-word spelling the owner marked wrong that has a fix (case-insensitive, the first letter's case kept).
 * A wrong word with no fix is left alone (the language check reports it). Never inside a link, an email, a hashtag or an @handle,
 * nor inside a name in `protect` (the business and product names), nor as part of a longer word ("Nez-Beauty"). Returns the text
 * and every change made.
 */
export function fixSpellings(text: string, extra: LanguageExtra | null | undefined, protect: readonly (string | null | undefined)[] = []): { text: string; changes: SpellingFix[] } {
  const fixes = new Map<string, string>();
  for (const w of extra?.wrong ?? []) {
    const word = w.word.trim();
    const fix = w.fix?.trim();
    if (word && fix && !fixes.has(word.toLowerCase())) fixes.set(word.toLowerCase(), fix);
  }
  if (!text || fixes.size === 0) return { text, changes: [] };
  const words = [...fixes.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`${BEFORE}(?:${words.join("|")})${AFTER}`, "giu");
  const keep = protectedRanges(text, protect.filter((p): p is string => !!p));
  const changes: SpellingFix[] = [];
  const out = text.replace(re, (found, ...rest) => {
    const at = rest[rest.length - 2] as number;
    if (keep.some(([from, to]) => at < to && at + found.length > from)) return found;
    const to = sameCase(found, fixes.get(found.toLowerCase())!);
    if (to !== found) changes.push({ from: found, to });
    return to;
  });
  return { text: out, changes };
}

/** The lines under the examples and the phrases in every writer's Lab block (the examples come from other businesses). */
export const OTHER_BUSINESSES_NOTE = "These are other businesses' examples: never use their names, products, prices or contact details.";
export const PLACEHOLDER_NOTE = "Words in braces such as {price} or {phone} are hidden details: never write braces or those words.";

const PLACEHOLDER = /\{(?:price|phone|website|email)\}/i;

/**
 * Takes out every sentence that has a hidden-detail placeholder ({price}, {phone}, {website}, {email}) in it: the Lab's
 * example lines carry them in place of other businesses' details, and a writer must never print them. Lines stay lines. Free.
 */
export function dropPlaceholderSentences(text: string): string {
  if (!PLACEHOLDER.test(text)) return text;
  return text
    .split("\n")
    .map((line) => (PLACEHOLDER.test(line) ? line.split(/(?<=[.!?])\s+/).filter((sentence) => !PLACEHOLDER.test(sentence)).join(" ") : line))
    .join("\n")
    .trim();
}

/** The owner's spellings fixed, then the placeholder sentences dropped: what every writer's text goes through after writing. */
export function polishText(text: string, extra: LanguageExtra | null | undefined, protect: readonly (string | null | undefined)[] = []): string {
  return dropPlaceholderSentences(fixSpellings(text, extra, protect).text);
}

export type ReelTexts = { title: string; caption: string; clips: { line: string }[] };
export type LanguageNote = { where: string; found: string; message: string; suggestion: string | null };
export type SpellingFixNote = SpellingFix & { where: string };

/**
 * A reel plan's title, caption and spoken lines with the owner's spellings fixed, and the language issues that remain.
 * The lines are the ones Veo will speak and the subtitles show: a fix changes only the text, and nothing has been filmed
 * at planning time, so no clip is made twice. Plans without anything to fix come back with equal text.
 */
export function polishReelTexts<T extends ReelTexts>(plan: T, language: string, extra: LanguageExtra | null | undefined, protect: readonly (string | null | undefined)[] = []): { plan: T; fixes: SpellingFixNote[]; issues: LanguageNote[] } {
  const fixes: SpellingFixNote[] = [];
  const fix = (text: string, where: string) => {
    const r = fixSpellings(text, extra, protect);
    for (const c of r.changes) fixes.push({ where, ...c });
    return dropPlaceholderSentences(r.text);
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
