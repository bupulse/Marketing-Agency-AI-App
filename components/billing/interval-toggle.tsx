"use client";

import { Badge } from "@/components/ui";
import { INTERVALS } from "@/lib/billing/catalog";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/cn";

/** Monthly/Yearly toggle (shared look with the marketing pricing page). */
export function IntervalToggle({ value, onChange, badge = "2 months free" }: { value: BillingInterval; onChange: (v: BillingInterval) => void; badge?: string | null }) {
  return (
    <div role="radiogroup" aria-label="Billing period" className="glass inline-flex items-center gap-1 self-start rounded-full p-1">
      {INTERVALS.map((interval) => {
        const on = value === interval;
        return (
          <button
            key={interval}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(interval)}
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors duration-300",
              on ? "border-line bg-glass-strong text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {interval === "MONTH" ? "Monthly" : "Yearly"}
            {interval === "YEAR" && badge && <Badge tone="success">{badge}</Badge>}
          </button>
        );
      })}
    </div>
  );
}
