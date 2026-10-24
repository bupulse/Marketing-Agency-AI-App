// The Kinyarwanda the owner teaches, for the language check: voice examples switched on for the language engine, as the
// `extra` of checkLanguage (language.ts). An empty Lab, or a database that cannot be read, gives {} so the check is unchanged.
import "server-only";
import type { LanguageExtra } from "@/lib/video-engine/brain/language";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { languageExtraFrom } from "./language";
import { sameLanguageKey } from "./match";

export { sameLanguageKey };

const ROWS = 200;

/** `language`: the business's content language; examples in another language are left out (examples with none count). */
export async function labLanguage(language?: string | null): Promise<LanguageExtra> {
  try {
    const rows = await prisma.trainingExample.findMany({ where: { kind: "voice", engines: { has: "language" } }, orderBy: { createdAt: "desc" }, take: ROWS, select: { kind: true, rating: true, transcript: true, notes: true, engines: true, language: true } });
    const want = language?.trim() ? sameLanguageKey(language) : null;
    return languageExtraFrom(want ? rows.filter((r) => !r.language?.trim() || sameLanguageKey(r.language) === want) : rows);
  } catch (error) {
    await logError(error, { source: "training-lab.language", level: "warn" });
    return {};
  }
}
