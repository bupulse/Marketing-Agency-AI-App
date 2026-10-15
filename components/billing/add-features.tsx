"use client";

import Link from "next/link";
import { ArrowRight, CreditCard, FileText, Smartphone } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, GlassCard, useToast } from "@/components/ui";
import { addFeaturesAction } from "@/app/dashboard/billing/actions";
import { featureLabel, FEATURES, withPrerequisites, type FeatureKey } from "@/lib/features";
import { methodReason, type MethodState } from "@/lib/billing/pay-methods";
import { offerCardQuote, quoteAddition, type AddonPriceRow, type CurrentPlanForAddition } from "@/lib/offers/shared";
import { useTheme } from "@/components/theme";
import { cardQuoteText, payByCard, type CardQuoteView } from "./card-checkout";
import { PayStateNote, usePayState } from "./pay-state";
import { formatMinor } from "@/lib/region-format";
import { cn } from "@/lib/cn";

export type AddFeaturesData = {
  current: CurrentPlanForAddition;
  interval: "MONTH" | "YEAR";
  periodEnd: string;
  region: { key: string; currency: string };
  prices: AddonPriceRow[];
  addable: FeatureKey[];
  /** Built but not set up yet (lib/feature-setup.ts): listed as "Coming soon", cannot be ticked. */
  soon?: FeatureKey[];
};

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kigali" });

/**
 * "Add features" on Billing (docs/OFFERS.md, "Adding features to a paid plan"): what the plan has is ticked and locked;
 * the client ticks priced features (prerequisites tick themselves) and sees at once what they pay now (only the added
 * features, prorated for the days left) and what the plan costs from the next renewal. Mobile Money or an invoice pays
 * it, or card: the amount converted to US dollars with the card rule of RWF plans (`cardRate`, from Settings), shown
 * before paying and checked again by the server. `cardRate` is null when card payments are not set up or switched off:
 * no card button then. Anything else: "Request a custom change".
 */
