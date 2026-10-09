"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { IntervalToggle } from "@/components/billing/interval-toggle";
import { formatUsd, yearlyBadge, yearlySavings, yearlySavingsLabel } from "@/components/billing/helpers";
import { PriceTag } from "@/components/billing/price-tag";
import { Badge, Button, GlassCard } from "@/components/ui";
import type { PublicPlan } from "@/lib/plan-catalog";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/cn";

/** Plan cards with a Monthly/Yearly switch. The plans (and their prices) come from the database, via the page. */
export function PricingPlans({ plans }: { plans: PublicPlan[] }) {
  const [interval, setInterval] = useState<BillingInterval>("MONTH");

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
                    ? `Billed yearly. You save ${formatUsd(yearlySavings(plan))}, that's ${yearlySavingsLabel(plan) === "2 months free" ? "2 months free" : yearlySavingsLabel(plan)}.`
                    : "Billed yearly"
                  : "Billed every month"}
              </p>
            </div>
            <ul className="flex flex-1 flex-col gap-3">
              {plan.highlights.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Button href="/signup" size="lg" variant={plan.highlight ? "primary" : "ghost"}>
              Start free trial
            </Button>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
