"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { IntervalToggle } from "@/components/billing/interval-toggle";
import { formatUsd, intervalWord, priceFor, yearlySavings } from "@/components/billing/helpers";
import { Badge, Button, GlassCard } from "@/components/ui";
import { pricingPlans } from "@/lib/content/site";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/cn";

/** Plan cards with a Monthly/Yearly switch. Prices come from the billing catalog. */
export function PricingPlans() {
  const [interval, setInterval] = useState<BillingInterval>("MONTH");

  return (
    <div className="flex flex-col items-center gap-8">
      <IntervalToggle value={interval} onChange={setInterval} />
      <div className="mx-auto grid w-full max-w-4xl gap-6 md:grid-cols-2">
        {pricingPlans.map((plan) => (
          <GlassCard
            key={plan.id}
            strong={plan.highlighted}
            padding="lg"
            className={cn("relative flex flex-col gap-6", plan.highlighted && "shadow-glow ring-2 ring-pulse-violet/60")}
          >
            {plan.highlighted && (
              <Badge tone="violet" className="absolute top-6 right-6">
                Most popular
              </Badge>
            )}
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-bold tracking-tight">{plan.name}</h2>
              <p className="text-muted">{plan.description}</p>
            </div>
            <div>
              <p className="flex items-baseline gap-1.5">
                <span className="text-5xl font-bold tracking-[-0.04em]">{formatUsd(priceFor(plan.id, interval))}</span>
                <span className="text-muted">/ {intervalWord(interval)}</span>
              </p>
              <p className="mt-1 min-h-5 text-sm text-muted">
                {interval === "YEAR" ? `2 months free. You save ${formatUsd(yearlySavings(plan.id))} a year.` : "Billed every month"}
              </p>
            </div>
            <ul className="flex flex-1 flex-col gap-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Button href="/signup" size="lg" variant={plan.highlighted ? "primary" : "ghost"}>
              Start free trial
            </Button>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
