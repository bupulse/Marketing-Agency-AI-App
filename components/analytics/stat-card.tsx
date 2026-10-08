import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";

/** A number with its change versus the previous period. A missing comparison says so instead of showing 0%. */
export function StatCard({ label, value, change, hint }: { label: string; value: string; change: number | null; hint?: string }) {
  const rounded = change === null ? null : Math.round(change);
  const Icon = rounded === null || rounded === 0 ? Minus : rounded > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <GlassCard padding="sm" className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <span className="text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</span>
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[13px] font-medium",
          rounded === null || rounded === 0 ? "text-muted" : rounded > 0 ? "text-success" : "text-danger",
        )}
      >
        <Icon aria-hidden className="size-4" />
        {rounded === null ? "No earlier data" : rounded === 0 ? "No change" : `${rounded > 0 ? "+" : ""}${rounded}% vs previous`}
      </span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </GlassCard>
  );
}
