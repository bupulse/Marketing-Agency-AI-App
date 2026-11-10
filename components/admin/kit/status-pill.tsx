import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type PillTone = "good" | "warn" | "bad" | "info" | "new" | "muted";

const TONES: Record<PillTone, { pill: string; dot: string }> = {
  good: { pill: "bg-success-bg text-success", dot: "bg-[#0ca30c] dark:bg-[#5fd9a0]" },
  warn: { pill: "bg-[#fff4e0] text-[#b45309] dark:bg-[#3a2a0a] dark:text-[#ffc65c]", dot: "bg-[#f59e0b]" },
  bad: { pill: "bg-danger-bg text-danger", dot: "bg-[#c81e3a] dark:bg-[#ff7a8f]" },
  info: { pill: "bg-ok-bg text-ok", dot: "bg-pulse-blue" },
  new: { pill: "bg-new-bg text-new", dot: "bg-pulse-violet" },
  muted: { pill: "bg-soft text-muted", dot: "bg-[#9a9aa0]" },
};

/**
 * A small state label: Active, Overdue, Waiting. The words carry the meaning (never the colour alone); `dot` adds a
 * coloured dot, `icon` a small icon instead.
 */
export function StatusPill({ tone = "muted", icon: Icon, dot, children, className }: { tone?: PillTone; icon?: LucideIcon; dot?: boolean; children: ReactNode; className?: string }) {
  const t = TONES[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold", t.pill, className)}>
      {Icon ? <Icon aria-hidden className="size-3.5" /> : dot ? <span aria-hidden className={cn("size-1.5 rounded-full", t.dot)} /> : null}
      {children}
    </span>
  );
}

/** A count in a small bubble, for menus and cards (red for to-dos, calm otherwise). Nothing at zero. */
export function CountBubble({ count, tone = "danger", label, className }: { count: number; tone?: "danger" | "violet" | "neutral"; label?: string; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums",
        tone === "danger" ? "bg-[#c81e3a] text-white shadow-sm" : tone === "violet" ? "bg-new-bg text-new" : "bg-soft text-muted",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
