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
import { momoConfigured, momoPriceOf } from "@/lib/billing/momo-shared";
import { getPlan, subscriberPriceCents, toPublic } from "@/lib/plan-catalog";
import { companyPlans, type RegionalPlan } from "@/lib/region-prices";
import { currencyNote } from "@/lib/region-format";
import { clientInvoices, openInvoiceOf, payableView } from "@/lib/invoices/service";
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
  const [{ region, plans: regional }, currentPlan, chosen, momoSettings, momoPayment] = await Promise.all([
    companyPlans(business.id),
    getPlan(subscription.plan),
    chosenPlan ? getPlan(chosenPlan) : Promise.resolve(null),
    getMomoSettings(),
    currentManualPayment(subscription.userId),
  ]);
  // Mobile Money is offered where the company's region takes it and the owner has said where to pay (docs/MOMO.md).
  const momoOn = momoConfigured(momoSettings) && region.paymentMethods.includes("momo");
  // Retired and hidden plans stay listed for the clients already on them, so "Your current plan" is still shown.
  const pickable: RegionalPlan[] = [
    ...regional,
    ...(currentPlan && !currentPlan.isTrial && !regional.some((p) => p.key === currentPlan.key) ? [{ ...toPublic(currentPlan), regionKey: region.key, paymentMethods: region.paymentMethods, card: null }] : []),
  ];
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
    { label: "Video seconds", used: used.videoSeconds, max: limits.videoSeconds },
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

      {payable && <InvoicePay invoice={payable} momo={momoOn} card={region.paymentMethods.includes("card")} highlight={highlighted === payable.number} />}

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
            {paid && periodEnd && !cancelling && !pastDue && <span className="text-sm text-muted">{momoPlan ? `Paid until ${periodEnd}` : `Renews ${periodEnd}`}</span>}
            {cancelling && periodEnd && <span className="text-sm font-medium text-danger">Cancels on {periodEnd}. Your plan stays active until then.</span>}
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
            renew={momoPlan && !momoPayment && currentPlan && !currentPlan.isTrial ? { plan: currentPlan.key, interval: subscription.interval } : undefined}
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
          <PlanPicker plans={pickable} current={{ plan: subscription.plan, interval: subscription.interval, paid, pastDue, method: paid ? (momoPlan ? "momo" : "card") : null }} momo={momoOn} />
          <p className="px-1 text-sm text-muted">
            Prices for {region.name}. {currencyNote(region.currency, region.paymentMethods)}
          </p>
        </>
      )}

      {bpInvoices.length > 0 && <ClientInvoices invoices={bpInvoices} />}

      {(paid || invoices.length > 0) && !momoPlan && <InvoiceList invoices={invoices} />}

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
