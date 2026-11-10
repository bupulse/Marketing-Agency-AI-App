import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Nothing to show, said kindly: an icon, a short title, one line on why or what to do, and an optional button.
 * `tone="good"` for good news ("Nothing waiting").
 */
export function EmptyState({ icon: Icon = Inbox, title, hint, action, tone = "calm", className }: { icon?: LucideIcon; title: ReactNode; hint?: ReactNode; action?: ReactNode; tone?: "calm" | "good"; className?: string }) {
  return (
    <div role="status" className={cn("flex flex-col items-center gap-2 rounded-[20px] border border-dashed px-5 py-8 text-center", tone === "good" ? "border-success/30 bg-success-bg/60" : "border-line bg-soft/50", className)}>
      <span aria-hidden className={cn("inline-flex size-11 items-center justify-center rounded-2xl", tone === "good" ? "bg-success-bg text-success" : "bg-surface text-muted dark:bg-white/[0.06]")}>
        <Icon className="size-5" />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      {hint && <p className="max-w-md text-[13px] leading-snug text-muted">{hint}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
