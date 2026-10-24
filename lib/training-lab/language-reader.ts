// The Kinyarwanda the owner teaches, for the language check: voice examples switched on for the language engine, as the
// `extra` of checkLanguage (language.ts). An empty Lab, or a database that cannot be read, gives {} so the check is unchanged.
import "server-only";
import type { LanguageExtra } from "@/lib/video-engine/brain/language";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { languageExtraFrom, wordsOverview, type WordsOverview } from "./language";
import { phrasesOf, type ExampleRow } from "./match";
import { sameLanguageKey } from "./match";

export { sameLanguageKey };

const ROWS = 200;

/**
 * `language`: the business's content language; recordings in another language are left out. A recording with no language is
 * Kinyarwanda (that is what the recordings are for): it counts for Kinyarwanda businesses only, not for English or French ones.
 */
export async function labLanguage(language?: string | null): Promise<LanguageExtra> {
  try {
    const rows = await prisma.trainingExample.findMany({ where: { kind: "voice", engines: { has: "language" } }, orderBy: { createdAt: "desc" }, take: ROWS, select: { kind: true, rating: true, transcript: true, notes: true, engines: true, language: true } });
    const want = language?.trim() ? sameLanguageKey(language) : null;
    return languageExtraFrom(want ? rows.filter((r) => (r.language?.trim() ? sameLanguageKey(r.language) === want : want === sameLanguageKey("Kinyarwanda"))) : rows);
  } catch (error) {
    await logError(error, { source: "training-lab.language", level: "warn" });
    return {};
  }
}

const OVERVIEW_ROWS = 300;

/** Every recording's spellings, words and phrases for the Words tab (read only). Throws if the database cannot be read. */
export async function labWords(): Promise<WordsOverview> {
  const rows = await prisma.trainingExample.findMany({ where: { kind: "voice" }, orderBy: { createdAt: "desc" }, take: OVERVIEW_ROWS });
  return wordsOverview(rows, (r) => phrasesOf({ examples: [{ example: r as unknown as ExampleRow, score: 0 }], avoid: [] }));
}
