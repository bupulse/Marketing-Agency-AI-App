// What the engines read from the Training Lab: a bounded query, then match.ts ranks it. An empty Lab, or a database
// that cannot be read, gives empty lists, so an engine plans exactly as it did before the Lab.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { HOOK_IDEAS } from "@/lib/video-engine/brain/viral";
import type { ViralVideo } from "@/lib/video-engine/brain/viral-ingest";
import { exampleIdsOf, labLines, LOW_RATING, rankExamples, usable, type ExampleRow, type LabLines, type Want } from "./match";
import type { TrainingEngine } from "./types";
import { viralRowsFrom } from "./viral-rows";

export const READ_ROWS = 300;
export type Lab = LabLines & { exampleIds: string[] };
const EMPTY = (): Lab => ({ examples: [], avoid: [], phrases: [], exampleIds: [] });

/** The best matching examples for an engine, the "never this" notes and the phrases, and the ids that were read. */
export async function labFor(want: Want, opts: { maxChars?: number; now?: Date } = {}): Promise<Lab> {
  try {
    const rows = await prisma.trainingExample.findMany({
      where: { engines: { has: want.engine }, ...(want.kinds?.length ? { kind: { in: want.kinds } } : {}) },
      orderBy: { createdAt: "desc" },
      take: READ_ROWS,
    });
    if (!rows.length) return EMPTY();
    const ranked = rankExamples(rows as ExampleRow[], want, opts.now);
    return { ...labLines(ranked, { maxChars: opts.maxChars }), exampleIds: exampleIdsOf(ranked) };
  } catch (error) {
    await logError(error, { source: "training-lab.reader", level: "warn" });
    return EMPTY();
  }
}

export type LabViral = { rows: ViralVideo[]; avoidIds: string[]; avoidHooks: string[] };
const NO_VIRAL = (): LabViral => ({ rows: [], avoidIds: [], avoidHooks: [] });
const VIRAL_ENGINES: TrainingEngine[] = ["video", "reel"];

/** The opening type an example names itself (notes hook_type, or a technique or tag that is one), never a guess. */
function namedHook(e: ExampleRow): string | null {
  const notes = e.notes && typeof e.notes === "object" && !Array.isArray(e.notes) ? (e.notes as Record<string, unknown>) : {};
  return [notes.hook_type, ...e.technique, ...e.tags].map((t) => (typeof t === "string" ? t.trim().toLowerCase() : "")).find((t) => !!t && Object.hasOwn(HOOK_IDEAS, t)) ?? null;
}

/**
 * The owner's Lab reels and videos for the viral recipe (lib/video-engine/brain/viral.ts RecipeInput.lab and .avoid):
 * the examples switched on for the video or reel engine, as viral rows (viral-rows.ts), and what never to copy: the
 * "lab:<id>" of the ones rated 1 or 2 stars, and the opening types those name. The recipe ranks by sector and language
 * itself. Empty on any error, so a recipe is made exactly as before.
 */
export async function labViralRows(): Promise<LabViral> {
  try {
    const rows = (await prisma.trainingExample.findMany({
      where: { kind: { in: ["reel", "video"] }, engines: { hasSome: VIRAL_ENGINES } },
      orderBy: { createdAt: "desc" },
      take: READ_ROWS,
    })) as ExampleRow[];
    const open = rows.filter((e) => VIRAL_ENGINES.some((engine) => usable(e, { engine })));
    const low = open.filter((e) => e.rating !== null && e.rating <= LOW_RATING);
    return {
      rows: viralRowsFrom(open),
      avoidIds: low.map((e) => `lab:${e.id}`),
      avoidHooks: [...new Set(low.map(namedHook).filter((h): h is string => !!h))],
    };
  } catch (error) {
    await logError(error, { source: "training-lab.reader.viral", level: "warn" });
    return NO_VIRAL();
  }
}
