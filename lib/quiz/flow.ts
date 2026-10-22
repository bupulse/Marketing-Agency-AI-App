// Quiz mode (docs/QUIZ_MODE.md): the plain rules every quiz shares, the order of its questions, where a round ends,
// and the points. Pure, so the quiz screens and the tests read the same rules.

export type QuizRound = {
  id: string;
  title: string;
  /** One emoji, shown on the round's pill and its "round done" screen. */
  emoji: string;
  /** What the round is about, one short line ("Who buys from you"). */
  blurb?: string;
};

export type QuizStep = { id: string; round: string };

/** Points: every answer counts, keeping BuPulse's guess counts too (it is still an answer), a finished round adds a bonus. */
export const POINTS = { answer: 10, round: 25 } as const;

export type QuizProgress = {
  index: number;
  /** Ids of the questions answered (not skipped). */
  answered: string[];
  skipped: string[];
  /** Rounds whose last question was passed. */
  doneRounds: string[];
};

export const START: QuizProgress = { index: 0, answered: [], skipped: [], doneRounds: [] };

export function points(p: Pick<QuizProgress, "answered" | "doneRounds">): number {
  return p.answered.length * POINTS.answer + p.doneRounds.length * POINTS.round;
}

/** The round of the question at `index`, its place in the round (1-based) and how many questions the round has. */
export function position(steps: readonly QuizStep[], index: number) {
  const step = steps[Math.min(Math.max(index, 0), steps.length - 1)];
  const inRound = steps.filter((s) => s.round === step?.round);
  return { step, round: step?.round ?? "", stepInRound: inRound.findIndex((s) => s.id === step?.id) + 1, stepsInRound: inRound.length };
}

/**
 * Moves past the question on screen. Returns the new progress and the round that just ended (the screen celebrates it),
 * or null. Past the last question `index` equals `steps.length`: the quiz is finished.
 */
export function advance(steps: readonly QuizStep[], p: QuizProgress, how: "answer" | "skip"): { progress: QuizProgress; roundDone: string | null } {
  const step = steps[p.index];
  if (!step) return { progress: p, roundDone: null };
  const without = (list: string[]) => list.filter((id) => id !== step.id);
  const answered = how === "answer" ? [...without(p.answered), step.id] : without(p.answered);
  const skipped = how === "skip" ? [...without(p.skipped), step.id] : without(p.skipped);
  const next = steps[p.index + 1];
  const ends = !next || next.round !== step.round;
  const roundDone = ends && !p.doneRounds.includes(step.round) ? step.round : null;
  return { progress: { index: p.index + 1, answered, skipped, doneRounds: roundDone ? [...p.doneRounds, roundDone] : p.doneRounds }, roundDone };
}

/**
 * The progress with its place found again by the question's id (`at`): questions may be added or dropped while the
 * owner answers, and the owner stays on the same question. A question that is gone leaves the number as it was.
 */
export function anchored(steps: readonly QuizStep[], p: QuizProgress, at: string | null): QuizProgress {
  const i = at ? steps.findIndex((s) => s.id === at) : -1;
  return i >= 0 && i !== p.index ? { ...p, index: i } : p;
}

export function back(p: QuizProgress): QuizProgress {
  return { ...p, index: Math.max(0, p.index - 1) };
}

/** Opens the first question of a round (the round pills); unknown rounds leave the quiz where it is. */
export function jumpToRound(steps: readonly QuizStep[], p: QuizProgress, round: string): QuizProgress {
  const i = steps.findIndex((s) => s.round === round);
  return i < 0 ? p : { ...p, index: i };
}

/** 0 to 100: how far through the quiz the owner is. */
export function percentDone(steps: readonly QuizStep[], index: number): number {
  return steps.length ? Math.round((Math.min(index, steps.length) / steps.length) * 100) : 0;
}
