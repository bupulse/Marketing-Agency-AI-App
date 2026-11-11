"use client";

import { useEffect, type RefObject } from "react";

/*
 * One small scroll engine for the home page's pinned scenes (docs/design/front-page-motion.md).
 *
 * The way big product pages stay smooth, done in a few lines:
 * - one passive scroll listener and ONE requestAnimationFrame per frame for every scene on the page;
 * - each scene's position is measured once (and again on resize), never inside the scroll handler, so scrolling
 *   never forces a layout;
 * - an IntersectionObserver switches a scene off while it is far from the screen;
 * - a scene only receives a number from 0 to 1 (how far the visitor has scrolled through it) and turns it into
 *   `transform` / `opacity` work, usually by writing the CSS variable --p.
 *
 * Under prefers-reduced-motion nothing subscribes, and the CSS shows the calm, static version.
 */

type Scene = {
  el: HTMLElement;
  onProgress: (p: number) => void;
  top: number;
  range: number;
  active: boolean;
  last: number;
};

const scenes = new Set<Scene>();
let frame = 0;
let listening = false;
let resizeObserver: ResizeObserver | null = null;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function measure(s: Scene) {
  const rect = s.el.getBoundingClientRect();
  s.top = rect.top + window.scrollY;
  // Progress runs from the moment the scene's top reaches the top of the screen until its bottom reaches the bottom:
  // exactly the time a sticky child stays pinned inside it.
  s.range = Math.max(1, s.el.offsetHeight - window.innerHeight);
}

function tick() {
  frame = 0;
  const y = window.scrollY;
  for (const s of scenes) {
    if (!s.active) continue;
    const p = clamp01((y - s.top) / s.range);
    if (Math.abs(p - s.last) < 0.0002) continue;
    s.last = p;
    s.onProgress(p);
  }
}

function request() {
  if (!frame) frame = requestAnimationFrame(tick);
}

function remeasure() {
  for (const s of scenes) measure(s);
  for (const s of scenes) s.last = -1;
  request();
}

function start() {
  if (listening) return;
  listening = true;
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", remeasure, { passive: true });
  window.addEventListener("load", remeasure, { once: true });
  // Anything that changes the page's height (fonts, images, the FAQ opening) moves the scenes below it.
  resizeObserver = new ResizeObserver(remeasure);
  resizeObserver.observe(document.body);
}

function stop() {
  if (!listening || scenes.size > 0) return;
  listening = false;
  window.removeEventListener("scroll", request);
  window.removeEventListener("resize", remeasure);
  resizeObserver?.disconnect();
  resizeObserver = null;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Calls `onProgress(p)` (0 to 1) as the visitor scrolls through `ref`'s element. `onProgress` should only write
 * styles (CSS variables, transforms, opacity, a data attribute); keep it stable or the scene re-subscribes.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, onProgress: (p: number) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const scene: Scene = { el, onProgress, top: 0, range: 1, active: false, last: -1 };
    const io = new IntersectionObserver(
      ([entry]) => {
        scene.active = entry.isIntersecting;
        if (scene.active) {
          measure(scene);
          scene.last = -1;
          request();
        }
      },
      // Wake a little before the scene arrives so its first frame is already right.
      { rootMargin: "25% 0px 25% 0px" },
    );
    io.observe(el);
    scenes.add(scene);
    start();
    measure(scene);
    return () => {
      io.disconnect();
      scenes.delete(scene);
      stop();
    };
  }, [ref, onProgress]);
}

/** Writes the progress to `--p` on the element (the CSS turns it into motion). */
export function writeProgressVar(el: HTMLElement | null, p: number) {
  el?.style.setProperty("--p", p.toFixed(4));
}
