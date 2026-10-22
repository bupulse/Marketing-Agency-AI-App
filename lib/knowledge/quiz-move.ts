// Moving on in the Business info quiz, made safe (docs/QUIZ_MODE.md). A move is made for one question: a tap's delayed
// move, Next, Enter and Skip each name the question they were started on. A move does nothing when that question is no
// longer on screen, while another move is still saving, or when the same question was already moved past and the
// screen has not caught up yet (Enter and the button's own click in one tick). So a late timer or a second click can
// never answer, or save, a question the owner has not seen. Pure, so the quiz and the tests share it.

export type MoveGuard = {
  /** Starts a move made for `stepId` while `onScreen` shows; false (do nothing) when it is stale or one is running. */
  begin(stepId: string, onScreen: string | null): boolean;
  /** After an await: is the quiz still on the question the move was made for? */
  stillOn(stepId: string, onScreen: string | null): boolean;
  /** The move is over; `moved` when the quiz went past its question. */
  end(moved: boolean): void;
  /** The question now on screen (after each render). */
  seen(onScreen: string | null): void;
  readonly moving: boolean;
};

export function moveGuard(): MoveGuard {
  let running: string | null = null;
  let movedFrom: string | null = null;
  return {
    begin(stepId, onScreen) {
      if (running !== null || stepId !== onScreen || stepId === movedFrom) return false;
      running = stepId;
      return true;
    },
    stillOn: (stepId, onScreen) => stepId === onScreen,
    end(moved) {
      movedFrom = moved ? running : null;
      running = null;
    },
    seen(onScreen) {
      if (onScreen !== movedFrom) movedFrom = null;
    },
    get moving() {
      return running !== null;
    },
  };
}
