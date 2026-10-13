"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { OfferCard } from "@/components/billing/offer-card";
import { saveOfferAction } from "@/app/admin/(console)/offers/actions";
import { cn } from "@/lib/cn";
import { featureLabel, FEATURES, withPrerequisites, type FeatureKey } from "@/lib/features";
import { moneyInput, parseMoney } from "@/lib/invoices/shared";
import { formatMinor } from "@/lib/region-format";
import {
  adjustmentText,
  featureAddonKey,
  MANAGED_TIER_LABEL,
  MANAGED_TIERS,
  METRIC_LABEL,
  OFFER_METRICS,
  OFFER_VALID_DAYS_MAX,
  quoteAddition,
  quoteOffer,
  removalBlockedBy,
  type CurrentPlanForAddition,
  toClientOffer,
  type AddonPriceRow,
  type ManagedTier,
  type OfferBase,
  type OfferLimits,
} from "@/lib/offers/shared";

export type OfferEditorInitial = {
  mode: "plan" | "addon";
  basePlanKey: string | null;
  features: FeatureKey[];
  limits: OfferLimits;
  managedTier: ManagedTier;
  interval: "MONTH" | "YEAR";
  adjusted: string;
  adjustReason: string;
  note: string;
  validDays: number;
  requestId: string | null;
};

/**
 * "Customise plan": start from a regional plan (or none), tick features (prerequisites tick themselves; a feature
 * cannot be unticked while another needs it), set limits, and watch the total add up from the region's add-on prices.
 * Round or discount it with a reason, choose monthly or yearly, and preview what the client will see. Save keeps a
 * draft; Save and send emails the company owner. The server prices it again with the same maths (lib/offers/shared.ts).
 */
