"use client";

import { Check } from "lucide-react";
import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { formatPrice } from "@/components/billing/helpers";
import type { RegionalPlan } from "@/lib/region-prices";
import { paymentMethodLabel } from "@/lib/region-format";
import { cn } from "@/lib/cn";
import { choosePlanAction, type BookDemoState } from "@/app/book-demo/actions";

/** Step 1 of /book-demo: the region's plans as radio cards. */
export function PlanChoice({ plans, current }: { plans: RegionalPlan[]; current: string | null }) {
  const [selected, setSelected] = useState<string | null>(current ?? plans.find((p) => p.highlight)?.key ?? plans[0]?.key ?? null);
  const [state, formAction, pending] = useActionState<BookDemoState, FormData>(choosePlanAction, {});

  if (plans.length === 0) {
    return <p className="rounded-2xl bg-soft px-4 py-6 text-center text-[15px] text-muted">No plans are offered in your region yet. Reply to your welcome email and we will sort it out.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const on = selected === plan.key;
          return (
            <label
              key={plan.key}
              className={cn(
                "flex cursor-pointer flex-col gap-3 rounded-card border p-4 transition-colors",
                on ? "border-pulse-violet/60 bg-glass-strong shadow-glow" : "border-line hover:bg-soft",
              )}
            >
              <input type="radio" name="plan" value={plan.key} checked={on} onChange={() => setSelected(plan.key)} className="sr-only" />
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col">
                  <strong className="text-lg">{plan.name}</strong>
                  <span className="text-[13px] text-muted">{plan.description}</span>
                </div>
                <span aria-hidden className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full border", on ? "border-pulse-violet bg-pulse-violet text-white" : "border-line")}>
                  {on && <Check className="size-4" />}
                </span>
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tracking-[-0.03em]">{formatPrice(plan.monthlyPriceCents, plan.currency)}</span>
                <span className="text-sm text-muted">/ month</span>
              </p>
              {plan.card && <p className="text-[13px] text-muted">or {formatPrice(plan.card.monthlyUsdCents, "USD")} a month by card</p>}
              <div className="flex flex-wrap gap-1.5">
                {plan.paymentMethods.map((m) => (
                  <Badge key={m} tone={m === "momo" ? "success" : "blue"}>
                    {paymentMethodLabel(m)}
                  </Badge>
                ))}
              </div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {plan.highlights.slice(0, 5).map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                    {h}
                  </li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>
      <Button type="submit" size="lg" disabled={pending || !selected} trailing={<ArrowRight aria-hidden className="size-4" />}>
        {pending ? "Saving…" : "Continue to pick a time"}
      </Button>
    </form>
  );
}
