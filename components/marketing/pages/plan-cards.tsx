import { Check } from "lucide-react";
import { Badge, Button, GlassCard } from "@/components/ui";
import { pricingPlans } from "@/lib/content/site";
import { cn } from "@/lib/cn";

export function PlanCards() {
  return (
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
          <p className="flex items-baseline gap-1.5">
            <span className="text-5xl font-bold tracking-[-0.04em]">${plan.price}</span>
            <span className="text-muted">/ month</span>
          </p>
          <ul className="flex flex-1 flex-col gap-3">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <Button href="/login" size="lg" variant={plan.highlighted ? "primary" : "ghost"}>
            Start free trial
          </Button>
        </GlassCard>
      ))}
    </div>
  );
}
