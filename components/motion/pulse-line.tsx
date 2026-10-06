import { useId } from "react";
import { cn } from "@/lib/cn";

type PulseLineProps = {
  /** Animate the heartbeat drawing (default true). Static line under reduced motion. */
  animated?: boolean;
  className?: string;
  strokeWidth?: number;
};

/** The BuPulse heartbeat line, from the approved mockup. Decorative. */
export function PulseLine({ animated = true, className, strokeWidth = 5 }: PulseLineProps) {
  const id = useId();
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 200"
      fill="none"
      className={cn("h-auto w-full", className)}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="600" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2F6BFF" />
          <stop offset="1" stopColor="#7B5CFF" />
        </linearGradient>
      </defs>
      <path
        className={animated ? "bp-pulse-path" : undefined}
        d="M0 120 H170 L215 30 L260 175 L295 95 L330 120 H600"
        stroke={`url(#${id})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
