import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Shimmer placeholder. Size it with className (e.g. "h-4 w-40"). */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "h-3 animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--bp-line),var(--bp-soft),var(--bp-line))] bg-[length:200%_100%] motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
