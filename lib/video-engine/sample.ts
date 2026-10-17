// A hand-made motion spec (docs/VIDEO_ENGINE.md): what a Claude design looks like, used by the Video Lab's free
// "Sample design" button and by the tests to exercise every layer kind, animation and transition, and the 3D look
// (key light, fog, extruded text, a turntable, particles, glass and metal). No AI involved.
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
        // The hook in 3D: the product name extruded and spinning in, lit from the top left, with bokeh and sparkles.
        seconds: 2.4,
        transition: "cut",
        say: `${input.product}. New in Kigali.`,
        camera: { move: "orbitLeft", intensity: 0.8 },
        light: { x: 0.15, y: 0.05, intensity: 0.85, color: "#dfe8ff", fog: 0.35, fogColor: "#0b1640" },
        background: { kind: "gradient", colors: ["#050814", "#132a7a", "#2f6bff"], angle: 10 },
        layers: [
          { kind: "particles", particle: "bokeh", count: 16, colors: ["#2f6bff", "#7b5cff", "#9fc1ff"], x: 0.5, y: 0.5, w: 1, h: 1, depth: 0.15, seed: 3 },
          { kind: "shape", shape: "rect", material: "glass", color: "#ffffff", x: 0.5, y: 0.2, w: 0.56, h: 0.07, radius: 0.5, from: 0.05, keyframes: [{ at: 0, scale: 0.8, opacity: 0 }, { at: 0.2, scale: 1, opacity: 1, ease: "back" }] },
          { kind: "text", text: "New in Kigali", font: "poppins", weight: 800, size: 0.045, color: "#ffffff", x: 0.5, y: 0.2, w: 0.8, h: 0.06, animate: "drop", uppercase: true, from: 0.08 },
          { kind: "text", text: input.product, font: "anton", size: 0.16, color: "#ffffff", x: 0.5, y: 0.44, w: 0.86, h: 0.3, animate: "pop", animateFor: 1, uppercase: true, shadow: true, from: 0.05, depth: 0.9, text3d: { depth: 0.9, side: "#1d3fa8", bevel: true, spin: true } },
          { kind: "particles", particle: "sparkles", count: 22, colors: ["#ffffff", "#cfe0ff"], x: 0.5, y: 0.45, w: 0.95, h: 0.6, depth: 0.95, seed: 7 },
        ],
      },
      {
        // The product on a turntable: a reflective floor, a contact shadow and a shine gliding across as it turns.
        seconds: 3.4,
        transition: "whip",
        say: "Made for everyday life.",
        camera: { move: "dollyIn", intensity: 0.35 },
        light: { x: 0.85, y: 0.05, intensity: 0.9, color: "#e8f0ff" },
        background: { kind: "gradient", colors: ["#2a3142", "#11141c", "#06070a"], angle: 0 },
        layers: [
          { kind: "shape", shape: "circle", color: "rgba(120,150,255,0.18)", x: 0.5, y: 0.66, w: 1.1, h: 0.14, depth: 0.3 },
          hasPhoto
            ? { kind: "photo", photo: 1, x: 0.5, y: 0.47, w: 0.62, h: 0.52, fit: "contain", turntable: { spin: 1, angle: 38, reflection: 0.45 }, depth: 0.6, keyframes: [{ at: 0, dy: 0.06, opacity: 0 }, { at: 0.2, dy: 0, opacity: 1, ease: "out" }] }
            : { kind: "shape", shape: "ring", color: "#2f6bff", x: 0.5, y: 0.45, w: 0.6, h: 0.34, stroke: 0.02, draw: true },
          { kind: "particles", particle: "dust", count: 40, colors: ["#ffffff"], x: 0.5, y: 0.45, w: 1, h: 0.8, seed: 11, depth: 0.7 },
          { kind: "text", text: "Made for everyday life", font: "poppins", weight: 800, size: 0.062, color: "#ffffff", x: 0.5, y: 0.86, w: 0.84, h: 0.1, animate: "words", from: 0.25, highlight: { words: ["everyday"], color: "#7fb0ff" }, box: { color: "#9fb8ff", padding: 0.03, radius: 0.4, material: "glass" } },
        ],
      },
      {
        seconds: 2.8,
        transition: "blurZoom",
        say: "Fast, reliable, and yours.",
        camera: { move: "dollyIn", intensity: 0.6, focusFrom: 0, focusTo: 0.5 },
        light: { x: 0.2, y: 0.1, intensity: 0.7, fog: 0.3, fogColor: "#0b0b0f" },
        background: hasPhoto ? { kind: "photo", colors: ["#000000"], photo: second, blur: 24, dim: 0.45 } : { kind: "solid", colors: ["#2f6bff"] },
        layers: [
          ...(hasPhoto ? [{ kind: "photo" as const, photo: second, x: 0.5, y: 0.4, w: 0.7, h: 0.42, radius: 0.08, shadow: true, zoomTo: 1.15, border: "#ffffff" }] : []),
          { kind: "shape", shape: "line", color: "#7b5cff", x: 0.5, y: 0.68, w: 0.5, h: 0.006, draw: true, from: 0.15 },
          { kind: "text", text: "Fast. Reliable. Yours.", font: "inter", weight: 800, size: 0.065, color: "#ffffff", x: 0.5, y: 0.75, w: 0.86, h: 0.1, animate: "typewriter", animateFor: 1.2, from: 0.2 },
        ],
      },
      {
        // The call to action: the price in 3D gold metal on a metal burst, confetti falling through the scene.
        seconds: 3.4,
        transition: "spin",
        say: `Order on WhatsApp from ${input.business}.`,
        camera: { move: "orbitRight", intensity: 0.6 },
        light: { x: 0.3, y: 0.02, intensity: 0.9, color: "#fff4dc" },
        background: { kind: "gradient", colors: ["#2a1260", "#7b5cff"], angle: 0, texture: "lines" },
        layers: [
          { kind: "shape", shape: "burst", material: "metal", color: "#6c4be0", x: 0.5, y: 0.38, w: 0.78, h: 0.44, keyframes: [{ at: 0, scale: 0, rotate: -90 }, { at: 0.3, scale: 1, rotate: 0, ease: "back" }] },
          { kind: "text", text: input.price || "Ask us today", font: "anton", size: 0.11, color: "#f5b700", x: 0.5, y: 0.38, w: 0.7, h: 0.2, animate: "pop", from: 0.2, shadow: true, text3d: { depth: 0.7, material: "metal", bevel: true, side: "#7a4a00" } },
          { kind: "text", text: input.business, font: "poppins", weight: 800, size: 0.06, color: "#ffffff", x: 0.5, y: 0.64, w: 0.86, h: 0.08, animate: "rise", from: 0.35 },
          { kind: "text", text: "Order on WhatsApp", font: "inter", weight: 600, size: 0.045, color: "#ffffff", x: 0.42, y: 0.74, w: 0.7, h: 0.06, animate: "fade", from: 0.5, box: { color: "#ffffff", padding: 0.03, radius: 0.5, material: "glass" } },
          { kind: "shape", shape: "arrow", color: "#ffffff", x: 0.42, y: 0.81, w: 0.2, h: 0.03, draw: true, from: 0.6 },
          { kind: "character", x: 0.82, y: 0.8, w: 0.3, h: 0.36, skin: "#8d5524", hair: "braids", hairColor: "#1b1b1b", outfit: "#f5b700", accent: "#2f6bff", pose: "thumbsUp", side: "left", talk: [[0.1, 0.7]], from: 0.1 },
          { kind: "particles", particle: "confetti", count: 46, x: 0.5, y: 0.5, w: 1, h: 1, seed: 5, depth: 0.85, from: 0.25 },
        ],
      },
    ],
    music: "upbeat",
    caption: `${input.product} is here at ${input.business}. Come and see it today.`,
    hashtags: ["Kigali", "Rwanda", "NewArrival"],
    look: { grade: "vivid", glow: 0.3, vignette: 0.35, grain: 0.15, lightLeak: 0.2 },
  };
}
