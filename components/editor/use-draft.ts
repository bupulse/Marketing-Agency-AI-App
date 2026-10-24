import { useEffect, useRef } from "react";
import { DRAFT_DELAY_MS, browserStorage, sameSpec, writeDraft } from "./draft";
import type { MotionSpec } from "@/lib/video-engine/spec";

/**
 * Keeps the edit in this browser about a second after each change, and once more when the tab is hidden or closed.
 * Nothing is saved while the spec is still the one the reel was opened with (`baseline`), so opening a reel never
 * overwrites an older draft that is waiting to be chosen.
 */
export function useDraftSaver(key: string, spec: MotionSpec, baseline: MotionSpec, active = true) {
  const latest = useRef({ key, spec, baseline, active });
  useEffect(() => {
    latest.current = { key, spec, baseline, active };
  });

  useEffect(() => {
    if (!active || sameSpec(spec, baseline)) return;
    const timer = setTimeout(() => writeDraft(browserStorage(), key, spec), DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, spec, baseline, active]);

  useEffect(() => {
    const flush = () => {
      const { key: k, spec: s, baseline: b, active: on } = latest.current;
      if (on && !sameSpec(s, b)) writeDraft(browserStorage(), k, s);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
}
