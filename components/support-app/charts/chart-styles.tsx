// The charts' colours and animations, scoped to `.bp-viz` (never app/globals.css). The categorical palette is the
// dataviz reference palette, checked with its validator against the app's own surfaces (#ffffff light, #0b0b0f dark):
// every adjacent pair clears the colour-blind and normal-vision floors in both modes. Three light slots are under 3:1
// on white, so every chart that uses them also prints its numbers as text (legend rows or a table).
//
// Animations only run once a chart scrolls into view (use-reveal.ts sets data-reveal="on"); before that, and without
// scripts, every mark is drawn in its final place. Nothing moves for people who ask for less motion.

const CSS = `
.bp-viz {
  --viz-1: #2a78d6; --viz-2: #eb6834; --viz-3: #1baf7a; --viz-4: #eda100;
  --viz-5: #e87ba4; --viz-6: #008300; --viz-7: #6250d6; --viz-8: #e34948;
  --viz-other: #a3a3ab;
  --viz-grid: #ececf0; --viz-axis: #d4d4da; --viz-surface: #ffffff;
  --viz-up: #0f7a4a; --viz-down: #c81e3a;
  --viz-ramp-1: #184f95; --viz-ramp-2: #1c5cab; --viz-ramp-3: #2a78d6; --viz-ramp-4: #5598e7; --viz-ramp-5: #86b6ef;
}
.dark .bp-viz {
  --viz-1: #3987e5; --viz-2: #d95926; --viz-3: #199e70; --viz-4: #c98500;
  --viz-5: #d55181; --viz-6: #008300; --viz-7: #9085e9; --viz-8: #e66767;
  --viz-other: #6b6b73;
  --viz-grid: #1f1f26; --viz-axis: #33333b; --viz-surface: #0b0b0f;
  --viz-up: #5fd9a0; --viz-down: #ff7a8f;
  --viz-ramp-1: #9ec5f4; --viz-ramp-2: #6da7ec; --viz-ramp-3: #3987e5; --viz-ramp-4: #256abf; --viz-ramp-5: #184f95;
}
@keyframes bp-viz-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes bp-viz-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes bp-viz-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes bp-viz-grow-x { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes bp-viz-grow-y { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes bp-viz-sweep { from { stroke-dasharray: 0 var(--c) } to { stroke-dasharray: var(--len) var(--c) } }
@keyframes bp-viz-pop { 0% { opacity: 0; transform: scale(.6) } 70% { opacity: 1; transform: scale(1.08) } 100% { opacity: 1; transform: none } }
@keyframes bp-viz-pulse { 0% { box-shadow: 0 0 0 0 rgba(15,159,110,.45) } 70% { box-shadow: 0 0 0 8px rgba(15,159,110,0) } 100% { box-shadow: 0 0 0 0 rgba(15,159,110,0) } }

.bp-viz .bp-grow-x { transform-origin: left center }
.bp-viz .bp-grow-y { transform-origin: center bottom; transform-box: fill-box }
.bp-viz .bp-center-x { transform-origin: center center }
[data-reveal="wait"] .bp-line, [data-reveal="wait"] .bp-fade, [data-reveal="wait"] .bp-rise, [data-reveal="wait"] .bp-pop { opacity: 0 }
[data-reveal="wait"] .bp-grow-x, [data-reveal="wait"] .bp-center-x { transform: scaleX(0) }
[data-reveal="wait"] .bp-grow-y { transform: scaleY(0) }
[data-reveal="wait"] .bp-sweep { stroke-dasharray: 0 var(--c) }
[data-reveal="on"] .bp-line { stroke-dasharray: 1; animation: bp-viz-draw 1.1s cubic-bezier(.45,.05,.25,1) both }
[data-reveal="on"] .bp-fade { animation: bp-viz-fade .8s ease-out .35s both }
[data-reveal="on"] .bp-rise { animation: bp-viz-rise .5s cubic-bezier(.2,.8,.2,1) calc(var(--i, 0) * 60ms) both }
[data-reveal="on"] .bp-pop { animation: bp-viz-pop .45s cubic-bezier(.2,.8,.2,1) calc(.9s + var(--i, 0) * 60ms) both }
[data-reveal="on"] .bp-grow-x, [data-reveal="on"] .bp-center-x { animation: bp-viz-grow-x .8s cubic-bezier(.2,.8,.2,1) calc(var(--i, 0) * 70ms) both }
[data-reveal="on"] .bp-grow-y { animation: bp-viz-grow-y .7s cubic-bezier(.2,.8,.2,1) calc(var(--i, 0) * 25ms) both }
[data-reveal="on"] .bp-sweep { animation: bp-viz-sweep .7s cubic-bezier(.45,.05,.25,1) calc(var(--i, 0) * 120ms) both }
.bp-viz .bp-live-dot { animation: bp-viz-pulse 2s ease-out infinite }
@media (prefers-reduced-motion: reduce) {
  .bp-viz *, .bp-viz *::before, .bp-viz *::after, [data-reveal] * { animation: none !important; transition: none !important }
  [data-reveal="wait"] * { opacity: 1 !important; transform: none !important }
  [data-reveal] .bp-sweep { stroke-dasharray: var(--len) var(--c) !important }
}
`;

/** Put once on a page that has charts (React keeps one copy however many charts render it). */
export function ChartStyles() {
  return (
    <style href="bp-viz-styles" precedence="medium">
      {CSS}
    </style>
  );
}

/** The categorical slots in their validated order. */
export const SLOTS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)", "var(--viz-7)", "var(--viz-8)"] as const;
export const OTHER = "var(--viz-other)";
/** An ordinal blue ramp for ordered steps like a funnel: strongest first; the faintest step still clears 2:1 on the surface. */
export const RAMP = ["var(--viz-ramp-1)", "var(--viz-ramp-2)", "var(--viz-ramp-3)", "var(--viz-ramp-4)", "var(--viz-ramp-5)"] as const;
