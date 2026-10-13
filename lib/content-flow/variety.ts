// Day-to-day variety on top of the content packs' angles (docs/CONTENT.md, content flow v3). The angles rotate per
// subject through the packs' history (lib/studio/angles.ts chooseAngles); the opening hook and the structure rotate by
// day here, so two consecutive days never open or flow alike even when an angle comes back. Pure.
import { parseDayKey } from "@/lib/publishing/time";

export const HOOKS = [
  "Open with a question the customer would ask themselves.",
  "Open with a short, bold statement.",
  "Open with a one-line everyday scene the customer recognises.",
  "Open by speaking straight to the customer (you...).",
  "Open with one concrete fact from the details given (never an invented number).",
  "Open with a before / after or problem / solution contrast.",
] as const;

export const STRUCTURES = [
  "Short punchy lines, one idea per line.",
  "A mini story: situation, what changed, invitation.",
  "A short list of 2 or 3 points, then the call to action.",
  "A question, then the answer in two or three sentences.",
  "One strong sentence and a call to action; nothing more.",
] as const;

/** Days since 1970-01-01 for a "YYYY-MM-DD" key. */
export function dayNumber(day: string): number {
  const { year, month, day: d } = parseDayKey(day);
  return Math.floor(Date.UTC(year, month - 1, d) / 86_400_000);
}

/** A small stable hash, so subjects start at different places in the rotation. */
export function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The day's hook and structure for a subject: consecutive days always differ (each list moves one step a day), and
 * the posts of one day differ from each other too (post `index` moves along the lists).
 */
export function dayVariety(subjectKey: string, day: string, index = 0): { hook: string; structure: string } {
  const n = dayNumber(day) + (seed(subjectKey) % 30) + index;
  return { hook: HOOKS[n % HOOKS.length], structure: STRUCTURES[n % STRUCTURES.length] };
}

/** "product:<id>", "campaign:<id>" or "general". */
export function subjectKeyOf(scope: { kind: "product" | "campaign"; id: string } | { kind: "general" }): string {
  return scope.kind === "general" ? "general" : `${scope.kind}:${scope.id}`;
}
