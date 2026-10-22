import { describe, expect, it } from "vitest";
import { advance, back, jumpToRound, percentDone, points, position, POINTS, START, type QuizStep } from "@/lib/quiz/flow";

const steps: QuizStep[] = [
  { id: "a1", round: "a" },
  { id: "a2", round: "a" },
  { id: "b1", round: "b" },
];

describe("quiz flow", () => {
  it("finds the round and the place in it", () => {
    expect(position(steps, 1)).toMatchObject({ round: "a", stepInRound: 2, stepsInRound: 2 });
    expect(position(steps, 2)).toMatchObject({ round: "b", stepInRound: 1, stepsInRound: 1 });
  });

  it("says when a round ends, once", () => {
    let r = advance(steps, START, "answer");
    expect(r.roundDone).toBeNull();
    r = advance(steps, r.progress, "skip");
    expect(r.roundDone).toBe("a");
    expect(r.progress).toMatchObject({ index: 2, answered: ["a1"], skipped: ["a2"], doneRounds: ["a"] });
    const again = advance(steps, { ...r.progress, index: 1 }, "answer");
    expect(again.roundDone).toBeNull();
    expect(again.progress.answered).toEqual(["a1", "a2"]);
    expect(again.progress.skipped).toEqual([]);
  });

  it("finishes past the last question and scores answers and rounds", () => {
    let p = START;
    for (let i = 0; i < steps.length; i++) p = advance(steps, p, "answer").progress;
    expect(p.index).toBe(3);
    expect(percentDone(steps, p.index)).toBe(100);
    expect(points(p)).toBe(3 * POINTS.answer + 2 * POINTS.round);
    expect(advance(steps, p, "answer").progress).toBe(p);
  });

  it("goes back and jumps to a round", () => {
    expect(back(START).index).toBe(0);
    expect(jumpToRound(steps, START, "b").index).toBe(2);
    expect(jumpToRound(steps, START, "nope")).toBe(START);
  });
});
