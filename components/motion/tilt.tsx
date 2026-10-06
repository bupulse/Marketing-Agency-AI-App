"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type TiltProps = {
  children: ReactNode;
  /** Max rotation in degrees. */
  max?: number;
  className?: string;
};

/** Pointer-driven 3D tilt. Mouse/pen only (skipped on touch); resets on leave. */
export function Tilt({ children, max = 8, className }: TiltProps) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--bp-rx", `${(px * max * 2).toFixed(2)}deg`);
    el.style.setProperty("--bp-ry", `${(-py * max * 2).toFixed(2)}deg`);
  }

  function reset() {
    ref.current?.style.removeProperty("--bp-rx");
    ref.current?.style.removeProperty("--bp-ry");
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={cn("bp-tilt", className)}
      style={{ willChange: "transform" } as CSSProperties}
    >
      {children}
    </div>
  );
}
