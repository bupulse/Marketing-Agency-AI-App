import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { CheckoutScript } from "@/components/billing/checkout";
import { CheckoutReturn } from "@/components/billing/checkout-return";
import { formatDate, formatPrice, intervalWord, formatUsd, statusLabel } from "@/components/billing/helpers";
import { ClientInvoices } from "@/components/billing/client-invoices";
import { InvoiceList } from "@/components/billing/invoice-list";
import { InvoicePay } from "@/components/billing/invoice-pay";
import { MomoPayment } from "@/components/billing/momo-payment";
import { PlanActions } from "@/components/billing/plan-actions";
import { PlanPicker } from "@/components/billing/plan-picker";
import { Badge, GlassCard, Meter } from "@/components/ui";
import { currentManualPayment } from "@/lib/billing/momo";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { cardCheckoutConfigured, cardPricedPlans, invoicePayMethods } from "@/lib/billing/card-ready";
import { methodState } from "@/lib/billing/pay-methods";
import { momoConfigured, momoPriceOf } from "@/lib/billing/momo-shared";
import { getPlan, subscriberPriceCents, toPublic } from "@/lib/plan-catalog";
import { companyPlans, type RegionalPlan } from "@/lib/region-prices";
import { currencyNote } from "@/lib/region-format";
import { clientInvoices, openInvoiceOf, payableView } from "@/lib/invoices/service";
import { clientOffer, selfServeAddition, staleAdditionNotice } from "@/lib/offers/service";
import { cardQuoteOf, offerCardReady } from "@/lib/offers/card";
import { getSettings } from "@/lib/admin/settings";
import { renewalState } from "@/lib/billing/renewal";
import { AddFeatures } from "@/components/billing/add-features";
import type { Renewal } from "@/components/billing/plan-actions";
import { OfferCard } from "@/components/billing/offer-card";
import { OfferActions } from "@/components/billing/offer-actions";
import { site } from "@/lib/content/site";
import { getInvoices } from "./actions";

