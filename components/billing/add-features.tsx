"use client";

import Link from "next/link";
import { ArrowRight, CreditCard, FileText, Smartphone } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, GlassCard, useToast } from "@/components/ui";
import { addFeaturesAction } from "@/app/dashboard/billing/actions";
import { featureLabel, FEATURES, withPrerequisites, type FeatureKey } from "@/lib/features";
import { methodReason, type MethodState } from "@/lib/billing/pay-methods";
import { quoteAddition, type AddonPriceRow, type CurrentPlanForAddition } from "@/lib/offers/shared";
import { formatMinor } from "@/lib/region-format";

export type AddFeaturesData = {
  current: CurrentPlanForAddition;
  interval: "MONTH" | "YEAR";
  periodEnd: string;
  region: { key: string; currency: string };
  prices: AddonPriceRow[];
  addable: FeatureKey[];
};

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kigali" });

/**
 * "Add features" on Billing (docs/OFFERS.md, "Adding features to a paid plan"): what the plan has is ticked and locked;
 * the client ticks priced features (prerequisites tick themselves) and sees at once what they pay now (only the added
 * features, prorated for the days left) and what the plan costs from the next renewal. Mobile Money or an invoice pays
 * it; card is set up by the team ("Ask us for a card link"). Anything else: "Request a custom change".
 */
export function AddFeatures({ data, unavailable, momo, card, contactEmail, now }: { data: AddFeaturesData | null; unavailable: string | null; momo: MethodState; card: MethodState; contactEmail: string; now: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"momo" | "invoice" | null>(null);
  const [selected, setSelected] = useState<FeatureKey[]>([]);
  const [cardHelp, setCardHelp] = useState(false);
  const owned = new Set<FeatureKey>(data?.current.features ?? []);
  const quote = useMemo(
    () => (data && selected.length > 0 ? quoteAddition({ current: data.current, features: selected, interval: data.interval, currency: data.region.currency, regionKey: data.region.key, prices: data.prices, periodEnd: new Date(data.periodEnd), now: new Date(now) }) : null),
    [data, selected, now],
  );
  const per = data?.interval === "YEAR" ? "year" : "month";
  const priceOf = (key: FeatureKey) => data?.prices.find((p) => p.addonKey === key && p.regionKey === data.region.key)?.monthlyMinor ?? null;
  const canPay = Boolean(quote && quote.dueNowMinor > 0 && quote.missing.length === 0);

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
            {FEATURES.filter((f) => owned.has(f.key) || data.addable.includes(f.key)).map((f) => {
              const have = owned.has(f.key);
              const neededBy = !have ? selected.filter((k) => k !== f.key && withPrerequisites([k]).includes(f.key)) : [];
              const price = priceOf(f.key);
              return (
                <label key={f.key} className="flex min-h-11 items-start gap-2 text-[15px]">
                  <input type="checkbox" checked={have || selected.includes(f.key)} disabled={have || neededBy.length > 0 || pending} onChange={(e) => toggle(f.key, e.target.checked)} className="mt-1 size-5" />
                  <span>
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="font-medium">{f.label}</strong>
                      {have && <Badge tone="success">In your plan</Badge>}
                      {neededBy.length > 0 && <Badge tone="blue">Needed by {neededBy.map(featureLabel).join(", ")}</Badge>}
                      {!have && price !== null && <span className="text-[13px] text-muted">+{formatMinor(price, data.region.currency)} / month</span>}
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

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => pay("momo")} disabled={!canPay || pending || momo !== "ready"} leading={<Smartphone aria-hidden className="size-5" />}>
          {methodReason("momo", momo) ?? (busy === "momo" ? "Opening…" : "Pay with Mobile Money")}
        </Button>
        <Button variant="outline" onClick={() => pay("invoice")} disabled={!canPay || pending} leading={<FileText aria-hidden className="size-5" />}>
          {busy === "invoice" ? "Preparing…" : "Get an invoice"}
        </Button>
        <Button variant="outline" onClick={() => setCardHelp((v) => !v)} disabled={card === "off"} aria-expanded={cardHelp} leading={<CreditCard aria-hidden className="size-5" />}>
          {card === "off" ? methodReason("card", card) : "Pay by card"}
        </Button>
      </div>
      {cardHelp && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">
          Card payment for added features is set up by our team. Ask us for a card link at{" "}
          <a href={`mailto:${contactEmail}?subject=${encodeURIComponent("Card link to add features to my plan")}`} className="font-semibold underline">
            {contactEmail}
          </a>
          .
        </p>
      )}
      <Link href="/custom-plan?from=billing" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold no-underline">
        Something else? Request a custom change
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </GlassCard>
  );
}
