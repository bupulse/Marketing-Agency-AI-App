import { cn } from "@/lib/cn";

type MeterProps = {
  value: number;
  max: number;
  /** Accessible name, e.g. "Posts this month". */
  label: string;
  /** Show "value / max" text above the bar. */
  showValue?: boolean;
  className?: string;
};

/** Usage bar with gradient fill and a grow-in animation. Turns red-ish at 90%+. */
export function Meter({ value, max, label, showValue = false, className }: MeterProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const near = pct >= 90;
  return (
    <div className={cn("w-full", className)}>
      {showValue && (
        <div className="mb-1.5 flex justify-between text-[13px] font-medium">
          <span className="text-muted">{label}</span>
          <span>
            {value} / {max}
          </span>
        </div>
      )}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        className="h-2 overflow-hidden rounded-full bg-line"
      >
        <span
          className={cn("bp-meter-fill block h-full rounded-full", near ? "bg-danger" : "bg-brand-gradient")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
