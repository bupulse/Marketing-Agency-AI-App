import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type GlassCardProps = HTMLAttributes<HTMLElement> & {
  /** Use the denser glass (for content-heavy surfaces, dialogs, sidebars). */
  strong?: boolean;
  /** Lift + tilt on hover (for clickable cards). */
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  as?: ElementType;
};

const pad = { none: "", sm: "p-4", md: "p-6", lg: "p-8" } as const;

export function GlassCard({
  strong = false,
  interactive = false,
  padding = "md",
  as,
  className,
  ...props
}: GlassCardProps) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      className={cn(
        strong ? "glass-strong" : "glass",
        "rounded-glass",
        pad[padding],
        interactive &&
          "transition-[transform,box-shadow] duration-300 ease-out-soft hover:-translate-y-1.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}
