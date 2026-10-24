import "server-only";
// "Lab health" at the top of the Library (docs/TRAINING_LAB.md): what makes an example useless to the engines or risky,
// in plain words, each with the example it is about. One bounded read; the checks themselves are pure (labHealth).
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { LOW_RATING } from "./match";
import { parseScheduleNotes } from "./schedule";

export const HEALTH_ROWS = 500;
export const HEALTH_SHOWN = 8;

export type HealthRow = { id: string; kind: string; title: string; path: string | null; mime: string | null; sourceUrl: string | null; engines: string[]; consentGiven: boolean; transcript: string | null; rating: number | null; neverThis: string | null; notes: unknown };
export type HealthIssue = { id: string; title: string; problem: string };

const fromVideo = (notes: unknown) => (notes && typeof notes === "object" && !Array.isArray(notes) && typeof (notes as { from_video?: unknown }).from_video === "string" ? (notes as { from_video: string }).from_video : null);

/**
 * What is wrong with each example, newest first: the risky ones (an actor without consent) and the ones no engine can
 * use. `missing`: examples whose file is gone from Storage (the page knows it from the signed links).
 */
export function labHealth(rows: readonly HealthRow[], missing: ReadonlySet<string> = new Set()): HealthIssue[] {
  const portraitsOf = new Set(rows.map((r) => fromVideo(r.notes)).filter((v): v is string => !!v));
  const out: HealthIssue[] = [];
  for (const r of rows) {
    const add = (problem: string) => out.push({ id: r.id, title: r.title, problem });
    if (r.kind === "actor" && !r.consentGiven) add("Never used: no consent.");
    if (!r.engines.length) add("No engine reads it: switch at least one on.");
    if (r.kind === "actor" && r.consentGiven && r.engines.includes("presenter") && (r.mime ?? "").startsWith("video/") && !portraitsOf.has(r.id)) add("Make a portrait from the video: the presenters use photos only.");
    if (r.kind === "voice" && !r.transcript?.trim()) add("Write what is said in the recording.");
    if (r.kind === "voice" && r.engines.length && !r.engines.includes("language")) add("Switch on Kinyarwanda words and captions, or the writers never hear it.");
    if (r.kind === "schedule" && !parseScheduleNotes(r.notes)) add("The posting habit cannot be read: edit it and give hours or days.");
    if (r.kind !== "schedule" && !r.path && !r.sourceUrl) add("The file never finished uploading: add it again.");
    if (r.path && missing.has(r.id)) add("The file is missing from Storage: add it again.");
    if (r.rating !== null && r.rating <= LOW_RATING && !r.neverThis?.trim()) add("Say what to avoid, so the engines learn the reason.");
  }
  return out;
}

/** The examples the checks read, newest first (at most HEALTH_ROWS); null on a database error (then nothing is said). */
export async function healthRows(): Promise<HealthRow[] | null> {
  try {
    return await prisma.trainingExample.findMany({
      orderBy: { createdAt: "desc" },
      take: HEALTH_ROWS,
      select: { id: true, kind: true, title: true, path: true, mime: true, sourceUrl: true, engines: true, consentGiven: true, transcript: true, rating: true, neverThis: true, notes: true },
    });
  } catch (error) {
    await logError(error, { source: "training-lab.health", level: "warn" });
    return null;
  }
}
