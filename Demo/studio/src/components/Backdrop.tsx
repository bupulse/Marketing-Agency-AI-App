import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../theme";

/**
 * The soft blue/violet blobs behind every BuPulse page, drifting slowly.
 * Radial gradients instead of blur filters: same look, far cheaper to render.
 */
export const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const a = Math.sin(f / 90) * 60;
  const b = Math.cos(f / 110) * 70;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 1400, height: 1400, left: -450 + a, top: -550 + b, borderRadius: "50%", background: "radial-gradient(circle, rgba(47,107,255,0.42) 0%, rgba(47,107,255,0.22) 35%, rgba(47,107,255,0) 70%)" }} />
      <div style={{ position: "absolute", width: 1300, height: 1300, right: -500 - b, bottom: -550 + a, borderRadius: "50%", background: "radial-gradient(circle, rgba(123,92,255,0.40) 0%, rgba(123,92,255,0.2) 35%, rgba(123,92,255,0) 70%)" }} />
    </AbsoluteFill>
  );
};
