import type { BillingInterval } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/cn";
import { formatPlanPrice, formatPrice, intervalWord, yearlyDiscountPercent, type PlanPrices } from "./helpers";

/**
 * A plan's price. Yearly shows what 12 monthly payments would cost crossed out, the yearly
 * price, and the discount (e.g. "17% off"). Used on the pricing page and the billing page.
 */
export function PriceTag({ plan, interval, size = "lg" }: { plan: PlanPrices; interval: BillingInterval; size?: "lg" | "md" | "sm" }) {
  const yearly = interval === "YEAR";
  const fullYear = plan.monthlyPriceCents * 12;
  return (
    <div className="flex flex-col gap-1">
      {/* The same height monthly and yearly, so the cards don't jump when switching. Monthly leaves the line empty: the
          yearly comparison used to stay in the page (only faded out), so copied text and text-only readers saw
          "Was 180,000 RWF, 17% off" next to a monthly price. */}
      <p className="flex min-h-6 items-center gap-2 text-sm">
        {yearly && (
          <>
            <del className="text-base text-muted decoration-danger/70 decoration-2">
              <span className="sr-only">Was </span>
              {formatPrice(fullYear, plan.currency)}
            </del>
            {yearlyDiscountPercent(plan) > 0 && <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success">{yearlyDiscountPercent(plan)}% off</span>}
          </>
        )}
      </p>
      <p className={cn("flex items-baseline gap-1.5", size === "sm" && "flex-wrap whitespace-nowrap")}>
        <span className={cn("font-bold tracking-[-0.04em]", size === "lg" ? "text-5xl" : size === "md" ? "text-4xl font-semibold tracking-[-0.03em]" : "text-[2rem] leading-tight tracking-[-0.03em]")}>
          {formatPlanPrice(plan, interval)}
        </span>
        <span className={cn("text-muted", size === "sm" && "text-sm")}>/ {intervalWord(interval)}</span>
      </p>
    </div>
  );
}
