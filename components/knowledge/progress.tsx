import { cn } from "@/lib/cn";

/** How complete a section is: the brand gradient, green when done. (The usage Meter turns red near its limit, which is right for credits, not here.) */
export function Progress({ percent, label, className }: { percent: number; label: string; className?: string }) {
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={cn("h-2 w-full overflow-hidden rounded-full bg-line", className)}>
      <span className={cn("bp-meter-fill block h-full rounded-full", pct >= 100 ? "bg-success" : "bg-brand-gradient")} style={{ width: `${pct}%` }} />
    </div>
  );
}
