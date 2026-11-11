"use client";

import { useCallback, useRef } from "react";
import { useScrollProgress, writeProgressVar } from "./scroll-scene";
import "./motion.css";

/**
 * A big statement whose words light up one by one as you scroll past it. The whole sentence is ordinary text in the
 * HTML (readable, selectable, indexed); only each word's opacity follows the scroll, computed in CSS from --p and the
 * word's position. Under reduced motion every word is simply shown.
 */
export function ScrollWords({ text, id }: { text: string; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  const onProgress = useCallback((p: number) => writeProgressVar(ref.current, p), []);
  useScrollProgress(ref, onProgress);
  const words = text.split(" ");
  return (
    <section ref={ref} aria-label="What BuPulse means" data-scene="night" className="sw scene-dark" style={{ ["--n" as string]: words.length }} id={id}>
      <div className="sw-sticky">
        <p className="sw-text">
          {words.map((w, i) => (
            <span key={i} className="sw-word" style={{ ["--i" as string]: i }}>
              {w}{" "}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
