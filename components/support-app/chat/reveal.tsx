"use client";

import { useLayoutEffect, useRef, useState } from "react";

// A new AI answer fades in word by word, like Claude's chat. The answer arrives whole, so before the first paint each
// word of the rendered text is wrapped in a span with a growing delay; when the animation ends the original text nodes
// go back, so React's view of the DOM is exactly what it rendered. History (already there when the chat opened) and
// people who ask for less motion get the text at once.

const MAX_TOTAL_MS = 1600;
const MAX_STEP_MS = 32;
const WORD_MS = 500;

export function Reveal({ animate, className, children }: { animate: boolean; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Decided once, when the message first shows: a later re-render never plays it again.
  const [play] = useState(animate);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!play || !root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const texts: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (t.data.trim()) texts.push(t);
    }
    const words = texts.reduce((n, t) => n + t.data.split(/\s+/).filter(Boolean).length, 0);
    const step = Math.min(MAX_STEP_MS, MAX_TOTAL_MS / Math.max(1, words));
    const swaps: [HTMLSpanElement, Text][] = [];
    let i = 0;
    for (const t of texts) {
      const wrap = document.createElement("span");
      for (const part of t.data.split(/(\s+)/)) {
        if (!part) continue;
        if (!part.trim()) {
          wrap.appendChild(document.createTextNode(part));
          continue;
        }
        const w = document.createElement("span");
        w.className = "sc-word";
        w.style.animationDelay = `${Math.round(i++ * step)}ms`;
        w.textContent = part;
        wrap.appendChild(w);
      }
      t.parentNode?.replaceChild(wrap, t);
      swaps.push([wrap, t]);
    }
    const restore = () => {
      for (const [wrap, t] of swaps) wrap.parentNode?.replaceChild(t, wrap);
      swaps.length = 0;
    };
    const timer = setTimeout(restore, i * step + WORD_MS + 100);
    return () => {
      clearTimeout(timer);
      restore();
    };
  }, [play]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
