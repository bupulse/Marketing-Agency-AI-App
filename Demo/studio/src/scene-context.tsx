import { createContext, useContext } from "react";

/** Timing of the scene being drawn, in frames from the scene's start. */
export type SceneInfo = {
  /** The visual's argument: "Persona:inzu" gives "inzu". */
  arg: string;
  durationInFrames: number;
  /** When the voice ends. */
  voiceEnd: number;
  /** Start and end of each spoken line. */
  lines: { start: number; end: number }[];
  variant: "social" | "demo";
};

export const SceneContext = createContext<SceneInfo | null>(null);

export function useScene(): SceneInfo {
  const s = useContext(SceneContext);
  if (!s) throw new Error("useScene outside a scene");
  return s;
}

/** Frame at which line `i` starts (falls back to a fraction of the voice). */
export function lineStart(s: SceneInfo, i: number): number {
  return s.lines[i]?.start ?? Math.round((s.voiceEnd * i) / Math.max(1, s.lines.length));
}

/** A frame at fraction `p` (0..1) of the spoken part of the scene. */
export function at(s: SceneInfo, p: number): number {
  return Math.round(s.voiceEnd * p);
}
