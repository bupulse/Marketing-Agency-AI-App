import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

type MarqueeProps = {
  children: ReactNode;
  /** Seconds for one full loop. */
  duration?: number;
  /** Gap between items in px. */
  gap?: number;
  reverse?: boolean;
  /** Pause while hovered or focused (default true). */
  pauseOnHover?: boolean;
  className?: string;
};

/** Infinite horizontal loop. Content is duplicated once (the copy is aria-hidden). */
export function Marquee({
  children,
  duration = 40,
  gap = 12,
  reverse = false,
  pauseOnHover = true,
  className,
}: MarqueeProps) {
  return (
    <div
      className={cn("bp-marquee", className)}
      data-reverse={reverse || undefined}
      data-pause={pauseOnHover || undefined}
      style={{ "--bp-marquee-duration": `${duration}s`, "--bp-marquee-gap": `${gap}px` } as CSSProperties}
    >
      <div className="bp-marquee-track">
        <div className="bp-marquee-group">{children}</div>
        <div className="bp-marquee-group" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
