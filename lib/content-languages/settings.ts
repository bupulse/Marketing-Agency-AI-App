// Content languages (Posts -> Settings, "Languages"): the language of the posts BuPulse makes, chosen separately for
// images + captions, daily videos with voice-over (voice, subtitles and caption) and talking skits (what the people
// say). Each is one language, or a mix: BuPulse picks one language per post and day (never two inside one post).
// Stored as Business.dailyPostSettings.languages (JSON, beside the daily posts choices; no migration), validated here.
// Pure and client-safe, so the settings form, the engines, the skits and the tests share it. Missing or unreadable
// means the default, part by part: Kinyarwanda for a business in Rwanda, else its content language, else English.
import { z } from "zod";
import { CONTENT_LANGUAGES, isContentLanguage, type ContentLanguage } from "@/lib/brand/languages";

export type LanguageChoice = { mode: "one"; language: ContentLanguage } | { mode: "mix"; languages: ContentLanguage[] };

export interface ContentLanguages {
  /** The text on the picture and the post caption. */
  images: LanguageChoice;
  /** Daily videos with voice-over: the voice, the subtitles and the caption. */
  videos: LanguageChoice;
  /** Talking skits: what the people say (lib/skits). */
  skits: LanguageChoice;
}

export type LanguagePart = keyof ContentLanguages;
export const LANGUAGE_PARTS: readonly LanguagePart[] = ["images", "videos", "skits"];

/** The languages offered in the form: the four of East Africa first, then the rest of CONTENT_LANGUAGES. */
export const LANGUAGE_OPTIONS: readonly ContentLanguage[] = ["English", "Kinyarwanda", "French", "Swahili", ...CONTENT_LANGUAGES.filter((l) => !["English", "Kinyarwanda", "French", "Swahili"].includes(l))];

/** A mix has at least two languages and at most this many. */
export const MAX_MIX = 4;

const languageSchema = z.enum(CONTENT_LANGUAGES as unknown as [ContentLanguage, ...ContentLanguage[]]);

export const languageChoiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("one"), language: languageSchema }).strict(),
  z
    .object({ mode: z.literal("mix"), languages: z.array(languageSchema).min(2, "Choose at least two languages for a mix.").max(MAX_MIX, `Choose up to ${MAX_MIX} languages for a mix.`) })
    .strict()
    .refine((c) => new Set(c.languages).size === c.languages.length, "Choose each language once."),
]);

export const contentLanguagesSchema = z.object({ images: languageChoiceSchema, videos: languageChoiceSchema, skits: languageChoiceSchema }).strict();

export type ContentLanguagesInput = z.input<typeof contentLanguagesSchema>;

/** What the business is: its sign-up country (a name like "Rwanda" or a code like "RW") and Business.contentLanguage. */
export type LanguageContext = { country?: string | null; contentLanguage?: string | null };

const ALIASES: Record<string, ContentLanguage> = { rw: "Kinyarwanda", kin: "Kinyarwanda", ikinyarwanda: "Kinyarwanda", en: "English", eng: "English", fr: "French", francais: "French", français: "French", sw: "Swahili", kiswahili: "Swahili" };

/** A language name or code ("Kinyarwanda", "kinyarwanda", "rw", "fr") as a ContentLanguage, or null. Pure. */
export function toContentLanguage(value: unknown): ContentLanguage | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return ALIASES[key] ?? CONTENT_LANGUAGES.find((l) => l.toLowerCase() === key) ?? null;
}

/** True for a business in Rwanda (country "Rwanda" or "RW"). */
export function inRwanda(country: string | null | undefined): boolean {
  const c = (country ?? "").trim().toLowerCase();
  return c === "rwanda" || c === "rw";
}

/** The default language: Kinyarwanda in Rwanda, else the content language, else English. */
export function defaultLanguage(ctx: LanguageContext): ContentLanguage {
  if (inRwanda(ctx.country)) return "Kinyarwanda";
  return toContentLanguage(ctx.contentLanguage) ?? "English";
}

export function defaultContentLanguages(ctx: LanguageContext): ContentLanguages {
  const one: LanguageChoice = { mode: "one", language: defaultLanguage(ctx) };
  return { images: one, videos: { ...one }, skits: { ...one } };
}

/**
 * The stored JSON (Business.dailyPostSettings.languages) as full choices; any part missing or unreadable falls back to
 * the default, part by part, so businesses that never saved one keep working.
 */
export function readContentLanguages(value: unknown, ctx: LanguageContext): ContentLanguages {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const fallback = defaultContentLanguages(ctx);
  const part = (key: LanguagePart): LanguageChoice => {
    const parsed = languageChoiceSchema.safeParse(v[key]);
    return parsed.success ? parsed.data : fallback[key];
  };
  return { images: part("images"), videos: part("videos"), skits: part("skits") };
}

/** Every language a choice may use: the one, or the mix in its order. */
export function choiceLanguages(choice: LanguageChoice): ContentLanguage[] {
  return choice.mode === "one" ? [choice.language] : [...choice.languages];
}

/** "Kinyarwanda" / "Mix: English, Kinyarwanda". */
export function choiceText(choice: LanguageChoice): string {
  return choice.mode === "one" ? choice.language : `Mix: ${choice.languages.join(", ")}`;
}

// Days since 1970-01-01 of a "YYYY-MM-DD" day key (lib/publishing/time.ts dayKey), so a mix turns one language a day.
function dayNumber(dayKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dayKey);
  if (!m) return 0;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/**
 * The language of one post or video. One language: that one. A mix: the plan's `hint` when it is one of the mix (the
 * content plan may say a post reads best in, say, English), else the mix in turn by day (day 1 English, day 2
 * Kinyarwanda...). `offset` (e.g. the post's number that day) moves it on, so several posts of one day can differ.
 * Deterministic: the same day, hint and offset always give the same language. Pure.
 */
export function pickLanguage(choice: LanguageChoice, opts: { dayKey: string; hint?: string | null; offset?: number }): ContentLanguage {
  if (choice.mode === "one") return choice.language;
  const langs = choice.languages.filter(isContentLanguage);
  if (langs.length === 0) return "English";
  const hinted = toContentLanguage(opts.hint);
  if (hinted && langs.includes(hinted)) return hinted;
  const n = dayNumber(opts.dayKey) + Math.max(0, Math.floor(opts.offset ?? 0));
  return langs[((n % langs.length) + langs.length) % langs.length];
}
