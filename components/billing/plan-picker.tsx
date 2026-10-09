"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Dialog, GlassCard, useToast } from "@/components/ui";
import { IntervalToggle } from "./interval-toggle";
import { useTheme } from "@/components/theme";
import { changePlan, startCheckout } from "@/app/dashboard/billing/actions";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import type { Plan } from "@/lib/plans";
import type { PublicPlan } from "@/lib/plan-catalog";
import { openCheckout } from "./checkout";
import { formatUsd, intervalWord, planButtonAction, planFeatures, priceFor, yearlyBadge, yearlySavings, yearlySavingsLabel } from "./helpers";
import { PriceTag } from "./price-tag";

type Props = {
  /** The plans a client can pick (active, in sort order), from the database. */
  plans: PublicPlan[];
  current: { plan: Plan; interval: BillingInterval; paid: boolean; pastDue: boolean };
};

export function PlanPicker({ plans, current }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const [interval, setInterval] = useState<BillingInterval>(current.interval);
  const [pending, start] = useTransition();
  const [busyPlan, setBusyPlan] = useState<Plan | null>(null);
  const [switchTo, setSwitchTo] = useState<Plan | null>(null);
  const planOf = (key: Plan) => plans.find((p) => p.key === key)!;

  function upgrade(plan: Plan) {
    setBusyPlan(plan);
    start(async () => {
      const result = await startCheckout({ plan, interval });
      if (!result.ok) {
        toast(result.error, "error");
        setBusyPlan(null);
        return;
      }
      try {
        await openCheckout(result.config, resolvedTheme, {
          onClosed: () => setBusyPlan(null),
          onError: (message) => {
            toast(message, "error");
            setBusyPlan(null);
          },
        });
      } catch (error) {
        toast(error instanceof Error ? error.message : "Checkout could not open. Please try again.", "error");
        setBusyPlan(null);
      }
    });
  }

  function confirmSwitch() {
    if (!switchTo) return;
    const plan = switchTo;
    start(async () => {
      const result = await changePlan({ plan, interval });
      setSwitchTo(null);
      if (result.ok) {
        toast(`You are now on ${planOf(plan).name} (${interval === "YEAR" ? "yearly" : "monthly"}).`, "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <section aria-labelledby="plans-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <h2 id="plans-heading" className="text-xl font-semibold tracking-[-0.02em]">
          {current.paid ? "Change plan" : "Choose a plan"}
        </h2>
        <IntervalToggle value={interval} onChange={setInterval} badge={yearlyBadge(plans)} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5">
        {plans.map((plan) => {
          const key = plan.key;
          const action = planButtonAction(current, { plan: key, interval });
          const name = plan.name;
          const busy = pending && busyPlan === key;
          return (
            <GlassCard key={key} className="flex flex-col gap-5 p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">{name}</h3>
                {plan.highlight && <Badge tone="violet">Most complete</Badge>}
              </div>
              <div>
                <PriceTag plan={plan} interval={interval} size="md" />
                <p className="mt-1 min-h-5 text-sm text-muted">
                  {interval === "YEAR"
                    ? yearlySavingsLabel(plan)
                      ? `Billed yearly. You save ${formatUsd(yearlySavings(plan))}, that's ${yearlySavingsLabel(plan)}.`
                      : "Billed yearly"
                    : "Billed every month"}
                </p>
              </div>
              <ul className="flex flex-1 flex-col gap-2 text-[15px]">
                {(plan.features.length > 0 ? plan.features : planFeatures(plan.limits)).map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-blue" />
                    {f}
                  </li>
                ))}
              </ul>
              {action === "current" ? (
                <Badge tone="success" className="self-start px-4 py-2 text-sm">
                  Your current plan
                </Badge>
              ) : action === "upgrade" ? (
                <div className="flex flex-col gap-2">
                  <Button className="w-full" onClick={() => upgrade(key)} disabled={pending}>
                    {busy ? "Opening checkout…" : `Upgrade to ${name}`}
                  </Button>
                  <span className="text-center text-xs text-muted">Secure checkout. Cancel any time.</span>
                </div>
              ) : (
                <Button
                  variant={plan.highlight ? "primary" : "ghost"}
                  className="w-full"
                  onClick={() => setSwitchTo(key)}
                  disabled={pending || current.pastDue}
                >
                  Switch to {name} {interval === "YEAR" ? "yearly" : "monthly"}
                </Button>
              )}
            </GlassCard>
          );
        })}
      </div>
      {current.pastDue && (
        <p className="px-1 text-sm text-muted">Update your payment method above before changing plan.</p>
      )}

      <Dialog
        open={switchTo !== null}
        onOpenChange={(open) => !open && setSwitchTo(null)}
        title={switchTo ? `Switch to ${planOf(switchTo).name} ${interval === "YEAR" ? "yearly" : "monthly"}?` : "Switch plan"}
        description="The change starts now. You are charged or credited only the difference for the time left in your current period (prorated), and your new limits apply straight away."
      >
        {switchTo && (
          <div className="flex flex-col gap-5">
            <p className="text-[15px]">
              New price: <strong>{formatUsd(priceFor(planOf(switchTo), interval))}</strong> per {intervalWord(interval)}.
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="ghost" onClick={() => setSwitchTo(null)}>
                Not now
              </Button>
              <Button onClick={confirmSwitch} disabled={pending}>
                {pending ? "Switching…" : "Confirm switch"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
