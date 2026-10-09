"use client";

import { Check, CreditCard, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Dialog, GlassCard, useToast } from "@/components/ui";
import { IntervalToggle } from "./interval-toggle";
import { useTheme } from "@/components/theme";
import { changePlan, startCheckout, startMomoPayment } from "@/app/dashboard/billing/actions";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import type { Plan } from "@/lib/plans";
import type { PublicPlan } from "@/lib/plan-catalog";
import { openCheckout } from "./checkout";
import { formatMomoAmount } from "@/lib/billing/momo-shared";
import { formatUsd, intervalWord, planButtonAction, planFeatures, priceFor, yearlyBadge, yearlySavings, yearlySavingsLabel } from "./helpers";
import { PriceTag } from "./price-tag";

type Props = {
  /** The plans a client can pick (active, in sort order), from the database. */
  plans: PublicPlan[];
  current: { plan: Plan; interval: BillingInterval; paid: boolean; pastDue: boolean; method: "card" | "momo" | null };
  /** Mobile Money, when the owner has set up where to pay: the RWF price of each plan. Null hides the choice. */
  momo: { prices: Record<string, { monthlyMinor: number; yearlyMinor: number }> } | null;
};

export function PlanPicker({ plans, current, momo }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const [interval, setInterval] = useState<BillingInterval>(current.interval);
  const [pending, start] = useTransition();
  const [busyPlan, setBusyPlan] = useState<Plan | null>(null);
  const [switchTo, setSwitchTo] = useState<Plan | null>(null);
  const [chooseFor, setChooseFor] = useState<Plan | null>(null);
  const planOf = (key: Plan) => plans.find((p) => p.key === key)!;
  const momoPrice = (key: Plan) => {
    const p = momo?.prices[key];
    return p ? (interval === "YEAR" ? p.yearlyMinor : p.monthlyMinor) : null;
  };

  // Mobile Money: a pending payment is created and the Billing page shows the pay screen (reference, where to pay).
  function payByMomo(plan: Plan) {
    setChooseFor(null);
    setBusyPlan(plan);
    start(async () => {
      const result = await startMomoPayment({ plan, interval });
      setBusyPlan(null);
      if (result.ok) router.refresh();
      else toast(result.error, "error");
    });
  }

  function upgrade(plan: Plan) {
    setChooseFor(null);
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
              ) : action === "upgrade" || current.method === "momo" ? (
                <div className="flex flex-col gap-2">
                  <Button className="w-full" onClick={() => (momo ? setChooseFor(key) : upgrade(key))} disabled={pending}>
                    {busy ? "One moment…" : current.method === "momo" ? `Switch to ${name}` : `Upgrade to ${name}`}
                  </Button>
                  <span className="text-center text-xs text-muted">{momo ? "Card or Mobile Money. Cancel any time." : "Secure checkout. Cancel any time."}</span>
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
        open={chooseFor !== null}
        onOpenChange={(open) => !open && setChooseFor(null)}
        title={chooseFor ? `How would you like to pay for ${planOf(chooseFor).name}?` : "How would you like to pay?"}
        description={current.method === "momo" ? "Your new plan starts when the payment is confirmed; the time left on your current plan is added on." : "Card renews by itself every period. Mobile Money is paid by hand each period; we remind you before it ends."}
      >
        {chooseFor && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => payByMomo(chooseFor)}
              disabled={pending || momoPrice(chooseFor) === null}
              className="glass flex min-h-11 cursor-pointer flex-col items-start gap-2 rounded-2xl p-4 text-left transition-colors hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Smartphone aria-hidden className="size-5 text-pulse-blue" />
              <strong>Mobile Money (MoMo / Airtel)</strong>
              <span className="text-sm text-muted">{momoPrice(chooseFor) !== null ? `${formatMomoAmount(momoPrice(chooseFor) as number)} per ${intervalWord(interval)}. Approved within minutes.` : "Not available for this plan yet."}</span>
            </button>
            <button
              type="button"
              onClick={() => upgrade(chooseFor)}
              disabled={pending || current.method === "momo"}
              className="glass flex min-h-11 cursor-pointer flex-col items-start gap-2 rounded-2xl p-4 text-left transition-colors hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CreditCard aria-hidden className="size-5 text-pulse-violet" />
              <strong>Card</strong>
              <span className="text-sm text-muted">{current.method === "momo" ? "Available at your next renewal." : `${formatUsd(priceFor(planOf(chooseFor), interval))} per ${intervalWord(interval)}, charged in USD. Renews automatically.`}</span>
            </button>
          </div>
        )}
      </Dialog>

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
