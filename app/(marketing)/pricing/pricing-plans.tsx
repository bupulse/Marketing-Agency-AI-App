"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { IntervalToggle } from "@/components/billing/interval-toggle";
import { formatPrice, yearlyBadge, yearlySavingsLabel, yearlySavingsMinor } from "@/components/billing/helpers";
import { PriceTag } from "@/components/billing/price-tag";
import { Badge, Button, GlassCard } from "@/components/ui";
import { paymentMethodLabel } from "@/lib/region-format";
import type { RegionalPlan } from "@/lib/region-prices";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/cn";
import { ComingSoonFeatures } from "@/components/billing/coming-soon-features";

/** Plan cards with a Monthly/Yearly switch. The plans and their prices are the visitor's region's (lib/region-prices.ts), via the page. */
export function PricingPlans({ plans }: { plans: RegionalPlan[] }) {
  const [interval, setInterval] = useState<BillingInterval>("MONTH");

  if (plans.length === 0) {
    return <p className="mx-auto max-w-xl rounded-2xl bg-soft px-4 py-8 text-center text-[15px] text-muted">No plans are on sale in this region yet. Get in touch and we will tell you what is coming.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-8">
      {/* Wrapped so the toggle centres here (it aligns to the start on the billing page). */}
      <div>
        <IntervalToggle value={interval} onChange={setInterval} badge={yearlyBadge(plans)} />
      </div>
      <div className={cn("mx-auto grid w-full gap-6", plans.length >= 3 ? "max-w-6xl md:grid-cols-2 lg:grid-cols-3" : "max-w-4xl md:grid-cols-2")}>
        {plans.map((plan) => (
          <GlassCard
            key={plan.key}
            strong={plan.highlight}
            padding="lg"
            className={cn("relative flex flex-col gap-6", plan.highlight && "shadow-glow ring-2 ring-pulse-violet/60")}
          >
            {plan.highlight && (
              <Badge tone="violet" className="absolute top-6 right-6">
                Most popular
              </Badge>
            )}
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-bold tracking-tight">{plan.name}</h2>
              <p className="text-muted">{plan.description}</p>
            </div>
            <div>
              <PriceTag plan={plan} interval={interval} />
              <p className="mt-1 min-h-5 text-sm text-muted">
                {interval === "YEAR"
                  ? yearlySavingsLabel(plan)
                    ? `Billed yearly. You save ${formatPrice(yearlySavingsMinor(plan), plan.currency)}, that's ${yearlySavingsLabel(plan)}.`
                    : "Billed yearly"
                  : "Billed every month"}
              </p>
              {plan.card && (
                <p className="mt-1 text-sm text-muted">
                  or {formatPrice(interval === "YEAR" ? plan.card.yearlyUsdCents : plan.card.monthlyUsdCents, "USD")} / {interval === "YEAR" ? "year" : "month"} by card
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.paymentMethods.map((m) => (
                <Badge key={m} tone={m === "momo" ? "success" : "blue"}>
                  {paymentMethodLabel(m)}
                </Badge>
              ))}
            </div>
            <ul className="flex flex-1 flex-col gap-3">
              {plan.highlights.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                  <span>{feature}</span>
                </li>
              ))}
              <ComingSoonFeatures features={plan.features} className="gap-3" />
            </ul>
            <Button href="/signup" size="lg" variant={plan.highlight ? "primary" : "ghost"}>
              Start your free trial
            </Button>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
