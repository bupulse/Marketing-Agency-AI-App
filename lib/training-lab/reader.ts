// What the engines read from the Training Lab: a bounded query, then match.ts ranks it. An empty Lab, or a database
// that cannot be read, gives empty lists, so an engine plans exactly as it did before the Lab.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { exampleIdsOf, labLines, rankExamples, type ExampleRow, type LabLines, type Want } from "./match";

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
