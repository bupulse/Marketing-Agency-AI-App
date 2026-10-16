import Link from "next/link";
import { cookies } from "next/headers";
import { CHECKOUT_PENDING_COOKIE, checkoutPendingSince } from "@/lib/billing/checkout-pending";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { CheckoutScript } from "@/components/billing/checkout";
import { CheckoutReturn } from "@/components/billing/checkout-return";
import { cardChangeNote, formatDate, formatPrice, intervalWord, formatUsd, statusLabel } from "@/components/billing/helpers";
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
import { momoConfigured, momoPriceOf, offerCheckingReference } from "@/lib/billing/momo-shared";
import { getPlan, subscriberPriceCents, toPublic } from "@/lib/plan-catalog";
import { companyPlans, type RegionalPlan } from "@/lib/region-prices";
import { currencyNote } from "@/lib/region-format";
import { clientInvoices, openInvoiceOf, payableView } from "@/lib/invoices/service";
import { clientOffer, selfServeAddition, staleAdditionNotice } from "@/lib/offers/service";
import { currentPlanCall } from "@/lib/demo/plan-calls";
import { formatSlot } from "@/lib/demo/slots";
import { cardQuoteOf, offerCardReady } from "@/lib/offers/card";
import { CARD_PLAN_UNAVAILABLE, cardPlanAdditionsReady, cardRate as cardPlanRate } from "@/lib/offers/card-plan";
import { cardPlanAddons, pendingCardAddition } from "@/lib/offers/card-plan-items";
import { getSettings } from "@/lib/admin/settings";
import { renewalState } from "@/lib/billing/renewal";
import { AddFeatures } from "@/components/billing/add-features";
import type { Renewal } from "@/components/billing/plan-actions";
import { OfferCard } from "@/components/billing/offer-card";
import { OfferActions } from "@/components/billing/offer-actions";
import { site } from "@/lib/content/site";
import type { FeatureKey } from "@/lib/features";
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
  const [{ region, plans: regional }, currentPlan, chosen, momoSettings, momoPayment, offer, planCall] = await Promise.all([
    companyPlans(business.id),
    getPlan(subscription.plan),
    chosenPlan ? getPlan(chosenPlan) : Promise.resolve(null),
    getMomoSettings(),
    currentManualPayment(subscription.userId),
    // A custom plan offer from the BuPulse team (docs/OFFERS.md); a failed lookup never breaks Billing.
    clientOffer(business.id).catch(() => null),
    // The short call booked after a custom plan request (lib/demo/plan-calls.ts), if one is coming up.
    currentPlanCall(business.id).catch(() => null),
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
  // A card plan with features added on Billing is a custom plan on the card subscription (lib/offers/card-plan-items.ts):
  // its card price is the plan's own plus the added features'.
  const planAddons = paid && !momoPlan && currentPlan?.isCustom ? await cardPlanAddons(business.id, subscription.plan).catch(() => null) : null;
  const basePlan = planAddons ? await getPlan(planAddons.cardPlan.basePlanKey) : null;
  const cardPlanUsdCents = paid && !momoPlan && currentPlan && !currentPlan.isTrial ? subscriberPriceCents(basePlan ?? currentPlan, subscription.providerPriceId, subscription.interval) + (planAddons?.usdCents ?? 0) : null;
  const price =
    paid && currentPlan && !currentPlan.isTrial
      ? momoPlan
        ? `${momoPrice ? formatPrice(momoPrice.amountMinor, momoPrice.currency) : "Paid"} per ${intervalWord(subscription.interval)}, by Mobile Money`
        : `${formatUsd((cardPlanUsdCents ?? 0) / 100)} per ${intervalWord(subscription.interval)}${planAddons ? `: ${basePlan?.name ?? "your plan"} plus ${planAddons.labels.join(", ")}` : ""}`
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
          cardReason: renewsCustom && !cancelling ? `Renewing a custom plan by card is not available here yet: renew it by Mobile Money, or write to us at ${site.email} and we will help.` : null,
        }
      : undefined;
  // A card plan changes plan by card only (changePlan goes through the card provider): say so, and how to move to Mobile
  // Money, under the plan cards. It used to read "Mobile Money coming soon" (below, in Add features) on a method that works.
  const cardNote = paid && !momoPlan && !pastDue && renewal ? cardChangeNote(renewal, regionHas("momo") && momoReady) : null;
  // "Add features" to the running plan (docs/OFFERS.md), with no payment or team offer in progress: a Mobile Money plan,
  // or a card plan (its card subscription takes them; past due or set to end, it says why nothing can be added).
  const addition = paid && (!pastDue || !momoPlan) && momoPayment?.status !== "pending" && (!offer || offer.addition?.selfServe) ? await selfServeAddition(business.id, now).catch(() => null) : null;
  const onCardPlan = addition?.ok === true && addition.method === "card";
  const cardPlanTerms = onCardPlan && cardPlanUsdCents !== null && (await cardPlanAdditionsReady()) ? { ...(await cardPlanRate()), planUsdCents: cardPlanUsdCents } : null;
  // Features being added to the card plan while the card provider confirms (Billing says so; nothing else to pay).
  const cardPending = paid && !momoPlan ? await pendingCardAddition(business.id).catch(() => null) : null;
  // Card for an offer or added features: the price converted like an RWF plan's card price (lib/offers/card.ts); not
  // shown at all when card payments are not set up or switched off.
  const cardForOffers = await offerCardReady(region.paymentMethods).catch(() => false);
  const cardRate = cardForOffers ? await getSettings().then((st) => ({ usdToRwf: st.usdToRwf, marginPercent: st.cardMarginPercent })) : null;
  const offerCard = offer && cardForOffers ? await cardQuoteOf(offer.totalMinor, offer.currency).then((q) => ({ usdCents: q.usdCents, quoteMinor: q.quoteMinor, currency: q.quoteCurrency })).catch(() => null) : null;
  const staleAddition = offer ? null : await staleAdditionNotice(business.id, now).catch(() => null);
  const highlighted = typeof query.invoice === "string" ? query.invoice : null;
  const checkoutSuccess = query.checkout === "success";
  // A card payment completed in this browser a moment ago (lib/billing/checkout-pending.ts): still waiting for its
  // webhook after a reload or from another page, so the plans stay hidden and nobody pays twice.
  const pendingCookie = checkoutSuccess ? null : checkoutPendingSince((await cookies()).get(CHECKOUT_PENDING_COOKIE)?.value, now.getTime());
  // Wait for this purchase specifically: the plan is active and was updated after checkout began.
  const since = checkoutSuccess ? Number(query.since) : (pendingCookie ?? Number.NaN);
  const activated =
    !isTrial && status === "ACTIVE" && (!Number.isFinite(since) || subscription.updatedAt.getTime() >= since);
  const waitingForCheckout = (checkoutSuccess || pendingCookie !== null) && !activated;

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

      {(checkoutSuccess || waitingForCheckout) && <CheckoutReturn waiting={waitingForCheckout} since={since} />}

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
          checkingReference={offerCheckingReference(momoPayment, offer)}
          actions={
            offer.status === "sent" || (offer.status === "accepted" && !(momoPayment?.status === "pending" && momoPayment.submitted)) ? (
              <OfferActions offerId={offer.id} momo={methodState(region.paymentMethods.includes("momo"), momoReady)} card={offerCard} accepted={offer.status === "accepted"} method={offer.payMethod} addition={Boolean(offer.addition)} />
            ) : undefined
          }
        />
      )}

      {payable && invoiceMethods && <InvoicePay invoice={payable} methods={invoiceMethods} highlight={highlighted === payable.number} cardReason={payableCustom || !payable.planKey ? `Card is not available for this invoice yet: pay it by Mobile Money, or write to us at ${site.email} and we will help.` : null} />}

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
          <PlanPicker plans={pickable} current={{ plan: subscription.plan, interval: subscription.interval, paid, pastDue, method: paid ? (momoPlan ? "momo" : "card") : null }} pay={{ regionMethods: region.paymentMethods, momoConfigured: momoReady, cardConfigured: cardOn, cardPriced, cardBlocked: momoPlan && renewal?.kind === "paid" ? `By card from ${formatDate(renewal.opensAt)}, 7 days before your plan ends.` : null, cardNote, cardAddons: planAddons?.labels ?? null }} />
          <p className="px-1 text-sm text-muted">
            Prices for {region.name}. {currencyNote(region.currency, region.paymentMethods)}
          </p>
        </>
      )}

      {cardPending && (
        <GlassCard role="status" className="flex items-start gap-3 border border-line p-5">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
          <p className="text-sm">{cardPending.removal ? `Removing ${cardPending.labels.join(", ")} from your card plan: waiting for the card provider to confirm. This takes a moment; reload Billing to see it off.` : `Adding ${cardPending.labels.join(", ")} to your card plan: waiting for the card payment to be confirmed. This takes a moment; reload Billing to see them on.`}</p>
        </GlassCard>
      )}

      {addition && (addition.ok || addition.card) && !cardPending && (
        <AddFeatures
          data={addition.ok && (!onCardPlan || cardPlanTerms) ? { current: { ...addition.current, features: [...addition.current.features] }, interval: addition.interval, periodEnd: addition.periodEnd, region: addition.region, prices: addition.prices, addable: addition.addable, soon: addition.soon, method: addition.method } : null}
          unavailable={addition.ok ? (onCardPlan && !cardPlanTerms ? CARD_PLAN_UNAVAILABLE : null) : addition.reason}
          momo={methodState(regionHas("momo"), momoReady)}
          cardRate={cardForOffers && addition.ok && !onCardPlan ? cardRate : null}
          cardPlan={cardPlanTerms}
          cardAddons={onCardPlan ? (planAddons?.features ?? []) : []}
          preselect={addition.ok && typeof query.add === "string" && (addition.addable as string[]).includes(query.add) ? (query.add as FeatureKey) : null}
          now={now.toISOString()}
        />
      )}

      {bpInvoices.length > 0 && <ClientInvoices invoices={bpInvoices} />}

      {(paid || invoices.length > 0) && !momoPlan && <InvoiceList invoices={invoices} />}

      <GlassCard as="aside" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <strong>Need something different?</strong>
          <p className="text-sm text-muted">{paid ? "Tell us what to change and we send you an offer: you pay only for what you add, for the days left in your period." : "Tell us what your business needs and we put together a custom plan with only what you use."}</p>
          {planCall && (
            <p className="mt-1 text-sm">
              Your call about it is on {formatSlot(planCall.startsAt)} (Kigali).{" "}
              <Link href="/custom-plan/call" className="font-semibold underline">
                See or move your call
              </Link>
            </p>
          )}
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
