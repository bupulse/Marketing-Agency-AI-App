import { useCallback, useReducer } from "react";
import { apply, createHistory, redo, undo, type History, type Op } from "@/lib/editor/ops";
import type { MotionSpec } from "@/lib/video-engine/spec";

// The editor's state is the spec: this is the hook over lib/editor/ops.ts' history (apply, undo, redo).

export type HistoryAction = { type: "apply"; op: Op } | { type: "undo" } | { type: "redo" } | { type: "reset"; spec: MotionSpec };

/** Pure, so it is tested without React. */
export function historyReducer(h: History, action: HistoryAction): History {
  switch (action.type) {
    case "apply":
      return apply(h, action.op);
    case "undo":
      return undo(h);
    case "redo":
      return redo(h);
    case "reset":
      return createHistory(action.spec);
  }
}

export function useSpecHistory(initial: MotionSpec) {
  const [history, dispatch] = useReducer(historyReducer, initial, createHistory);
  return {
    spec: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    run: useCallback((op: Op) => dispatch({ type: "apply", op }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    reset: useCallback((spec: MotionSpec) => dispatch({ type: "reset", spec }), []),
  };
}
