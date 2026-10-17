// The lab's store of BuPulse's own results (outcomes.ts): one JSON row per line in video-lab/data/outcomes.jsonl,
// appended as the publisher reads a post's numbers (after 24 hours, again after 7 days). The latest row of a video
// wins. Server only (node:fs); the app will use a database table instead (docs/research/BRAIN.md).
import fs from "node:fs";
import path from "node:path";
import { checkOutcome } from "./outcomes";
import type { Outcome } from "./types";

export const OUTCOMES_FILE = path.resolve("video-lab/data/outcomes.jsonl");

/** Adds (or updates) a video's outcome. Throws with the problems when the row is not valid. */
export function recordOutcome(row: Outcome, file = OUTCOMES_FILE): void {
  const problems = checkOutcome(row);
  if (problems.length) throw new Error(`This outcome cannot be stored: ${problems.join("; ")}.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

/** Every video's latest outcome; rows that no longer pass the checks are skipped. */
export function loadOutcomes(file = OUTCOMES_FILE): Outcome[] {
  if (!fs.existsSync(file)) return [];
  const latest = new Map<string, Outcome>();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Outcome;
      if (!checkOutcome(row).length) latest.set(row.videoId, row);
    } catch {
      // A half-written last line (the lab was stopped mid-write) is skipped.
    }
  }
  return [...latest.values()];
}
