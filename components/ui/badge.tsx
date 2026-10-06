import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "blue" | "violet" | "success" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-soft text-muted",
  blue: "bg-ok-bg text-ok",
  violet: "bg-new-bg text-new",
  success: "bg-success-bg text-success",
  danger: "bg-danger-bg text-danger",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone };

/** Small status label (e.g. "Scheduled", "New"). */
export function Badge({ tone = "blue", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", tones[tone], className)}
      {...props}
    />
  );
}
