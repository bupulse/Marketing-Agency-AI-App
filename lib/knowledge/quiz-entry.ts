// Where the Business info quiz starts for one person (docs/QUIZ_MODE.md): how complete Business info is, the rounds
// their role and plan let them play, and the round "Continue" opens. Business info and the dashboard home share it.
import "server-only";
import { cache } from "react";
import { localParts, safeZone } from "@/lib/autopilot/timezone";
import type { FeatureKey } from "@/lib/features";
import { can, type Role } from "@/lib/team/roles";
import { knowledgeProgress } from "./overview";
import { QUIZ_ROUNDS, roundForSection } from "./quiz-map";
import { overallPercent, sectionByKey, type SectionKey, type SectionProgress } from "./sections";

export type QuizEntry = {
  progress: Partial<Record<SectionKey, SectionProgress>>;
  /** 0 to 100: the Business info score. */
  overall: number;
  /** False when the person can play no round (their role or plan). */
  playable: boolean;
  href: string;
  label: "Start the quiz" | "Continue" | "Play again";
  /** The round Start or Continue opens (the first round the person can play when nothing is filled in yet). */
  nextRound: { emoji: string; title: string } | null;
};

/**
 * Cached for the request (React cache, by argument identity): the dashboard layout's banner and the home page's card
 * pass the same getAppContext objects, so the score is worked out once per page.
 */
export const quizEntry = cache(async function quizEntry(business: Parameters<typeof knowledgeProgress>[0] & { timezone: string | null }, role: Role, usable: ReadonlySet<FeatureKey>): Promise<QuizEntry> {
  const p = localParts(new Date(), safeZone(business.timezone));
  const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const progress = await knowledgeProgress(business, today);
  const overall = overallPercent(progress);
  const rounds = QUIZ_ROUNDS.filter((r) => {
    const s = sectionByKey(r.section);
    return (!s.permission || can(role, s.permission)) && (!s.feature || usable.has(s.feature));
  });
  // "Continue" opens the round that fixes the first incomplete section, in the quiz's order (for Products: Photos once
  // there are products; a profile that lacks only its service area: Find us).
  const ids = rounds.map((r) => r.id);
  const first = overall > 0 && overall < 100 ? rounds.find((r) => (progress[r.section]?.percent ?? 0) < 100) : undefined;
  const nextId = first ? roundForSection(first.section, progress[first.section], ids) : null;
  const next = nextId ? { id: nextId } : undefined;
  const opens = next ? rounds.find((r) => r.id === next.id) : overall < 100 ? rounds[0] : undefined;
  return {
    progress,
    overall,
    playable: rounds.length > 0,
    href: `/dashboard/knowledge/quiz${next ? `?round=${next.id}` : ""}`,
    label: overall === 0 ? "Start the quiz" : overall >= 100 ? "Play again" : "Continue",
    nextRound: opens ? { emoji: opens.emoji, title: opens.title } : null,
  };
});