export function AddFeatures({ data, unavailable, momo, cardRate, now }: { data: AddFeaturesData | null; unavailable: string | null; momo: MethodState; cardRate: { usdToRwf: number; marginPercent: number } | null; contactEmail?: string; now: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"momo" | "invoice" | "card" | null>(null);
  // Shown under the card button as well as in a toast, so a failed card start is never silent.
  const [cardError, setCardError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeatureKey[]>([]);
  // The rate the server answered with when it changed since the page loaded (its quote wins).
  const [usdOverride, setUsdOverride] = useState<{ dueMinor: number; usdCents: number } | null>(null);
  // A payment was just reported or a card payment just went through: nothing more to pay while the page refreshes.
  const payState = usePayState();
  const owned = new Set<FeatureKey>(data?.current.features ?? []);
  const quote = useMemo(
    () => (data && selected.length > 0 ? quoteAddition({ current: data.current, features: selected, interval: data.interval, currency: data.region.currency, regionKey: data.region.key, prices: data.prices, periodEnd: new Date(data.periodEnd), now: new Date(now) }) : null),
    [data, selected, now],
  );
  const per = data?.interval === "YEAR" ? "year" : "month";
  const priceOf = (key: FeatureKey) => data?.prices.find((p) => p.addonKey === key && p.regionKey === data.region.key)?.monthlyMinor ?? null;
  const canPay = Boolean(quote && quote.dueNowMinor > 0 && quote.missing.length === 0);
  const card: CardQuoteView | null =
    cardRate && quote && data && canPay
      ? { usdCents: usdOverride?.dueMinor === quote.dueNowMinor ? usdOverride.usdCents : offerCardQuote(quote.dueNowMinor, data.region.currency, cardRate.usdToRwf, cardRate.marginPercent).usdCents, quoteMinor: quote.dueNowMinor, currency: data.region.currency }
      : null;

  function payCard() {
    if (!card) return;
    const shown = card;
    setBusy("card");
    setCardError(null);
    start(async () => {
      await payByCard(() => addFeaturesAction({ features: selected, method: "card", expectedUsdCents: shown.usdCents }), resolvedTheme, {
        onRequote: (usdCents, message) => {
          setCardError(message);
          setUsdOverride({ dueMinor: shown.quoteMinor, usdCents });
          setBusy(null);
          toast(message, "error");
        },
        onError: (message) => {
          setBusy(null);
          setCardError(message);
          toast(message, "error");
        },
        onClosed: () => {
          setBusy(null);
          router.refresh();
        },
      });
    });
  }

  const toggle = (key: FeatureKey, on: boolean) => {
    if (on) setSelected(withPrerequisites([...selected, key]).filter((k) => !owned.has(k)));
    else if (!selected.some((k) => k !== key && withPrerequisites([k]).includes(key))) setSelected(selected.filter((k) => k !== key));
  };

  function pay(method: "momo" | "invoice") {
    setBusy(method);
    start(async () => {
      const result = await addFeaturesAction({ features: selected, method });
      setBusy(null);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast(method === "momo" ? "Pay by Mobile Money above. The features switch on once the payment is confirmed." : "Your invoice is above and in your email. The features switch on once it is paid.", "success");
      setSelected([]);
      router.refresh();
    });
  }

  return (
    <GlassCard as="section" aria-labelledby="add-features-heading" className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="add-features-heading" className="text-xl font-semibold tracking-[-0.02em]">
          Add features to your plan
        </h2>
        <p className="text-sm text-muted">
          {data
            ? `You pay now only for what you add, for the days left until ${longDate(data.periodEnd)}. From then on your plan costs the new total.`
            : unavailable}
        </p>
      </div>

      {data && (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Features</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {FEATURES.filter((f) => owned.has(f.key) || data.addable.includes(f.key) || data.soon?.includes(f.key)).map((f) => {
              const have = owned.has(f.key);
              const soon = !have && !data.addable.includes(f.key);
              const neededBy = !have ? selected.filter((k) => k !== f.key && withPrerequisites([k]).includes(f.key)) : [];
              const price = priceOf(f.key);
              return (
                <label key={f.key} className={cn("flex min-h-11 items-start gap-2 text-[15px]", soon && "text-muted")}>
                  <input type="checkbox" checked={have || selected.includes(f.key)} disabled={have || soon || neededBy.length > 0 || pending} onChange={(e) => toggle(f.key, e.target.checked)} className="mt-1 size-5" />
                  <span>
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="font-medium">{f.label}</strong>
                      {have && <Badge tone="success">In your plan</Badge>}
                      {soon && <Badge tone="violet">Coming soon</Badge>}
                      {neededBy.length > 0 && <Badge tone="blue">Needed by {neededBy.map(featureLabel).join(", ")}</Badge>}
                      {!have && !soon && price !== null && <span className="text-[13px] text-muted">+{formatMinor(price, data.region.currency)} / month</span>}
                    </span>
                    <span className="block text-[13px] text-muted">{f.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {data.addable.length === 0 && <p className="text-sm text-muted">Everything that can be added here is already in your plan.</p>}
        </fieldset>
      )}

      {quote && data && (
        <dl className="grid gap-1.5 rounded-2xl bg-soft p-4 text-[15px]" aria-live="polite">
          {quote.lines.map((l) => (
            <div key={l.key} className="flex justify-between gap-3">
              <dt>{l.label}</dt>
              <dd className="tabular-nums">
                {formatMinor(l.totalMinor, data.region.currency)} / {per}
              </dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
            <dt>
              To pay now ({quote.daysLeft} of {quote.periodDays} days left)
            </dt>
            <dd className="tabular-nums">{formatMinor(quote.dueNowMinor, data.region.currency)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-muted">
            <dt>From {longDate(data.periodEnd)}</dt>
            <dd className="tabular-nums">
              {formatMinor(quote.nextRenewalMinor, data.region.currency)} / {per}
            </dd>
          </div>
        </dl>
      )}

      {/* Nothing can be added here (a card plan): no pay buttons, only the reason above. They used to show disabled,
          with "Mobile Money coming soon" on a method that works. */}
      {!data ? null : payState ? (
        <PayStateNote state={payState} />
      ) : (
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => pay("momo")} disabled={!canPay || pending || momo !== "ready"} leading={<Smartphone aria-hidden className="size-5" />}>
          {methodReason("momo", momo) ?? (busy === "momo" ? "Opening…" : "Pay with Mobile Money")}
        </Button>
        <Button variant="outline" onClick={() => pay("invoice")} disabled={!canPay || pending} leading={<FileText aria-hidden className="size-5" />}>
          {busy === "invoice" ? "Preparing…" : "Get an invoice"}
        </Button>
        {cardRate && (
          <Button variant="outline" onClick={payCard} disabled={!card || pending} leading={<CreditCard aria-hidden className="size-5" />}>
            {busy === "card" ? "Opening checkout…" : "Pay by card"}
          </Button>
        )}
      </div>
      )}
      {card && !payState && <p className="text-[13px] text-muted">{cardQuoteText(card)}, charged in US dollars once. The added features switch on as soon as the payment goes through.</p>}
      {cardError && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {cardError}
        </p>
      )}
      <Link href="/custom-plan?from=billing" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold no-underline">
        Something else? Request a custom change
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </GlassCard>
  );
}
