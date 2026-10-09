import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { CONTACT } from "../config";
import { C, fontFamily } from "../theme";

/** Logo, site, WhatsApp and the call to action. Used at the end of every video. */
export const EndCard: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const vertical = height > width;
  const pop = (delay: number) => spring({ frame: f - delay, fps, config: { damping: 14 } });
  const rise = (delay: number) => ({ opacity: pop(delay), transform: `translateY(${interpolate(pop(delay), [0, 1], [30, 0])}px)` });
  return (
    <AbsoluteFill style={{ fontFamily, color: C.text, alignItems: "center", justifyContent: "center" }}>
      <Backdrop />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: vertical ? 48 : 36, padding: 60, textAlign: "center" }}>
        <Img src={staticFile("brand/logo.png")} style={{ height: vertical ? 120 : 96, ...rise(0) }} />
        <div style={{ fontSize: vertical ? 64 : 56, fontWeight: 700, letterSpacing: -1.5, ...rise(8) }}>
          Your marketing, <span style={{ background: C.gradient, WebkitBackgroundClip: "text", color: "transparent" }}>on autopilot.</span>
        </div>
        <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: 20, ...rise(16) }}>
          <Pill>{CONTACT.site}</Pill>
          <Pill>WhatsApp {CONTACT.whatsapp}</Pill>
        </div>
        <div style={{ background: C.gradient, color: "white", fontSize: vertical ? 44 : 36, fontWeight: 600, padding: "22px 48px", borderRadius: 999, boxShadow: "0 20px 60px rgba(47,107,255,0.35)", ...rise(24) }}>
          {CONTACT.cta}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Pill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ background: C.glassStrong, border: `1px solid ${C.line}`, borderRadius: 999, padding: "16px 32px", fontSize: 32, fontWeight: 500, boxShadow: "0 10px 40px rgba(0,0,0,0.06)" }}>{children}</div>
);
