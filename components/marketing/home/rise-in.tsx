"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Content that rises into place as it enters the screen.
 *
 * Where the browser has CSS scroll-driven animations (`animation-timeline: view()`), the motion is tied to the scroll
 * itself and runs off the main thread (motion.css, `.ri`). Elsewhere an IntersectionObserver plays the same rise once.
 * The element is never hidden without JavaScript, under reduced motion, or when it is already on screen at load,
 * and only `transform` and `opacity` change, so nothing shifts the layout.
 */
export function RiseIn({ children, as, className }: { children: ReactNode; as?: ElementType; className?: string }) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()")) return; // the CSS does it
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.dataset.ri = "wait";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.ri = "go";
        io.disconnect();
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={cn("ri", className)}>
      {children}
    </Tag>
  );
}
