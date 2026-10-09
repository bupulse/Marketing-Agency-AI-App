import { useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily } from "../theme";

export type Cue = { start: number; end: number; text: string };

/** Splits a subtitle line into chunks that fit two rows, timed by length within [start, end]. */
export function cuesFor(text: string, start: number, end: number, maxChars: number): Cue[] {
  const words = text.split(" ");
  const chunks: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) { chunks.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) chunks.push(cur);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let t = start;
  return chunks.map((c) => {
    const d = ((end - start) * c.length) / total;
    const cue = { start: Math.round(t), end: Math.round(t + d), text: c };
    t += d;
    return cue;
  });
}

/** Kinyarwanda subtitles burned in at the bottom. */
export const Subtitles: React.FC<{ cues: Cue[] }> = ({ cues }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const cue = cues.find((c) => f >= c.start && f < c.end + 6);
  if (!cue) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 230 : 46, display: "flex", justifyContent: "center", zIndex: 100, pointerEvents: "none" }}>
      <div style={{ maxWidth: vertical ? 960 : 1500, textAlign: "center", fontFamily, fontSize: vertical ? 42 : 38, lineHeight: 1.3, fontWeight: 600, color: "white", background: "rgba(17,17,22,0.78)", padding: vertical ? "14px 26px" : "10px 24px", borderRadius: 16 }}>
        {cue.text}
      </div>
    </div>
  );
};
