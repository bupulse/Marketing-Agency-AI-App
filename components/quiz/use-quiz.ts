"use client";

import { useCallback, useState } from "react";
import { advance, anchored, back as stepBack, jumpToRound, points, position, START, type QuizProgress, type QuizStep } from "@/lib/quiz/flow";

/**
 * The quiz's place and score (lib/quiz/flow.ts). `next()` after an answer, `skip()` to leave a question for later;
 * when a round ends `roundDone` names it until `continueRound()` (the "round done" screen sits in between).
 *
 * The place is kept by the question's id, not only its number: a quiz may add or drop questions as the owner answers
 * (a product picked adds its question, a saved one may drop out), and the owner must stay on the same question.
 */
export function useQuiz(steps: readonly QuizStep[], initial: Partial<QuizProgress> = {}) {
  const [state, setState] = useState(() => {
    const progress = { ...START, ...initial };
    return { progress, at: steps[progress.index]?.id ?? null, roundDone: null as string | null };
  });
  const progress = anchored(steps, state.progress, state.at);
  const roundDone = state.roundDone;

  const place = useCallback((p: QuizProgress, done: string | null = null) => setState({ progress: p, at: steps[p.index]?.id ?? null, roundDone: done }), [steps]);

  const move = useCallback(
    (how: "answer" | "skip") => {
      const r = advance(steps, progress, how);
      place(r.progress, r.roundDone);
    },
    [steps, progress, place],
  );

  const finished = progress.index >= steps.length;
  const here = position(steps, progress.index);
  return {
    progress,
    index: progress.index,
    step: finished ? null : here.step,
    round: here.round,
    stepInRound: here.stepInRound,
    stepsInRound: here.stepsInRound,
    total: steps.length,
    finished: finished && !roundDone,
    points: points(progress),
    roundDone,
    next: () => move("answer"),
    skip: () => move("skip"),
    back: () => place(stepBack(progress)),
    continueRound: () => place(progress),
    goToRound: (round: string) => place(jumpToRound(steps, progress, round)),
    goTo: (id: string) => {
      const i = steps.findIndex((s) => s.id === id);
      if (i >= 0) place({ ...progress, index: i });
    },
  };
}

export type QuizApi = ReturnType<typeof useQuiz>;
