import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

type FloatProps = {
  children: ReactNode;
  /** Negative-offset delay in seconds so siblings drift out of sync. */
  delay?: number;
  duration?: number;
  className?: string;
};

/** Gentle vertical bob. Pure CSS; disabled under reduced motion. */
export function Float({ children, delay = 0, duration = 6, className }: FloatProps) {
  const style: CSSProperties = {
    animationDuration: `${duration}s`,
    animationDelay: `${-delay}s`,
  };
  return (
    <div className={cn("animate-float motion-reduce:animate-none", className)} style={style}>
      {children}
    </div>
  );
}