export function OfferEditor({ businessId, offerId, region, bases, prices, initial, addition, additionUnavailable, ownerEmail, now }: { businessId: string; offerId: string | null; region: { key: string; name: string; currency: string }; bases: OfferBase[]; prices: AddonPriceRow[]; initial: OfferEditorInitial; /** The client's running Mobile Money plan, for "Add to current plan" (null: not possible, see additionUnavailable). */ addition?: { current: CurrentPlanForAddition; interval: "MONTH" | "YEAR"; periodEnd: string } | null; additionUnavailable?: string | null; ownerEmail: string | null; /** The page's render time (ISO), for the preview's "open until". */ now: string }) {
  const currency = region.currency;
  const [mode, setMode] = useState<"plan" | "addon">(initial.mode === "addon" && addition ? "addon" : "plan");
  const adding = mode === "addon" && addition ? addition : null;
  const [baseKey, setBaseKey] = useState(initial.basePlanKey ?? "");
  const [selected, setSelected] = useState<FeatureKey[]>(initial.features);
  const [limits, setLimits] = useState<Record<keyof OfferLimits, string>>({ text: String(initial.limits.text), image: String(initial.limits.image), chat: String(initial.limits.chat), seats: String(initial.limits.seats), postsPerAppPerDay: String(initial.limits.postsPerAppPerDay) });
  const [tier, setTier] = useState<ManagedTier>(initial.managedTier);
  const [interval, setInterval] = useState<"MONTH" | "YEAR">(initial.interval);
  const [adjusted, setAdjusted] = useState(initial.adjusted);
  const [reason, setReason] = useState(initial.adjustReason);
  const [note, setNote] = useState(initial.note);
  const [validDays, setValidDays] = useState(String(initial.validDays));

  const base = adding ? { key: adding.current.key, name: adding.current.name, monthlyMinor: adding.current.priceMinor, yearlyMinor: adding.current.priceMinor, features: adding.current.features, limits: adding.current.limits } : (bases.find((b) => b.key === baseKey) ?? null);
  const baseFeatures = base?.features ?? [];
  const num = (v: string, min: number) => (/^\d+$/.test(v.trim()) ? Math.max(Number(v), min) : min);
  const numericLimits: OfferLimits = { text: num(limits.text, 0), image: num(limits.image, 0), chat: num(limits.chat, 0), seats: num(limits.seats, 1), postsPerAppPerDay: Math.min(10, Math.max(1, num(limits.postsPerAppPerDay, 1))) };
  const quote = useMemo(
    () => quoteOffer({ base, features: selected, limits: numericLimits, managedTier: tier, interval, currency, regionKey: region.key, prices }),
    // numericLimits is derived from limits
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, selected, limits, tier, interval, currency, region.key, prices],
  );
  const adjustedMinor = adjusted.trim() ? parseMoney(adjusted, currency) : null;
  // "Add to current plan": only the added features, a whole period, then prorated for the days left (lib/offers/shared.ts).
  const add = useMemo(
    () => (adding ? quoteAddition({ current: adding.current, features: selected, managedTier: tier, interval: adding.interval, currency, regionKey: region.key, prices, periodEnd: new Date(adding.periodEnd), now: new Date(now), addonMinor: adjustedMinor }) : null),
    [adding, selected, tier, currency, region.key, prices, now, adjustedMinor],
  );
  const computedForPrice = add ? add.computedMinor : quote.computedMinor;
  const total = add ? add.dueNowMinor : (adjustedMinor ?? quote.computedMinor);
  const changedPrice = adjustedMinor !== null && adjustedMinor !== computedForPrice;
  const adjustError = adjusted.trim() && adjustedMinor === null ? `Type a price like ${currency === "RWF" ? "70000" : "49.00"}.` : adjustedMinor !== null && adjustedMinor <= 0 ? "The price must be more than zero." : undefined;
  const reasonError = changedPrice && reason.trim().length < 3 ? "Say why (rounding, discount...)." : undefined;
  const sameAsBase = add ? add.added.length === 0 : quote.added.length === 0 && quote.lines.every((l) => l.key.startsWith("plan:"));
  const ready = !adjustError && !reasonError && total > 0 && !sameAsBase;

  const priceHint = (key: FeatureKey) => {
    const row = prices.find((p) => p.addonKey === featureAddonKey(key, tier) && p.regionKey === region.key && p.currency === currency);
    return row ? `${formatMinor(row.monthlyMinor, currency)} / month` : "No price set";
  };
  const toggle = (key: FeatureKey, on: boolean) => {
    if (on) setSelected(withPrerequisites([...selected, key]));
    else if (removalBlockedBy(key, quote.features, tier).length === 0) setSelected(selected.filter((k) => k !== key));
  };

  const data = JSON.stringify({
    basePlanKey: baseKey || null,
    features: quote.features,
    limits: numericLimits,
    managedTier: tier,
    interval,
    adjustedMinor: changedPrice ? adjustedMinor : null,
    adjustReason: changedPrice ? reason.trim() : null,
    note: note.trim() || null,
    validDays: num(validDays, 1),
    requestId: initial.requestId,
    mode: adding ? "addon" : "plan",
  });
  const preview = toClientOffer({
    id: offerId ?? "preview",
    status: "sent",
    interval: adding ? adding.interval : interval,
    currency,
    adjustedMinor: total,
    computedMinor: add ? add.computedDueMinor : quote.computedMinor,
    basePlanName: base?.name ?? null,
    features: add ? add.features : quote.features,
    added: add ? add.added : quote.added,
    limits: add ? { text: add.limits.text, image: add.limits.image, chat: add.limits.chat, seats: add.limits.seats, postsPerAppPerDay: numericLimits.postsPerAppPerDay } : numericLimits,
    managedTier: tier,
    lines: add ? add.lines : quote.lines,
    addition: add && adding ? { currentPlanKey: adding.current.key, currentPlanName: adding.current.name, currentMinor: add.currentMinor, addonMinor: add.addonMinor, nextRenewalMinor: add.nextRenewalMinor, periodEnd: adding.periodEnd, daysLeft: add.daysLeft, periodDays: add.periodDays, selfServe: false } : null,
    note: note.trim() || null,
    validUntil: new Date(new Date(now).getTime() + num(validDays, 1) * 86_400_000),
    payMethod: null,
    invoiceId: null,
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form action={saveOfferAction} className="flex min-w-0 flex-col gap-5">
        <input type="hidden" name="businessId" value={businessId} />
        {offerId && <input type="hidden" name="offerId" value={offerId} />}
        <input type="hidden" name="data" value={data} />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-semibold">What kind of offer</legend>
          <label className="flex min-h-11 items-start gap-2 text-[15px]">
            <input type="radio" name="mode-choice" checked={!adding} onChange={() => setMode("plan")} className="mt-1 size-5" />
            <span>
              <strong>New custom plan</strong>
              <span className="block text-[13px] text-muted">A plan of its own, paid in full; it starts a new period when paid.</span>
            </span>
          </label>
          <label className={cn("flex min-h-11 items-start gap-2 text-[15px]", !addition && "text-muted")}>
            <input type="radio" name="mode-choice" checked={Boolean(adding)} disabled={!addition} onChange={() => setMode("addon")} className="mt-1 size-5" />
            <span>
              <strong>Add to current plan</strong>
              <span className="block text-[13px] text-muted">
                {addition
                  ? `On top of ${addition.current.name}: the client pays only the added features, prorated for the days left until ${new Date(addition.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Kigali" })}; from then the plan costs the new total.`
                  : (additionUnavailable ?? "Not possible for this client.")}
              </span>
            </span>
          </label>
        </fieldset>

        {!adding && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start from" hint={`Plans offered in ${region.name}, at the region's price.`}>
            <Select value={baseKey} onChange={(e) => setBaseKey(e.target.value)}>
              <option value="">No plan, features only</option>
              {bases.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.name} ({formatMinor(interval === "YEAR" ? b.yearlyMinor : b.monthlyMinor, currency)} / {interval === "YEAR" ? "year" : "month"})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Billing period" hint="Yearly add-ons cost 10 months.">
            <Select value={interval} onChange={(e) => setInterval(e.target.value === "YEAR" ? "YEAR" : "MONTH")}>
              <option value="MONTH">Monthly</option>
              <option value="YEAR">Yearly</option>
            </Select>
          </Field>
        </div>
        )}

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-base font-semibold">Features</legend>
          <p className="mb-2 text-[13px] text-muted">Ticking a feature also ticks what it needs (priced too). A feature cannot be unticked while another one needs it.</p>
          {FEATURES.map((f) => {
            const inBase = baseFeatures.includes(f.key);
            const on = quote.features.includes(f.key);
            const neededBy = on && !inBase ? removalBlockedBy(f.key, quote.features, tier) : [];
            const soon = f.status === "coming_soon";
            return (
              <label key={f.key} className={cn("flex min-h-11 items-start gap-2 text-[15px]", (soon || inBase) && "text-muted")}>
                <input type="checkbox" checked={on} disabled={soon || inBase || neededBy.length > 0} onChange={(e) => toggle(f.key, e.target.checked)} className="mt-1 size-5" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="text-text">{f.label}</strong>
                    {soon && <Badge tone="violet">Coming soon</Badge>}
                    {inBase && <Badge tone="success">In {base?.name}</Badge>}
                    {neededBy.length > 0 && <Badge tone="blue">Needed by {neededBy.map(featureLabel).join(", ")}</Badge>}
                    {!soon && !inBase && <span className="text-[13px] text-muted">{priceHint(f.key)}</span>}
                  </span>
                  <span className="block text-[13px] text-muted">
                    {f.description}
                    {f.requires.length > 0 ? ` Needs ${f.requires.map(featureLabel).join(", ")}.` : ""}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {quote.features.includes("managed") && !baseFeatures.includes("managed") && (
          <Field label="Managed by BuPulse" hint="Full also brings Analytics (the monthly report).">
            <Select value={tier} onChange={(e) => setTier(e.target.value === "full" ? "full" : "light")}>
              {MANAGED_TIERS.map((t) => (
                <option key={t} value={t}>
                  {MANAGED_TIER_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {!adding && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-base font-semibold">Limits</legend>
          {([...OFFER_METRICS, "seats"] as const).map((m) => (
            <Field key={m} label={METRIC_LABEL[m]} hint={`${quote.included[m].toLocaleString("en-US")} included; more is priced in blocks.`}>
              <Input value={limits[m]} onChange={(e) => setLimits({ ...limits, [m]: e.target.value })} inputMode="numeric" maxLength={8} />
            </Field>
          ))}
          <Field label={METRIC_LABEL.postsPerAppPerDay} hint={`1 to 10; ${quote.included.postsPerAppPerDay} in the base plan. Not priced.`}>
            <Input value={limits.postsPerAppPerDay} onChange={(e) => setLimits({ ...limits, postsPerAppPerDay: e.target.value })} inputMode="numeric" maxLength={2} />
          </Field>
        </fieldset>
        )}

        <section aria-labelledby="offer-total" className="flex flex-col gap-3 rounded-2xl bg-soft p-4">
          <h2 id="offer-total" className="text-base font-semibold">Total</h2>
          <ul className="flex flex-col gap-1.5 text-[15px]">
            {(add ? add.lines : quote.lines).map((l) => (
              <li key={l.key} className="flex justify-between gap-3">
                <span>
                  {l.label}
                  {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                  {l.missingPrice && <Badge tone="danger" className="ml-2">No price in {region.key}</Badge>}
                </span>
                <span className="tabular-nums">{formatMinor(l.totalMinor, currency)}</span>
              </li>
            ))}
            {(add ? add.lines : quote.lines).length === 0 && <li className="text-muted">Nothing priced yet.</li>}
          </ul>
          <p className="flex justify-between border-t border-line pt-2 font-semibold">
            <span>{add ? "Added features, computed" : "Computed"}, per {(adding ? adding.interval : interval) === "YEAR" ? "year" : "month"}</span>
            <span className="tabular-nums">{formatMinor(computedForPrice, currency)}</span>
          </p>
          {add && adding && (
            <>
              <p className="flex justify-between font-semibold">
                <span>
                  Client pays now (prorated, {add.daysLeft} of {add.periodDays} days left)
                </span>
                <span className="tabular-nums">{formatMinor(add.dueNowMinor, currency)}</span>
              </p>
              <p className="flex justify-between text-[15px]">
                <span>Next renewal ({new Date(adding.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Kigali" })}): {adding.current.name} + added features</span>
                <span className="tabular-nums">{formatMinor(add.nextRenewalMinor, currency)}</span>
              </p>
              <p className="text-[13px] text-muted">Prorated again from the days left on the day the client accepts. The period end does not change.</p>
            </>
          )}
          {(add ? add.missing : quote.missing).length > 0 && <p role="alert" className="text-[13px] text-danger">No price in {region.name} for {(add ? add.missing : quote.missing).join(", ")}. Add it in Add-on prices, or type the price below.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={add ? `Price of the added features per period (${currency})` : `Price the client pays (${currency})`} hint={`Empty = the computed total.${adjustedMinor && computedForPrice ? ` ${adjustmentText(computedForPrice, adjustedMinor) ?? ""}` : ""}`} error={adjustError}>
              <Input value={adjusted} onChange={(e) => setAdjusted(e.target.value)} placeholder={moneyInput(computedForPrice, currency)} inputMode="decimal" maxLength={14} />
            </Field>
            <Field label="Why the price differs" error={reasonError}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!changedPrice} maxLength={200} placeholder="Rounded, launch discount..." />
            </Field>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field label="Message to the client (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
          </Field>
          <Field label="Open for (days)">
            <Input value={validDays} onChange={(e) => setValidDays(e.target.value)} inputMode="numeric" maxLength={2} aria-describedby="valid-hint" />
          </Field>
        </div>
        <p id="valid-hint" className="-mt-3 text-[13px] text-muted">1 to {OFFER_VALID_DAYS_MAX} days from sending; the client pays at the price above.</p>

        {sameAsBase && <p className="text-[13px] text-muted">{add ? "Tick a feature the plan does not have yet." : "Add a feature or raise a limit: this is the same as the base plan."}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="save" variant="outline" disabled={!ready}>
            Save draft
          </Button>
          <Button type="submit" name="intent" value="send" disabled={!ready || !ownerEmail}>
            Save and send{ownerEmail ? ` to ${ownerEmail}` : ""}
          </Button>
        </div>
      </form>

      <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-4 xl:self-start">
        <h2 className="px-1 text-sm font-medium text-muted">Preview</h2>
        <OfferCard offer={preview} preview />
      </div>
    </div>
  );
}
