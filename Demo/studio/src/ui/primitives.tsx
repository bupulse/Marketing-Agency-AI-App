import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, fontFamily } from "../theme";
import { pop, prog } from "./motion";

export const isVertical = () => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { width, height } = useVideoConfig();
  return height > width;
};

/** A glass panel like BuPulse's GlassCard. */
export const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; strong?: boolean; radius?: number; pad?: number }> = ({ children, style, strong = true, radius = 28, pad = 28 }) => (
  <div style={{ background: strong ? C.glassStrong : C.glass, border: `1px solid ${C.line}`, borderRadius: radius, padding: pad, boxShadow: "0 24px 70px rgba(29,29,31,0.10), 0 2px 6px rgba(29,29,31,0.04)", ...style }}>
    {children}
  </div>
);

export const Button: React.FC<{ children: React.ReactNode; variant?: "primary" | "ghost" | "outline"; style?: React.CSSProperties; pressed?: boolean }> = ({ children, variant = "primary", style, pressed }) => (
  <div
    style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, height: 52, padding: "0 26px", borderRadius: 999, fontSize: 20, fontWeight: 600,
      ...(variant === "primary" ? { background: C.gradient, color: "white", boxShadow: "0 12px 30px rgba(47,107,255,0.30)" } : variant === "outline" ? { border: `1.5px solid ${C.line}`, color: C.text, background: "white" } : { color: C.text, background: "rgba(47,107,255,0.08)" }),
      transform: pressed ? "scale(0.96)" : undefined,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode; tone?: "blue" | "violet" | "success" | "neutral" | "warn"; style?: React.CSSProperties }> = ({ children, tone = "blue", style }) => {
  const t = { blue: ["#1F55D6", "rgba(47,107,255,0.12)"], violet: ["#5B3FD9", "rgba(123,92,255,0.14)"], success: [C.success, C.successBg], neutral: [C.muted, "rgba(0,0,0,0.05)"], warn: ["#9A5B00", "rgba(255,170,0,0.16)"] }[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 600, color: t[0], background: t[1], padding: "6px 12px", borderRadius: 999, ...style }}>{children}</span>;
};

/** Browser window around app content. */
export const BrowserFrame: React.FC<{ url?: string; width: number; height: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ url = "bupulse.com", width, height, children, style }) => (
  <div style={{ width, height, borderRadius: 22, overflow: "hidden", background: "white", border: `1px solid ${C.line}`, boxShadow: "0 40px 120px rgba(29,29,31,0.18), 0 4px 12px rgba(29,29,31,0.06)", display: "flex", flexDirection: "column", ...style }}>
    <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", background: "#F2F2F5", borderBottom: `1px solid ${C.line}` }}>
      {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
      <div style={{ marginLeft: 18, flex: 1, height: 32, borderRadius: 10, background: "white", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 16, color: C.muted, fontFamily }}>🔒 {url}</div>
    </div>
    <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>{children}</div>
  </div>
);

/** A modern phone around content. Content area is width-36 x height-36. */
export const PhoneFrame: React.FC<{ width?: number; children: React.ReactNode; style?: React.CSSProperties; dark?: boolean }> = ({ width = 420, children, style, dark }) => {
  const height = Math.round(width * 2.05);
  return (
    <div style={{ width, height, borderRadius: width * 0.14, background: "#111", padding: 14, boxShadow: "0 50px 120px rgba(29,29,31,0.30)", ...style }}>
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: width * 0.115, overflow: "hidden", background: dark ? "#0B0B0F" : "white" }}>
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", width: width * 0.28, height: 30, borderRadius: 20, background: "#000", zIndex: 10 }} />
        {children}
      </div>
    </div>
  );
};

/** Animated mouse pointer. Keyframes are [frame, x, y, click?] in the parent's coordinates. */
export const Cursor: React.FC<{ path: [number, number, number, boolean?][]; scale?: number }> = ({ path, scale = 1 }) => {
  const f = useCurrentFrame();
  if (path.length === 0) return null;
  let x = path[0][1], y = path[0][2];
  for (let i = 0; i < path.length - 1; i++) {
    const [f0, x0, y0] = path[i];
    const [f1, x1, y1] = path[i + 1];
    if (f >= f0 && f <= f1) {
      const p = prog(f, f0, Math.max(1, f1 - f0));
      x = x0 + (x1 - x0) * p;
      y = y0 + (y1 - y0) * p;
    } else if (f > f1) {
      x = x1; y = y1;
    }
  }
  const click = path.find(([cf, , , c]) => c && f >= cf && f < cf + 14);
  const ring = click ? prog(f, click[0], 14) : 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, pointerEvents: "none", zIndex: 50, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
      {click && <div style={{ position: "absolute", left: -28, top: -28, width: 56, height: 56, borderRadius: 28, border: "3px solid rgba(47,107,255,0.7)", opacity: 1 - ring, transform: `scale(${0.4 + ring})` }} />}
      <svg width="34" height="34" viewBox="0 0 24 24" style={{ transform: click ? "scale(0.9)" : undefined, filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.3))" }}>
        <path d="M4 2l16 9.5-7 1.6-3.6 6.9L4 2z" fill="#1D1D1F" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/** Pop-in explanation label. */
export const Callout: React.FC<{ at: number; until?: number; x: number; y: number; children: React.ReactNode; tone?: "gradient" | "dark" }> = ({ at, until, x, y, children, tone = "gradient" }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(f, fps, at);
  if (f < at || (until !== undefined && f > until)) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 40, transform: `scale(${0.6 + 0.4 * p})`, opacity: Math.min(1, p * 1.5), transformOrigin: "left center", background: tone === "gradient" ? C.gradient : "#1D1D1F", color: "white", fontSize: 22, fontWeight: 600, padding: "12px 20px", borderRadius: 16, boxShadow: "0 16px 40px rgba(47,107,255,0.35)", whiteSpace: "nowrap", fontFamily }}>
      {children}
    </div>
  );
};

export const Logo: React.FC<{ height?: number; white?: boolean }> = ({ height = 40, white }) => <Img src={staticFile(white ? "brand/logo-white.png" : "brand/logo.png")} style={{ height }} />;
export const Mark: React.FC<{ size?: number }> = ({ size = 40 }) => <Img src={staticFile("brand/mark.png")} style={{ height: size, width: size, objectFit: "contain" }} />;

/** Simple circle avatar with initials. */
export const Avatar: React.FC<{ name: string; size?: number; color?: string }> = ({ name, size = 48, color = C.blue }) => (
  <div style={{ width: size, height: size, borderRadius: size / 2, background: color, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.4, flexShrink: 0 }}>
    {name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
  </div>
);
