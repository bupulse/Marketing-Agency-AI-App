"use client";

import { useEffect, useRef } from "react";
import "./motion.css";

/**
 * A soft colour wash behind the page that changes with the section in the middle of the screen (sections opt in with
 * data-tint="blue" or "violet"), so moving from one part of the story to the next feels like a change of light.
 * One fixed layer, one IntersectionObserver, and only its opacity and colour change (a CSS transition).
 */
export function SceneTint() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-tint]"));
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) layer.dataset.tint = (e.target as HTMLElement).dataset.tint;
          else if (layer.dataset.tint === (e.target as HTMLElement).dataset.tint) layer.dataset.tint = "none";
        }
      },
      { rootMargin: "-40% 0px -40% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  return <div ref={ref} aria-hidden className="tint" data-tint="none" />;
}
