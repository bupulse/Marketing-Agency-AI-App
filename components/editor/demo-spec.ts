// The editor's built-in example: four shots with words, a shape sticker and different transitions, no clips needed.
import type { Layer, MotionSpec, Scene, TextLayer } from "@/lib/video-engine/spec";

const words = (text: string, over: Partial<TextLayer> = {}): TextLayer => ({ kind: "text", text, font: "inter", weight: 800, size: 0.08, color: "#FFFFFF", align: "center", shadow: true, x: 0.5, y: 0.5, w: 0.84, h: 0.2, animate: "pop", animateFor: 0.5, ...over });
const scene = (seconds: number, colors: string[], layers: Layer[], transition?: Scene["transition"]): Scene => ({ seconds, background: { kind: "gradient", colors, angle: 160 }, layers, ...(transition ? { transition } : {}) });

export const DEMO_SPEC: MotionSpec = {
  version: 1,
  title: "Editor demo",
  ratio: "9:16",
  fps: 30,
  palette: { background: "#0B1020", primary: "#6D4AFF", accent: "#FFD23F", text: "#FFFFFF" },
  scenes: [
    scene(3, ["#6D4AFF", "#1E1B4B"], [words("Fresh vegetables, all year", { y: 0.45 }), words("Grown in Kigali", { y: 0.62, size: 0.05, weight: 600, animate: "rise" })]),
    scene(3, ["#0EA5E9", "#0B1020"], [words("No soil. Less water.", { y: 0.4 }), { kind: "shape", shape: "arrow", color: "#FFD23F", x: 0.5, y: 0.65, w: 0.22, h: 0.12 }], "slideLeft"),
    scene(3.5, ["#16A34A", "#052E16"], [words("Harvest every week", { y: 0.45 }), words("45,000 RWF", { y: 0.62, size: 0.07, color: "#FFD23F", box: { color: "rgba(0,0,0,0.35)", padding: 0.02, radius: 0.03 } })], "zoom"),
    scene(3, ["#E11D48", "#4C0519"], [words("Message us on WhatsApp", { y: 0.5 })], "flash"),
  ],
  music: null,
  caption: "Fresh vegetables, all year.",
  hashtags: [],
};
