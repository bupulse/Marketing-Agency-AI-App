// A hand-made motion spec (docs/VIDEO_ENGINE.md): what a Claude design looks like, used by the Video Lab's free
// "Sample design" button and by the tests to exercise every layer kind, animation and transition. No AI involved.
import type { MotionSpec } from "./spec";

export function sampleSpec(input: { business: string; product: string; price?: string | null; photoCount: number }): MotionSpec {
  const hasPhoto = input.photoCount > 0;
  const second = input.photoCount > 1 ? 2 : 1;
  return {
    version: 1,
    title: `${input.product} sample`,
    ratio: "9:16",
    fps: 30,
    palette: { background: "#0b0b0f", primary: "#2f6bff", accent: "#7b5cff", text: "#ffffff" },
    scenes: [
      {
        seconds: 2.4,
        transition: "cut",
        camera: { move: "crashZoom", intensity: 0.5 },
        background: { kind: "gradient", colors: ["#0b0b0f", "#2f6bff"], angle: 20, texture: "dots" },
        layers: [
          { kind: "shape", shape: "blob", color: "#2f6bff", x: 0.5, y: 0.42, w: 0.95, h: 0.55, keyframes: [{ at: 0, scale: 0.6, opacity: 0 }, { at: 0.3, scale: 1, opacity: 0.9, ease: "back" }] },
          { kind: "text", text: "New in Kigali", font: "poppins", weight: 800, size: 0.05, color: "#ffffff", x: 0.5, y: 0.2, w: 0.8, h: 0.06, animate: "drop", uppercase: true },
          { kind: "text", text: input.product, font: "anton", size: 0.15, color: "#ffffff", x: 0.5, y: 0.42, w: 0.86, h: 0.3, animate: "wordsPop", animateFor: 0.9, uppercase: true, shadow: true, from: 0.1 },
        ],
      },
      {
        seconds: 3.2,
        transition: "whip",
        camera: { move: "orbitLeft", intensity: 0.7 },
        background: { kind: "solid", colors: ["#f5f5f7"], texture: "grain" },
        layers: [
          { kind: "shape", shape: "circle", color: "#7b5cff", x: 0.5, y: 0.45, w: 0.8, h: 0.45, keyframes: [{ at: 0, scale: 0.2 }, { at: 0.25, scale: 1, ease: "elastic" }] },
          hasPhoto
            ? { kind: "photo", photo: 1, x: 0.5, y: 0.45, w: 0.78, h: 0.5, fit: "contain", keyframes: [{ at: 0, dy: 0.3, rotate: -8, opacity: 0 }, { at: 0.3, dy: 0, rotate: 3, opacity: 1, ease: "back" }, { at: 1, rotate: -2, scale: 1.05 }] }
            : { kind: "shape", shape: "ring", color: "#2f6bff", x: 0.5, y: 0.45, w: 0.6, h: 0.34, stroke: 0.02, draw: true },
          { kind: "text", text: "Made for everyday life", font: "poppins", weight: 800, size: 0.07, color: "#0b0b0f", x: 0.5, y: 0.78, w: 0.84, h: 0.12, animate: "words", from: 0.25, highlight: { words: ["everyday"], color: "#2f6bff" } },
        ],
      },
      {
        seconds: 3,
        transition: "blurZoom",
        camera: { move: "dollyIn", intensity: 0.6, focusFrom: 0, focusTo: 0.5 },
        background: hasPhoto ? { kind: "photo", colors: ["#000000"], photo: second, blur: 24, dim: 0.45 } : { kind: "solid", colors: ["#2f6bff"] },
        layers: [
          ...(hasPhoto ? [{ kind: "photo" as const, photo: second, x: 0.5, y: 0.4, w: 0.7, h: 0.42, radius: 0.08, shadow: true, zoomTo: 1.15, border: "#ffffff" }] : []),
          { kind: "shape", shape: "line", color: "#7b5cff", x: 0.5, y: 0.68, w: 0.5, h: 0.006, draw: true, from: 0.15 },
          { kind: "text", text: "Fast. Reliable. Yours.", font: "inter", weight: 800, size: 0.065, color: "#ffffff", x: 0.5, y: 0.75, w: 0.86, h: 0.1, animate: "typewriter", animateFor: 1.2, from: 0.2 },
        ],
      },
      {
        seconds: 3.4,
        transition: "spin",
        camera: { move: "handheld", intensity: 0.4 },
        background: { kind: "solid", colors: ["#7b5cff"], texture: "lines" },
        layers: [
          { kind: "shape", shape: "burst", color: "#0b0b0f", x: 0.5, y: 0.4, w: 0.72, h: 0.4, keyframes: [{ at: 0, scale: 0, rotate: -90 }, { at: 0.3, scale: 1, rotate: 0, ease: "back" }] },
          { kind: "text", text: input.price || "Ask us today", font: "anton", size: 0.1, color: "#7b5cff", x: 0.5, y: 0.4, w: 0.6, h: 0.2, animate: "pop", from: 0.2 },
          { kind: "text", text: input.business, font: "poppins", weight: 800, size: 0.06, color: "#0b0b0f", x: 0.5, y: 0.7, w: 0.86, h: 0.08, animate: "rise", from: 0.35 },
          { kind: "text", text: "Order on WhatsApp", font: "inter", weight: 600, size: 0.045, color: "#ffffff", x: 0.5, y: 0.8, w: 0.7, h: 0.06, animate: "fade", from: 0.5, box: { color: "#0b0b0f", padding: 0.03, radius: 0.5 } },
          { kind: "shape", shape: "arrow", color: "#0b0b0f", x: 0.5, y: 0.88, w: 0.2, h: 0.03, draw: true, from: 0.6 },
          { kind: "character", x: 0.82, y: 0.8, w: 0.3, h: 0.36, skin: "#8d5524", hair: "braids", hairColor: "#1b1b1b", outfit: "#f5b700", accent: "#2f6bff", pose: "thumbsUp", side: "left", talk: [[0.1, 0.7]], from: 0.1 },
        ],
      },
    ],
    music: "upbeat",
    caption: `${input.product} is here at ${input.business}. Come and see it today.`,
    hashtags: ["Kigali", "Rwanda", "NewArrival"],
    look: { grade: "vivid", glow: 0.3, vignette: 0.35, grain: 0.15, lightLeak: 0.2 },
  };
}
