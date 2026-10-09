import type { BillingInterval } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/cn";
import { formatUsd, intervalWord, priceFor, yearlyDiscountPercent, type PlanPrices } from "./helpers";

/**
 * A plan's price. Yearly shows what 12 monthly payments would cost crossed out, the yearly
 * price, and the discount (e.g. "17% off"). Used on the pricing page and the billing page.
 */
export function PriceTag({ plan, interval, size = "lg" }: { plan: PlanPrices; interval: BillingInterval; size?: "lg" | "md" }) {
  const yearly = interval === "YEAR";
  const fullYear = priceFor(plan, "MONTH") * 12;
  return (
    <div className="flex flex-col gap-1">
      {/* Keeps the same height monthly and yearly, so the cards don't jump when switching. */}
      <p className={cn("flex min-h-6 items-center gap-2 text-sm transition-opacity duration-300", yearly ? "opacity-100" : "opacity-0")} aria-hidden={!yearly}>
        <del className="text-base text-muted decoration-danger/70 decoration-2">
          <span className="sr-only">Was </span>
          {formatUsd(fullYear)}
        </del>
        {yearlyDiscountPercent(plan) > 0 && <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success">{yearlyDiscountPercent(plan)}% off</span>}
      </p>
      <p className="flex items-baseline gap-1.5">
        <span className={cn("font-bold tracking-[-0.04em]", size === "lg" ? "text-5xl" : "text-4xl font-semibold tracking-[-0.03em]")}>
          {formatUsd(priceFor(plan, interval))}
        </span>
        <span className="text-muted">/ {intervalWord(interval)}</span>
      </p>
    </div>
  );
}