export const metadata = { title: "Billing" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await pageGate("billing");
  if (blocked) return blocked;
  const [{ usage, isTrial, trialDaysLeft, business, chosenPlan }, query] = await Promise.all([getAppContext(), searchParams]);
  const { subscription, plan, used, limits, resetsAt } = usage;

  const status = subscription.status;
  const pastDue = status === "PAST_DUE";
  // Mobile Money plans have no provider subscription id: the paid period alone says they are paid (docs/MOMO.md).
  const momoPlan = subscription.provider === "MANUAL_MOMO";
  const paid = !isTrial && (!!subscription.providerSubscriptionId || momoPlan) && (status === "ACTIVE" || pastDue);
  const periodEnd = formatDate(subscription.currentPeriodEnd);
  const trialEnd = formatDate(subscription.trialEndsAt);
  const cancelling = paid && subscription.cancelAtPeriodEnd;
  // The plans and prices of the company's region (never the visitor's IP), plus the plan the client chose at sign-up.
  const [{ region, plans: regional }, currentPlan, chosen, momoSettings, momoPayment, offer] = await Promise.all([
    companyPlans(business.id),
    getPlan(subscription.plan),
    chosenPlan ? getPlan(chosenPlan) : Promise.resolve(null),
    getMomoSettings(),
    currentManualPayment(subscription.userId),
    // A custom plan offer from the BuPulse team (docs/OFFERS.md); a failed lookup never breaks Billing.
    clientOffer(business.id).catch(() => null),
  ]);
  // Retired and hidden plans stay listed for the clients already on them, so "Your current plan" is still shown.
  const pickable: RegionalPlan[] = [
    ...regional,
    ...(currentPlan && !currentPlan.isTrial && !regional.some((p) => p.key === currentPlan.key) ? [{ ...toPublic(currentPlan), regionKey: region.key, paymentMethods: region.paymentMethods, card: null }] : []),
  ];
  // Can card checkout open, and for which plans (a region's card prices must be in Paddle: docs/BILLING.md)?
  const [cardOn, cardPriced] = await Promise.all([cardCheckoutConfigured(), cardPricedPlans(region.key, pickable.map((p) => p.key))]);
  const momoReady = momoConfigured(momoSettings);
  // A Mobile Money plan is paid at its regional price; a card plan at the Paddle price the client is on.
  const momoPrice = momoPlan ? momoPriceOf(pickable.find((p) => p.key === subscription.plan) ?? { monthlyPriceCents: 0, yearlyPriceCents: 0, currency: "RWF", paymentMethods: [] }, subscription.interval) : null;
  const price =
    paid && currentPlan && !currentPlan.isTrial
      ? momoPlan
        ? `${momoPrice ? formatPrice(momoPrice.amountMinor, momoPrice.currency) : "Paid"} per ${intervalWord(subscription.interval)}, by Mobile Money`
        : `${formatUsd(subscriberPriceCents(currentPlan, subscription.providerPriceId, subscription.interval) / 100)} per ${intervalWord(subscription.interval)}`
      : null;

  const invoices = paid || subscription.providerCustomerId ? await getInvoices() : [];
  // BuPulse's own invoices (docs/INVOICES.md): the open one with its Pay buttons, unless its Mobile Money payment is
  // already open (then the pay screen above is that payment), and the list with PDFs.
  const [bpInvoices, openInvoice] = await Promise.all([clientInvoices(business.id), openInvoiceOf(business.id)]);
  const payingInvoice = Boolean(openInvoice && momoPayment?.status === "pending" && momoPayment.invoiceId === openInvoice.id);
  const payable = openInvoice && !payingInvoice ? await payableView(openInvoice) : null;
  // A custom plan cannot be bought by card through checkout (docs/OFFERS.md, "Card"): its invoice is paid by Mobile Money.
  const payableCustom = payable?.planKey ? (await getPlan(payable.planKey))?.isCustom === true : false;
  const invoiceMethods = payable ? await invoicePayMethods({ region, planKey: payable.planKey, interval: payable.interval, custom: payableCustom, momoConfigured: momoReady }) : null;
  // Renewing (docs/BILLING.md, "Renewing"): a card plan that renews by itself is never renewed by hand; anything else
  // only in the last 7 days of its period, by Mobile Money or card, the new period starting when this one ends.
  const now = new Date();
  const renewal = paid ? renewalState(subscription, now) : null;
  const regionHas = (m: "momo" | "card") => region.paymentMethods.includes(m);
  const renewsCustom = currentPlan?.isCustom === true;
  const currentPick = pickable.find((p) => p.key === subscription.plan);
  const renew: Renewal | undefined =
    renewal?.kind === "open" && currentPlan && !currentPlan.isTrial && !momoPayment && (momoPlan || cancelling)
      ? {
          plan: currentPlan.key,
          interval: subscription.interval,
          momo: methodState(regionHas("momo"), momoReady && currentPick !== undefined && momoPriceOf(currentPick, subscription.interval) !== null),
          card: methodState(regionHas("card"), cardOn && (cancelling || Boolean(cardPriced[currentPlan.key]?.[subscription.interval]))),
          cardVia: cancelling ? "resume" : "checkout",
          cardReason: renewsCustom && !cancelling ? `Card for a custom plan is set up by our team: ask us for a card link at ${site.email}.` : null,
        }
      : undefined;
  // "Add features" to the running plan (docs/OFFERS.md): a Mobile Money plan, with no payment or team offer in progress.
  const addition = paid && !pastDue && momoPayment?.status !== "pending" && (!offer || offer.addition?.selfServe) ? await selfServeAddition(business.id, now).catch(() => null) : null;
  // Card for an offer or added features: the price converted like an RWF plan's card price (lib/offers/card.ts); not
  // shown at all when card payments are not set up or switched off.
  const cardForOffers = await offerCardReady(region.paymentMethods).catch(() => false);
  const cardRate = cardForOffers ? await getSettings().then((st) => ({ usdToRwf: st.usdToRwf, marginPercent: st.cardMarginPercent })) : null;
  const offerCard = offer && cardForOffers ? await cardQuoteOf(offer.totalMinor, offer.currency).then((q) => ({ usdCents: q.usdCents, quoteMinor: q.quoteMinor, currency: q.quoteCurrency })).catch(() => null) : null;
  const staleAddition = offer ? null : await staleAdditionNotice(business.id, now).catch(() => null);
  const highlighted = typeof query.invoice === "string" ? query.invoice : null;
  const checkoutSuccess = query.checkout === "success";
  // Wait for this purchase specifically: the plan is active and was updated after checkout began.
  const since = Number(query.since);
  const activated =
    !isTrial && status === "ACTIVE" && (!Number.isFinite(since) || subscription.updatedAt.getTime() >= since);
  const waitingForCheckout = checkoutSuccess && !activated;

  const meters = [
    { label: "Text generations", used: used.text, max: limits.text },
    { label: "Brand designs", used: used.image, max: limits.image },
    { label: "Videos (up to 30 s each)", used: used.videos, max: limits.videos },
    { label: "Voice characters", used: used.voiceCharacters, max: limits.voiceCharacters },
  ].filter((m) => m.max > 0);

  return (
    <>
      <CheckoutScript />
      <PageHeader title="Billing" description="Your plan, your usage and your receipts." />

      {checkoutSuccess && <CheckoutReturn waiting={waitingForCheckout} since={since} />}

      {pastDue && (
        <GlassCard role="alert" className="flex items-start gap-3 border border-danger/40 p-5">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="flex flex-col gap-1">
            <strong>{momoPlan ? "Your plan has ended" : "Your last payment didn't go through"}</strong>
            <p className="text-sm text-muted">
              {momoPlan
                ? "Pay by Mobile Money to keep creating. Everything you have made is saved; new content is paused until the payment is confirmed."
                : "Update your payment method to keep creating. Everything you have made is saved; new content is paused until the payment goes through."}
            </p>
          </div>
        </GlassCard>
      )}

      {staleAddition && (
        <GlassCard role="status" className="flex items-start gap-3 border border-line p-5">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
          <p className="text-sm">{staleAddition}</p>
        </GlassCard>
      )}

      {offer && (
        <OfferCard
          offer={offer}
          actions={
            offer.status === "sent" || (offer.status === "accepted" && !(momoPayment?.status === "pending" && momoPayment.submitted)) ? (
              <OfferActions offerId={offer.id} momo={methodState(region.paymentMethods.includes("momo"), momoReady)} card={offerCard} accepted={offer.status === "accepted"} method={offer.payMethod} addition={Boolean(offer.addition)} />
            ) : undefined
          }
        />
      )}

      {payable && invoiceMethods && <InvoicePay invoice={payable} methods={invoiceMethods} highlight={highlighted === payable.number} cardReason={payableCustom || !payable.planKey ? `Card for this invoice is set up by our team: ask us for a card link at ${site.email}.` : null} />}

      {momoPayment && <MomoPayment payment={momoPayment} details={momoSettings} />}

      <GlassCard as="section" aria-labelledby="current-plan" className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span id="current-plan" className="text-[13px] text-muted">
              Current plan
            </span>
            <strong className="text-2xl tracking-[-0.02em]">
              {isTrial && chosen ? `${plan.name} of ${chosen.name}` : plan.name}
              {paid && <span className="text-base font-medium text-muted"> · {subscription.interval === "YEAR" ? "Yearly" : "Monthly"}</span>}
            </strong>
            {price && <span className="text-sm text-muted">{price}</span>}
            {isTrial && trialEnd && (
              <span className="text-sm text-muted">
                {trialDaysLeft === 0 ? `Trial ended ${trialEnd}` : `Trial ends ${trialEnd}`}
                {trialDaysLeft ? ` (${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left)` : ""}
              </span>
            )}
            {paid && periodEnd && !cancelling && !pastDue && renewal?.kind === "auto" && <span className="text-sm text-muted">Renews automatically on {periodEnd}</span>}
            {paid && !cancelling && !pastDue && renewal?.kind === "paid" && (
              <span className="text-sm text-muted">
                Your plan is paid until {formatDate(renewal.until)}. You can renew from {formatDate(renewal.opensAt)}, 7 days before it ends.
              </span>
            )}
            {paid && periodEnd && !cancelling && !pastDue && renewal?.kind === "open" && (
              <span className="text-sm font-medium">
                Your plan is paid until {periodEnd} ({renewal.daysLeft} {renewal.daysLeft === 1 ? "day" : "days"} left). Renew now; the new period starts when this one ends.
              </span>
            )}
            {cancelling && periodEnd && <span className="text-sm font-medium text-danger">Cancels on {periodEnd}. Your plan stays active until then.{renewal?.kind === "paid" ? ` You can renew it from ${formatDate(renewal.opensAt)}.` : ""}</span>}
          </div>
          <Badge tone={status === "ACTIVE" || status === "TRIALING" ? (cancelling ? "neutral" : "success") : "danger"}>
            {statusLabel(status, cancelling)}
          </Badge>
        </div>

        {paid && (
          <PlanActions
            cancelAtPeriodEnd={cancelling}
            pastDue={pastDue}
            periodEnd={periodEnd}
            method={momoPlan ? "momo" : "card"}
            renew={renew}
            canResume={renewal?.kind !== "paid"}
          />
        )}

        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Usage</h2>
            {resetsAt && (
              <span className="text-sm text-muted">{isTrial ? "Trial ends" : "Resets"} {formatDate(resetsAt)}</span>
            )}
          </div>
          {meters.map((m) => (
            <Meter key={m.label} value={m.used} max={m.max} label={m.label} showValue />
          ))}
        </div>
      </GlassCard>

      {/* Hidden while a purchase is being confirmed, so nobody buys a second plan by accident. */}
      {!waitingForCheckout && momoPayment?.status !== "pending" && (
        <>
          <PlanPicker plans={pickable} current={{ plan: subscription.plan, interval: subscription.interval, paid, pastDue, method: paid ? (momoPlan ? "momo" : "card") : null }} pay={{ regionMethods: region.paymentMethods, momoConfigured: momoReady, cardConfigured: cardOn, cardPriced, cardBlocked: momoPlan && renewal?.kind === "paid" ? `By card from ${formatDate(renewal.opensAt)}, 7 days before your plan ends.` : null }} />
          <p className="px-1 text-sm text-muted">
            Prices for {region.name}. {currencyNote(region.currency, region.paymentMethods)}
          </p>
        </>
      )}

      {addition && (addition.ok || addition.card) && (
        <AddFeatures
          data={addition.ok ? { current: { ...addition.current, features: [...addition.current.features] }, interval: addition.interval, periodEnd: addition.periodEnd, region: addition.region, prices: addition.prices, addable: addition.addable } : null}
          unavailable={addition.ok ? null : addition.reason}
          momo={addition.ok ? methodState(regionHas("momo"), momoReady) : regionHas("momo") ? "soon" : "off"}
          cardRate={cardForOffers && addition.ok ? cardRate : null}
          now={now.toISOString()}
        />
      )}

      {bpInvoices.length > 0 && <ClientInvoices invoices={bpInvoices} />}

      {(paid || invoices.length > 0) && !momoPlan && <InvoiceList invoices={invoices} />}

      <GlassCard as="aside" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <strong>Need something different?</strong>
          <p className="text-sm text-muted">{paid ? "Tell us what to change and we send you an offer: you pay only for what you add, for the days left in your period." : "Tell us what your business needs and we put together a custom plan with only what you use."}</p>
        </div>
        <Link href="/custom-plan?from=billing" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold no-underline">
          {paid ? "Request a custom change" : "Request a custom plan"}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </GlassCard>

      <GlassCard as="aside" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <strong>Need done-for-you marketing?</strong>
          <p className="text-sm text-muted">Our team can run your social content and lead capture for you.</p>
        </div>
        <Link href="/done-for-you" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold no-underline">
          See done-for-you
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </GlassCard>
    </>
  );
}
