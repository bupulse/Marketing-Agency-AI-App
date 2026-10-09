import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../theme";

/** The soft blue/violet blobs behind every BuPulse page, drifting slowly. */
export const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const a = Math.sin(f / 90) * 60;
  const b = Math.cos(f / 110) * 70;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 900, height: 900, left: -200 + a, top: -300 + b, borderRadius: "50%", background: "rgba(47,107,255,0.45)", filter: "blur(160px)" }} />
      <div style={{ position: "absolute", width: 800, height: 800, right: -250 - b, bottom: -300 + a, borderRadius: "50%", background: "rgba(123,92,255,0.42)", filter: "blur(160px)" }} />
    </AbsoluteFill>
  );
};
