"use client";

import { useCallback, useState } from "react";
import { advance, back as stepBack, jumpToRound, points, position, START, type QuizProgress, type QuizStep } from "@/lib/quiz/flow";

/**
 * The quiz's place and score (lib/quiz/flow.ts). `next()` after an answer, `skip()` to leave a question for later;
 * when a round ends `roundDone` names it until `continueRound()` (the "round done" screen sits in between).
 */
export function useQuiz(steps: readonly QuizStep[], initial: Partial<QuizProgress> = {}) {
  const [progress, setProgress] = useState<QuizProgress>({ ...START, ...initial });
  const [roundDone, setRoundDone] = useState<string | null>(null);

  const move = useCallback(
    (how: "answer" | "skip") => {
      const r = advance(steps, progress, how);
      setProgress(r.progress);
      setRoundDone(r.roundDone);
    },
    [steps, progress],
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
    back: () => {
      setRoundDone(null);
      setProgress(stepBack);
    },
    continueRound: () => setRoundDone(null),
    goToRound: (round: string) => {
      setRoundDone(null);
      setProgress((p) => jumpToRound(steps, p, round));
    },
    goTo: (id: string) => {
      const i = steps.findIndex((s) => s.id === id);
      if (i >= 0) {
        setRoundDone(null);
        setProgress((p) => ({ ...p, index: i }));
      }
    },
  };
}

export type QuizApi = ReturnType<typeof useQuiz>;
