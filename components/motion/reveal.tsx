"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type RevealProps = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
};

/**
 * Scroll reveal. Where `animation-timeline: view()` is supported the CSS does everything
 * (no JS work). Otherwise an IntersectionObserver fades in elements that start below the fold.
 * Content is always visible without JS and under reduced motion; no layout shift (transform only).
 */
export function Reveal({ children, as, className }: RevealProps) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (CSS.supports("animation-timeline: view()")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already on screen

    el.dataset.state = "hidden";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.state = "shown";
        io.disconnect();
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={cn("bp-reveal", className)}>
      {children}
    </Tag>
  );
}
