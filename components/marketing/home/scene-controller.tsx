"use client";

import { useEffect, useRef } from "react";
import "./motion.css";

/**
 * The home page's light and colour (docs/design/front-page-motion.md, "Scenes").
 *
 * Sections say which scene they belong to with data-scene: "light" (the normal page), "night" (near black), "deep"
 * (deep BuPulse blue) or "violet" (deep BuPulse violet). One fixed layer behind the page takes the colour of the
 * section crossing the middle of the screen and eases to it (a CSS transition of background and glow colours), so
 * the page moves from dark hero to deep blue to violet to light without hard edges. Dark scenes also tell the header
 * (html[data-home-scene="dark"]) so its glass and logo turn light-on-dark while it sits over them.
 *
 * One IntersectionObserver, nothing on scroll. Under reduced motion the colours still change, without easing.
 */
export function SceneController() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    const root = document.documentElement;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]"));
    if (sections.length === 0) return;
    const set = (scene: string) => {
      if (layer.dataset.scene === scene) return;
      layer.dataset.scene = scene;
      root.dataset.homeScene = scene === "light" ? "light" : "dark";
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) set((e.target as HTMLElement).dataset.scene ?? "light");
      },
      // A line across the middle of the screen: the section on it sets the scene.
      { rootMargin: "-50% 0px -50% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => {
      io.disconnect();
      delete root.dataset.homeScene;
    };
  }, []);
  return (
    <div ref={ref} aria-hidden className="scene-layer" data-scene="light">
      <i />
      <i />
    </div>
  );
}
