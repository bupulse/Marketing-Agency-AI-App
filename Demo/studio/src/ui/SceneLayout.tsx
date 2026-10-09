import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { C, fontFamily } from "../theme";
import { rise } from "./motion";

/** Design canvas every visual draws on; scaled to fit landscape and vertical. */
export const CANVAS = { w: 1100, h: 760 };

/**
 * Places a headline and the visual's canvas. Landscape: headline left, canvas right. Vertical: headline on top.
 * `full` gives the canvas the whole frame (hook, end card).
 */
export const SceneLayout: React.FC<{ eyebrow?: string; title: React.ReactNode; text?: string; children: React.ReactNode }> = ({ eyebrow, title, text, children }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const box = vertical ? { x: 30, y: 430, w: 1020, h: 1000 } : { x: 690, y: 70, w: 1170, h: 850 };
  const scale = Math.min(box.w / CANVAS.w, box.h / CANVAS.h);
  const cw = CANVAS.w * scale, ch = CANVAS.h * scale;
  const head = vertical ? { left: 70, top: 200, width: 940 } : { left: 110, top: 0, width: 540, bottom: 140 };
  return (
    <AbsoluteFill style={{ fontFamily, color: C.text }}>
      <div style={{ position: "absolute", ...head, display: "flex", flexDirection: "column", justifyContent: vertical ? "flex-start" : "center", gap: 18 }}>
        {eyebrow && <div style={{ ...rise(f, 2), fontSize: vertical ? 30 : 24, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: C.blue }}>{eyebrow}</div>}
        <div style={{ ...rise(f, 6), fontSize: vertical ? 68 : 58, lineHeight: 1.08, fontWeight: 700, letterSpacing: -1.5 }}>{title}</div>
        {text && <div style={{ ...rise(f, 12), fontSize: vertical ? 34 : 26, lineHeight: 1.4, color: C.muted }}>{text}</div>}
      </div>
      <div style={{ position: "absolute", left: box.x + (box.w - cw) / 2, top: box.y + (box.h - ch) / 2, width: CANVAS.w, height: CANVAS.h, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Gradient text for the key words in a title. */
export const Grad: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ background: C.gradient, WebkitBackgroundClip: "text", color: "transparent" }}>{children}</span>
);
