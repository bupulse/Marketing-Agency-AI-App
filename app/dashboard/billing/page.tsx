import { cookies } from "next/headers";
import { CHECKOUT_PENDING_COOKIE, checkoutPendingSince } from "@/lib/billing/checkout-pending";
import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { BILLING_TABS, BillingView, type BillingPlanLine, type BillingTab } from "@/components/billing/billing-view";
import { CheckoutScript } from "@/components/billing/checkout";
import { CheckoutReturn } from "@/components/billing/checkout-return";
import { cardChangeNote, formatDate, formatPrice, intervalWord, formatUsd, statusLabel } from "@/components/billing/helpers";
import { ClientInvoices } from "@/components/billing/client-invoices";
import { InvoiceList } from "@/components/billing/invoice-list";
import { InvoicePay } from "@/components/billing/invoice-pay";
import { MomoPayment } from "@/components/billing/momo-payment";
import { PlanActions } from "@/components/billing/plan-actions";
import { PlanPicker } from "@/components/billing/plan-picker";
import { currentManualPayment } from "@/lib/billing/momo";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { cardCheckoutConfigured, cardPricedPlans, invoicePayMethods } from "@/lib/billing/card-ready";
import { methodState } from "@/lib/billing/pay-methods";
import { momoConfigured, momoPriceOf, offerCheckingReference } from "@/lib/billing/momo-shared";
import { getPlan, subscriberPriceCents, toPublic } from "@/lib/plan-catalog";
import { companyPlans, vatFor, withVat, type RegionalPlan } from "@/lib/region-prices";
import { vatPercentOf } from "@/lib/billing/vat";
import { getVatSettings } from "@/lib/billing/vat-server";
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
  const [{ usage, isTrial, trialDaysLeft, business, chosenPlan, entitlements }, query] = await Promise.all([getAppContext(), searchParams]);
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
  // Prices are what the client pays: with the region's VAT (Rwanda 18%, lib/billing/vat.ts); card (USD) prices as they are.
  const [{ region, plans: regional }, currentPlan, chosen, momoSettings, momoPayment, offer, planCall, vat] = await Promise.all([
    companyPlans(business.id, { withVat: true }),
    getPlan(subscription.plan),
    chosenPlan ? getPlan(chosenPlan) : Promise.resolve(null),
    getMomoSettings(),
    currentManualPayment(subscription.userId),
    // A custom plan offer from the BuPulse team (docs/OFFERS.md); a failed lookup never breaks Billing.
    clientOffer(business.id).catch(() => null),
    // The short call booked after a custom plan request (lib/demo/plan-calls.ts), if one is coming up.
    currentPlanCall(business.id).catch(() => null),
    getVatSettings(),
  ]);
  // Retired and hidden plans stay listed for the clients already on them, so "Your current plan" is still shown.
  const pickable: RegionalPlan[] = withVat([
    ...regional,
    // A custom or retired plan: its own prices (before VAT) with the region's VAT when they are in the region's currency.
    ...(currentPlan && !currentPlan.isTrial && !regional.some((p) => p.key === currentPlan.key) ? [{ ...toPublic(currentPlan), regionKey: region.key, paymentMethods: region.paymentMethods, card: null, vat: currentPlan.currency.toUpperCase() === region.currency.toUpperCase() ? vatFor(region, currentPlan.monthlyPriceCents, currentPlan.yearlyPriceCents) : null, vatRatePercent: null }] : []),
  ]);
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
        ? `${momoPrice ? `${formatPrice(momoPrice.amountMinor, momoPrice.currency)}${momoPrice.vatRateBps ? " (VAT included)" : ""}` : "Paid"} per ${intervalWord(subscription.interval)}, by Mobile Money`
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
  // The card quote is from the offer's price before VAT: Paddle adds tax itself.
  const offerCard = offer && cardForOffers ? await cardQuoteOf(offer.netTotalMinor, offer.currency).then((q) => ({ usdCents: q.usdCents, quoteMinor: q.quoteMinor, currency: q.quoteCurrency })).catch(() => null) : null;
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
    { label: "AI image credits", used: used.image, max: limits.image },
    { label: "Videos (up to 30 s each)", used: used.videos, max: limits.videos },
    { label: "Voice characters", used: used.voiceCharacters, max: limits.voiceCharacters },
    // Video Studio credits: only for plans with the studio (it is coming soon, so none yet).
    ...(entitlements.inPlan.has("videoStudio") ? [{ label: "Video Studio credits", used: used.videoCredits, max: limits.videoCredits }] : []),
  ].filter((m) => m.max > 0);


  // The plan card's lines, in the order the old card showed them (trial end, renewal, cancelling).
  const lines: BillingPlanLine[] = [];
  if (isTrial && trialEnd) lines.push({ text: `${trialDaysLeft === 0 ? `Trial ended ${trialEnd}` : `Trial ends ${trialEnd}`}${trialDaysLeft ? ` (${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left)` : ""}` });
  if (paid && periodEnd && !cancelling && !pastDue && renewal?.kind === "auto") lines.push({ text: `Renews automatically on ${periodEnd}` });
  if (paid && !cancelling && !pastDue && renewal?.kind === "paid") lines.push({ text: `Your plan is paid until ${formatDate(renewal.until)}. You can renew from ${formatDate(renewal.opensAt)}, 7 days before it ends.` });
  if (paid && periodEnd && !cancelling && !pastDue && renewal?.kind === "open") lines.push({ text: `Your plan is paid until ${periodEnd} (${renewal.daysLeft} ${renewal.daysLeft === 1 ? "day" : "days"} left). Renew now; the new period starts when this one ends.`, tone: "strong" });
  if (cancelling && periodEnd) lines.push({ text: `Cancels on ${periodEnd}. Your plan stays active until then.${renewal?.kind === "paid" ? ` You can renew it from ${formatDate(renewal.opensAt)}.` : ""}`, tone: "danger" });

  const plansHidden = waitingForCheckout || momoPayment?.status === "pending";
  const receiptsCount = bpInvoices.length + ((paid || invoices.length > 0) && !momoPlan ? invoices.length : 0);
  const showReceipts = bpInvoices.length > 0 || ((paid || invoices.length > 0) && !momoPlan);
  const addable = addition && (addition.ok || addition.card) && !cardPending;
  // ?add=<feature> (from "Add to your plan") opens the Add features tab with it ticked.
  const tab: BillingTab = typeof query.add === "string" && addable ? "add" : ((BILLING_TABS as readonly string[]).includes(String(query.show)) ? (query.show as BillingTab) : "plans");

  return (
    <>
      <CheckoutScript />
      <BillingView
        params={query}
        tab={tab}
        alerts={{
          pastDue: pastDue ? { momo: momoPlan } : null,
          stale: staleAddition,
          cardPending: cardPending
            ? cardPending.removal
              ? `Removing ${cardPending.labels.join(", ")} from your card plan: waiting for the card provider to confirm. This takes a moment; reload Billing to see it off.`
              : `Adding ${cardPending.labels.join(", ")} to your card plan: waiting for the card payment to be confirmed. This takes a moment; reload Billing to see them on.`
            : null,
        }}
        top={
          <>
            {(checkoutSuccess || waitingForCheckout) && <CheckoutReturn waiting={waitingForCheckout} since={since} />}
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
            {momoPayment && <MomoPayment payment={momoPayment} details={momoSettings} vatRatePercent={vatPercentOf(momoPayment.vatRateBps)} />}
          </>
        }
        plan={{
          name: isTrial && chosen ? `${plan.name} of ${chosen.name}` : plan.name,
          interval: paid ? (subscription.interval === "YEAR" ? "Yearly" : "Monthly") : null,
          price,
          lines,
          status: { label: statusLabel(status, cancelling), tone: status === "ACTIVE" || status === "TRIALING" ? (cancelling ? "muted" : "good") : "bad" },
        }}
        planActions={
          paid ? <PlanActions cancelAtPeriodEnd={cancelling} pastDue={pastDue} periodEnd={periodEnd} method={momoPlan ? "momo" : "card"} renew={renew} canResume={renewal?.kind !== "paid"} /> : null
        }
        usage={{ resets: resetsAt ? `${isTrial ? "Trial ends" : "Resets"} ${formatDate(resetsAt)}` : null, meters }}
        /* Hidden while a purchase is being confirmed, so nobody buys a second plan by accident. */
        plans={
          plansHidden ? null : (
            <>
              <PlanPicker plans={pickable} current={{ plan: subscription.plan, interval: subscription.interval, paid, pastDue, method: paid ? (momoPlan ? "momo" : "card") : null }} pay={{ regionMethods: region.paymentMethods, momoConfigured: momoReady, cardConfigured: cardOn, cardPriced, cardBlocked: momoPlan && renewal?.kind === "paid" ? `By card from ${formatDate(renewal.opensAt)}, 7 days before your plan ends.` : null, cardNote, cardAddons: planAddons?.labels ?? null }} />
              <p className="px-1 text-sm text-muted">
                Prices for {region.name}. {currencyNote(region.currency, region.paymentMethods)}
              </p>
            </>
          )
        }
        add={
          addable ? (
            <AddFeatures
              data={addition.ok && (!onCardPlan || cardPlanTerms) ? { current: { ...addition.current, features: [...addition.current.features] }, interval: addition.interval, periodEnd: addition.periodEnd, region: addition.region, prices: addition.prices, addable: addition.addable, soon: addition.soon, method: addition.method } : null}
              unavailable={addition.ok ? (onCardPlan && !cardPlanTerms ? CARD_PLAN_UNAVAILABLE : null) : addition.reason}
              momo={methodState(regionHas("momo"), momoReady)}
              cardRate={cardForOffers && addition.ok && !onCardPlan ? cardRate : null}
              cardPlan={cardPlanTerms}
              cardAddons={onCardPlan ? (planAddons?.features ?? []) : []}
              preselect={addition.ok && typeof query.add === "string" && (addition.addable as string[]).includes(query.add) ? (query.add as FeatureKey) : null}
              now={now.toISOString()}
              vat={vat}
            />
          ) : null
        }
        receipts={
          showReceipts ? (
            <>
              {bpInvoices.length > 0 && <ClientInvoices invoices={bpInvoices} />}
              {(paid || invoices.length > 0) && !momoPlan && <InvoiceList invoices={invoices} />}
            </>
          ) : null
        }
        receiptsCount={receiptsCount}
        custom={{ paid, call: planCall ? `Your call about it is on ${formatSlot(planCall.startsAt)} (Kigali).` : null }}
      />
    </>
  );
}
