"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Dialog, GlassCard, useToast } from "@/components/ui";
import { IntervalToggle } from "./interval-toggle";
import { useTheme } from "@/components/theme";
import { changePlan, startCheckout, startMomoPayment } from "@/app/dashboard/billing/actions";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import type { Plan } from "@/lib/plans";
import type { RegionalPlan } from "@/lib/region-prices";
import { paymentMethodLabel, type PaymentMethod } from "@/lib/region-format";
import { CARD_SOON, offersChoice, payMethods, soleMethod, type CardPriced, type PayMethods } from "@/lib/billing/pay-methods";
import { PayChoice } from "./pay-choice";
import { openCheckout } from "./checkout";
import { momoPriceOf } from "@/lib/billing/momo-shared";
import { formatPlanPrice, formatPrice, intervalWord, planButtonAction, planFeatures, yearlyBadge, yearlySavingsLabel, yearlySavingsMinor } from "./helpers";
import { PriceTag } from "./price-tag";
import { usePayState } from "./pay-state";

type Props = {
  /** The plans a client can pick (active, in sort order), at the company's region's prices. */
  plans: RegionalPlan[];
  current: { plan: Plan; interval: BillingInterval; paid: boolean; pastDue: boolean; method: "card" | "momo" | null };
  /**
   * How the company can pay (lib/billing/pay-methods.ts): the region's methods, whether the owner has set up where to
   * pay by Mobile Money, whether card checkout is configured, and which plans have a card price in the region.
   */
  pay: { regionMethods: PaymentMethod[]; momoConfigured: boolean; cardConfigured: boolean; cardPriced: CardPriced; /** Why card cannot be chosen yet (a Mobile Money plan before its renewal window). */ cardBlocked?: string | null };
};

export function PlanPicker({ plans, current, pay }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const [interval, setInterval] = useState<BillingInterval>(current.interval);
  const [pending, start] = useTransition();
  const [busyPlan, setBusyPlan] = useState<Plan | null>(null);
  const [switchTo, setSwitchTo] = useState<Plan | null>(null);
  const [chooseFor, setChooseFor] = useState<Plan | null>(null);
  // A payment was just reported or a card payment just went through: no second plan while the page refreshes.
  const payState = usePayState();
  const planOf = (key: Plan) => plans.find((p) => p.key === key)!;
  // A plan can be paid by Mobile Money at its regional price (docs/REGIONS.md: the one source of truth for RWF amounts).
  const momoPrice = (key: Plan) => momoPriceOf(planOf(key), interval);
  const methodsFor = (key: Plan): PayMethods =>
    payMethods({ regionMethods: pay.regionMethods, momoConfigured: pay.momoConfigured, momoPriced: momoPrice(key) !== null, cardConfigured: pay.cardConfigured, cardPriced: Boolean(pay.cardPriced[key]?.[interval]) });
  // Both methods listed for the region: ask. Otherwise the one that is ready opens straight away.
  function choose(key: Plan) {
    const methods = methodsFor(key);
    if (offersChoice(methods)) return setChooseFor(key);
    const only = soleMethod(methods);
    if (only === "momo") payByMomo(key);
    else if (only === "card") upgrade(key);
  }
  function chooseNote(methods: PayMethods): string {
    if (offersChoice(methods)) return "Mobile Money or card. Cancel any time.";
    const only = soleMethod(methods);
    if (only === "momo") return "Mobile Money (MTN / Airtel). Approved within minutes.";
    if (only === "card") return "Secure checkout. Cancel any time.";
    return methods.card !== "off" ? CARD_SOON : "Online payment is not available here yet. Contact us.";
  }
  // The card price: the derived USD price of a local-currency plan, else the plan's own (USD) price.
  const cardPrice = (key: Plan) => {
    const p = planOf(key);
    return p.card ? (interval === "YEAR" ? p.card.yearlyUsdCents : p.card.monthlyUsdCents) : interval === "YEAR" ? p.yearlyPriceCents : p.monthlyPriceCents;
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
                      ? `Billed yearly. You save ${formatPrice(yearlySavingsMinor(plan), plan.currency)}, that's ${yearlySavingsLabel(plan)}.`
                      : "Billed yearly"
                    : "Billed every month"}
                </p>
                {plan.card && (
                  <p className="mt-1 text-sm text-muted">
                    or {formatPrice(interval === "YEAR" ? plan.card.yearlyUsdCents : plan.card.monthlyUsdCents, "USD")} / {intervalWord(interval)} by card
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {plan.paymentMethods.map((m) => (
                    <Badge key={m} tone={m === "momo" ? "success" : "blue"}>
                      {paymentMethodLabel(m)}
                    </Badge>
                  ))}
                </div>
              </div>
              <ul className="flex flex-1 flex-col gap-2 text-[15px]">
                {(plan.highlights.length > 0 ? plan.highlights : planFeatures(plan.limits)).map((f) => (
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
                  <Button className="w-full" onClick={() => choose(key)} disabled={pending || Boolean(payState) || (!offersChoice(methodsFor(key)) && !soleMethod(methodsFor(key)))}>
                    {busy ? "One moment…" : current.method === "momo" ? `Switch to ${name}` : `Upgrade to ${name}`}
                  </Button>
                  <span className="text-center text-xs text-muted">{chooseNote(methodsFor(key))}</span>
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
        description={current.method === "momo" ? "Mobile Money: your new plan starts when the payment is confirmed. Card: it starts now and its first renewal is moved by the days you have already paid." : "Card renews by itself every period. Mobile Money is paid by hand each period; we remind you before it ends."}
      >
        {chooseFor && (
          <PayChoice
            methods={methodsFor(chooseFor)}
            momoNote={momoPrice(chooseFor) ? `${formatPrice(momoPrice(chooseFor)!.amountMinor, momoPrice(chooseFor)!.currency)} per ${intervalWord(interval)}. Approved within minutes.` : ""}
            cardNote={`${formatPrice(cardPrice(chooseFor), "USD")} per ${intervalWord(interval)}, charged in USD. Renews automatically.`}
            cardBlocked={current.method === "momo" ? (pay.cardBlocked ?? null) : null}
            onMomo={() => payByMomo(chooseFor)}
            onCard={() => upgrade(chooseFor)}
            disabled={pending}
          />
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
              New price: <strong>{formatPlanPrice(planOf(switchTo), interval)}</strong> per {intervalWord(interval)}.
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
