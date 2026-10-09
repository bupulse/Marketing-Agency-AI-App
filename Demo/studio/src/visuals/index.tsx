import { AbsoluteFill } from "remotion";
import * as custom from "./custom";
import * as intro from "./intro";
import * as payments from "./payments";

const REGISTRY: Record<string, React.FC> = { ...intro, ...payments, ...custom };

/** Draws the scene visual named in the script ("PayMethod:starter" → PayMethod). */
export const Visual: React.FC<{ name: string }> = ({ name }) => {
  const V = REGISTRY[name];
  if (!V) return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontSize: 60, color: "red" }}>Missing visual: {name}</AbsoluteFill>;
  return <V />;
};
