// Which Lab examples an engine should read, and what to tell the AI about them (docs/research/ and the map in
// docs/handovers/training-lab.md). Ranking and formatting only, no database: reader.ts loads the rows. An example is
// used only when it is switched on for the engine; an actor needs the consent box ticked, always. Pure.
import { NEIGHBOURS } from "@/lib/video-engine/brain/viral";
import { SECTORS, type SectorId } from "@/lib/video-engine/brain/types";
import { KIND_LABELS, type TrainingEngine, type TrainingKind } from "./types";

/** The fields of a TrainingExample the matcher reads. */
export type ExampleRow = {
  id: string;
  kind: string;
  title: string;
  howMade: string;
  whatIsGood: string;
  neverThis: string | null;
  notes: unknown;
  tags: string[];
  sector: string | null;
  language: string | null;
  technique: string[];
  rating: number | null;
  consentGiven: boolean;
  engines: string[];
  transcript: string | null;
  createdAt: Date;
};

export type Want = { engine: TrainingEngine; kinds?: TrainingKind[]; sector?: string | null; language?: string | null; techniques?: string[]; limit?: number };
export type Scored = { example: ExampleRow; score: number };
/** `examples`: the best matches, best first. `avoid`: examples rated 1 or 2 stars (the engines must not copy them). */
export type Ranked = { examples: Scored[]; avoid: ExampleRow[] };

export const DEFAULT_LIMIT = 5;
export const LOW_RATING = 2;
const AVOID_LIMIT = 8;
const DAY = 86_400_000;
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** May this example be used by this engine at all? */
export function usable(e: ExampleRow, want: Pick<Want, "engine" | "kinds">): boolean {
  if (!e.engines.includes(want.engine)) return false;
  if (want.kinds?.length && !(want.kinds as string[]).includes(e.kind)) return false;
  if (e.kind === "actor" && !e.consentGiven) return false;
  if (want.engine === "presenter" && !(e.kind === "actor" && e.consentGiven)) return false;
  return true;
}

function sectorScore(example: string | null, wanted: string | null | undefined): number {
  const w = norm(wanted);
  const s = norm(example);
  if (!w) return 0;
  if (!s) return 5;
  if (s === w) return 40;
  const near = (NEIGHBOURS as Record<string, SectorId[]>)[w] ?? [];
  return (SECTORS as readonly string[]).includes(s) && near.includes(s as SectorId) ? 20 : 0;
}

export function scoreExample(e: ExampleRow, want: Want, now: Date): number {
  let score = sectorScore(e.sector, want.sector);
  const lang = norm(want.language);
  if (lang && norm(e.language)) score += norm(e.language) === lang ? 25 : -15;
  const wanted = (want.techniques ?? []).map(norm).filter(Boolean);
  const techniques = new Set(e.technique.map(norm));
  const tags = new Set(e.tags.map(norm));
  score += Math.min(30, 10 * wanted.filter((t) => techniques.has(t)).length);
  score += Math.min(12, 4 * wanted.filter((t) => tags.has(t)).length);
  if (e.rating === 5) score += 30;
  else if (e.rating === 4) score += 15;
  // A small tie-breaker: up to 3 points for an example added today, none after a year.
  score += 3 * Math.max(0, 1 - (now.getTime() - e.createdAt.getTime()) / (365 * DAY));
  return Math.round(score * 100) / 100;
}

/** The usable examples, best first (limit 5 by default); those rated 1 or 2 stars go to the avoid side. */
export function rankExamples(examples: readonly ExampleRow[], want: Want, now: Date = new Date()): Ranked {
  const ok = examples.filter((e) => usable(e, want));
  const low = (e: ExampleRow) => e.rating !== null && e.rating <= LOW_RATING;
  const scored = ok
    .filter((e) => !low(e))
    .map((example) => ({ example, score: scoreExample(example, want, now) }))
    .sort((a, b) => b.score - a.score || b.example.createdAt.getTime() - a.example.createdAt.getTime() || a.example.id.localeCompare(b.example.id));
  const avoid = ok
    .filter(low)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, AVOID_LIMIT);
  return { examples: scored.slice(0, Math.max(0, want.limit ?? DEFAULT_LIMIT)), avoid };
}

/** The ids of every example in the result, for AgentRun.exampleIds. */
export function exampleIdsOf(ranked: Ranked): string[] {
  return [...new Set([...ranked.examples.map((s) => s.example.id), ...ranked.avoid.map((e) => e.id)])];
}

// ---- The words for the prompt

export type LabLines = { examples: string[]; avoid: string[]; phrases: string[] };
const LINE_MAX = 420;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The key notes of an example (the AI-drafted analysis the owner corrected): short text, numbers and short lists. */
export function notesText(notes: unknown): string {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(notes as Record<string, unknown>)) {
    const v = Array.isArray(value) ? value.filter((x) => typeof x === "string" || typeof x === "number").join(", ") : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
    if (squash(v)) parts.push(`${key.replace(/[_-]+/g, " ")}: ${cut(squash(v), 90)}`);
    if (parts.length >= 6) break;
  }
  return parts.join("; ");
}

function exampleLine(e: ExampleRow): string {
  const kind = KIND_LABELS[e.kind as TrainingKind] ?? e.kind;
  const notes = notesText(e.notes);
  return cut(`${kind} "${squash(e.title)}": made like this: ${squash(e.howMade)} Good because: ${squash(e.whatIsGood)}${notes ? ` Notes: ${notes}.` : ""}`, LINE_MAX);
}

function avoidLines(ranked: Ranked): string[] {
  const lines: string[] = [];
  for (const { example: e } of ranked.examples) if (e.neverThis && squash(e.neverThis)) lines.push(cut(`Never (from "${squash(e.title)}"): ${squash(e.neverThis)}`, LINE_MAX));
  for (const e of ranked.avoid) {
    const wrong = e.neverThis && squash(e.neverThis) ? squash(e.neverThis) : `how it was made: ${squash(e.howMade)}`;
    lines.push(cut(`Rated ${e.rating} of 5 by the owner, do not copy "${squash(e.title)}": ${wrong}`, LINE_MAX));
  }
  return lines;
}

/** Short phrases from the Kinyarwanda recordings' transcripts, in their spelling. */
export function phrasesOf(ranked: Ranked): string[] {
  const out: string[] = [];
  for (const { example: e } of ranked.examples) {
    if (e.kind !== "voice" || !e.transcript) continue;
    for (const part of e.transcript.split(/[\n.!?;]+/)) {
      const p = squash(part);
      if (p.length >= 3 && p.length <= 90 && p.split(" ").length <= 12) out.push(p);
    }
  }
  return [...new Set(out)];
}

/** Lines that fit in `budget` characters, in order. */
function fit(lines: string[], budget: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of [...new Set(lines)]) {
    if (used + line.length > budget) break;
    out.push(line);
    used += line.length;
  }
  return out;
}

/** The prompt text for the examples, the "never this" notes and the phrases, all together at most `maxChars` (default 3000). */
export function labLines(ranked: Ranked, opts: { maxChars?: number } = {}): LabLines {
  const total = Math.max(0, opts.maxChars ?? 3000);
  return {
    examples: fit(ranked.examples.map((s) => exampleLine(s.example)), Math.floor(total * 0.55)),
    avoid: fit(avoidLines(ranked), Math.floor(total * 0.3)),
    phrases: fit(phrasesOf(ranked), Math.floor(total * 0.15)),
  };
}
