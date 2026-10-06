import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { CheckoutScript } from "@/components/billing/checkout";
import { CheckoutReturn } from "@/components/billing/checkout-return";
import { formatDate, intervalWord, priceFor, formatUsd, statusLabel } from "@/components/billing/helpers";
import { InvoiceList } from "@/components/billing/invoice-list";
import { PlanActions } from "@/components/billing/plan-actions";
import { PlanPicker } from "@/components/billing/plan-picker";
import { Badge, GlassCard, Meter } from "@/components/ui";
import { isPaidPlan } from "@/lib/billing/catalog";
import { getInvoices } from "./actions";

export const metadata = { title: "Billing" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ usage, isTrial, trialDaysLeft }, query] = await Promise.all([getAppContext(), searchParams]);
  const { subscription, plan, used, limits, resetsAt } = usage;

  const status = subscription.status;
  const pastDue = status === "PAST_DUE";
  const paid = !isTrial && !!subscription.providerSubscriptionId && (status === "ACTIVE" || pastDue);
  const periodEnd = formatDate(subscription.currentPeriodEnd);
  const trialEnd = formatDate(subscription.trialEndsAt);
  const cancelling = paid && subscription.cancelAtPeriodEnd;
  const price =
    paid && isPaidPlan(subscription.plan) ? `${formatUsd(priceFor(subscription.plan, subscription.interval))} per ${intervalWord(subscription.interval)}` : null;

  const invoices = paid || subscription.providerCustomerId ? await getInvoices() : [];
  const checkoutSuccess = query.checkout === "success";

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

      {checkoutSuccess && <CheckoutReturn stillTrial={isTrial} />}

      {pastDue && (
        <GlassCard role="alert" className="flex items-start gap-3 border border-danger/40 p-5">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="flex flex-col gap-1">
            <strong>Your last payment didn&apos;t go through</strong>
            <p className="text-sm text-muted">
              Update your payment method to keep creating. Everything you have made is saved; new content is paused until the payment goes through.
            </p>
          </div>
        </GlassCard>
      )}

      <GlassCard as="section" aria-labelledby="current-plan" className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span id="current-plan" className="text-[13px] text-muted">
              Current plan
            </span>
            <strong className="text-2xl tracking-[-0.02em]">
              {plan.name}
              {paid && <span className="text-base font-medium text-muted"> · {subscription.interval === "YEAR" ? "Yearly" : "Monthly"}</span>}
            </strong>
            {price && <span className="text-sm text-muted">{price}</span>}
            {isTrial && trialEnd && (
              <span className="text-sm text-muted">
                {trialDaysLeft === 0 ? `Trial ended ${trialEnd}` : `Trial ends ${trialEnd}`}
                {trialDaysLeft ? ` (${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left)` : ""}
              </span>
            )}
            {paid && periodEnd && !cancelling && !pastDue && <span className="text-sm text-muted">Renews {periodEnd}</span>}
            {cancelling && periodEnd && <span className="text-sm font-medium text-danger">Cancels on {periodEnd}. Your plan stays active until then.</span>}
          </div>
          <Badge tone={status === "ACTIVE" || status === "TRIALING" ? (cancelling ? "neutral" : "success") : "danger"}>
            {statusLabel(status, cancelling)}
          </Badge>
        </div>

        {paid && <PlanActions cancelAtPeriodEnd={cancelling} pastDue={pastDue} periodEnd={periodEnd} />}

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

      <PlanPicker current={{ plan: subscription.plan, interval: subscription.interval, paid, pastDue }} />

      {(paid || invoices.length > 0) && <InvoiceList invoices={invoices} />}

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
