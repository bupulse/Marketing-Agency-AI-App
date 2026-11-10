"use client";

import { useEffect, useRef, type RefObject } from "react";

// Entrance animations that wait until a chart is on screen. The chart is first drawn finished (server render, no
// scripts, reduced motion). After hydration, a chart still below the fold is hidden (data-reveal="wait") and animates
// in (data-reveal="on") when a quarter of it scrolls into view; one already on screen animates straight away. The
// attribute is set on the DOM node directly, not through React state, so nothing re-renders.

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Attach to a chart's root element. `onReveal` runs once, when the animation starts (count-ups use it). */
export function useReveal<T extends HTMLElement = HTMLDivElement>(onReveal?: () => void, replayKey?: string): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const cb = useRef(onReveal);
  useEffect(() => {
    cb.current = onReveal;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || typeof IntersectionObserver === "undefined") return;
    el.dataset.reveal = "wait";
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        el.dataset.reveal = "on";
        cb.current?.();
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      delete el.dataset.reveal;
    };
  }, [replayKey]);
  return ref;
}
