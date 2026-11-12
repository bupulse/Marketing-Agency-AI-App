import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CreditCard, Gauge, Handshake, Layers, ListPlus, Receipt, Sparkles } from "lucide-react";
import { ExpandCard, FilterChips, KitStyles, PageHeader, SectionCard, SectionGrid, StatusPill, type PillTone } from "@/components/admin/kit";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import { CARD } from "@/components/admin/kit/tones";
import { Meter } from "@/components/ui";
import { cn } from "@/lib/cn";

export const BILLING_TABS = ["plans", "add", "receipts"] as const;
export type BillingTab = (typeof BILLING_TABS)[number];

export type BillingPlanLine = { text: string; tone?: "muted" | "strong" | "danger" };

/**
 * /dashboard/billing, laid out in three steps: what needs paying first (offers, invoices, Mobile Money), then the
 * current plan in one card (usage folded inside), then one of three tabs (change plan, add features, receipts), and two
 * small cards for a custom plan or done-for-you. The page works out every amount (VAT included where it applies) and
 * passes the pieces in; this only arranges them.
 */
export function BillingView({
  base = "/dashboard/billing",
  params,
  tab,
  top,
  alerts,
  plan,
  planActions,
  usage,
  plans,
  plansHidden,
  add,
  receipts,
  receiptsCount,
  custom,
}: {
  base?: string;
  params?: Record<string, string | string[] | undefined>;
  tab: BillingTab;
  /** The checkout return banner, the offer, the invoice to pay, the open Mobile Money payment (in that order). */
  top?: ReactNode;
  alerts: { pastDue: { momo: boolean } | null; stale: string | null; cardPending: string | null };
  plan: { name: string; interval: string | null; price: string | null; lines: BillingPlanLine[]; status: { label: string; tone: PillTone } };
  planActions?: ReactNode;
  usage: { resets: string | null; meters: { label: string; used: number; max: number }[] };
  /** The plan picker and its price note; null while a payment is being confirmed (`plansHidden` says why). */
  plans: ReactNode | null;
  plansHidden?: string;
  /** "Add features" to the running plan; null when nothing can be added now. */
  add: ReactNode | null;
  receipts: ReactNode | null;
  receiptsCount: number;
  custom: { paid: boolean; call: ReactNode | null };
}) {
  const tabs = [
    { value: "plans", label: "Change plan", icon: Layers },
    ...(add ? [{ value: "add", label: "Add features", icon: ListPlus }] : []),
    ...(receipts ? [{ value: "receipts", label: "Receipts", icon: Receipt, count: receiptsCount }] : []),
  ];
  const shown: BillingTab = (tab === "add" && !add) || (tab === "receipts" && !receipts) ? "plans" : tab;
  const top3 = usage.meters.slice(0, 2).map((m) => `${m.label.split(" (")[0]} ${m.used}/${m.max}`).join(" · ");
  return (
    <>
      <KitStyles />
      <PageHeader icon={CreditCard} title="Billing" description="Your plan, what you have used, and your receipts." />

      {alerts.pastDue && (
        <div role="alert" className={cn(CARD, "flex items-start gap-3 border-danger/40 p-4 sm:p-5")}>
          <IconBadge icon={AlertTriangle} tone="red" size="sm" />
          <div className="flex flex-col gap-1">
            <strong>{alerts.pastDue.momo ? "Your plan has ended" : "Your last payment didn't go through"}</strong>
            <p className="text-sm text-muted">
              {alerts.pastDue.momo
                ? "Pay by Mobile Money to keep creating. Everything you have made is saved; new content is paused until the payment is confirmed."
                : "Update your payment method to keep creating. Everything you have made is saved; new content is paused until the payment goes through."}
            </p>
          </div>
        </div>
      )}
      {alerts.stale && <Note text={alerts.stale} />}
      {top}

      <section aria-labelledby="current-plan" className={cn(CARD, "relative flex flex-col gap-5 overflow-hidden p-4 sm:p-6")}>
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-brand-gradient opacity-[0.12] blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <IconBadge icon={Sparkles} tone="violet" size="lg" />
            <div className="flex min-w-0 flex-col gap-1">
              <span id="current-plan" className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                Current plan
              </span>
              <strong className="text-[24px] leading-tight tracking-[-0.02em]">
                {plan.name}
                {plan.interval && <span className="text-base font-medium text-muted"> · {plan.interval}</span>}
              </strong>
              {plan.price && <span className="text-[15px] font-semibold">{plan.price}</span>}
              {plan.lines.map((l) => (
                <span key={l.text} className={cn("text-sm", l.tone === "strong" ? "font-medium" : l.tone === "danger" ? "font-medium text-danger" : "text-muted")}>
                  {l.text}
                </span>
              ))}
            </div>
          </div>
          <StatusPill tone={plan.status.tone} dot>
            {plan.status.label}
          </StatusPill>
        </div>
        {planActions && <div className="relative">{planActions}</div>}
        {usage.meters.length > 0 && (
          <ExpandCard icon={Gauge} tone="blue" title="Usage this period" summary={`${top3}${usage.resets ? ` · ${usage.resets}` : ""}`}>
            <div className="flex flex-col gap-3">
              {usage.meters.map((m) => (
                <Meter key={m.label} value={m.used} max={m.max} label={m.label} showValue />
              ))}
              <Link href="/dashboard/usage" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold no-underline">
                See all usage
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
          </ExpandCard>
        )}
      </section>

      {tabs.length > 1 && <FilterChips label="Billing" param="show" base={base} params={params} current={shown} allValue="plans" options={tabs} />}
      <div key={shown} className="kit-rise flex flex-col gap-4">
        <div className="flex flex-col gap-4">
          {shown === "plans" && (plans ?? <Note text={plansHidden ?? "Plans are hidden while your payment is being confirmed, so nobody pays twice."} />)}
          {shown === "add" && (
            <>
              {alerts.cardPending && <Note text={alerts.cardPending} />}
              {add}
            </>
          )}
          {shown === "receipts" && receipts}
        </div>
      </div>
      {shown !== "add" && alerts.cardPending && <Note text={alerts.cardPending} />}

      <SectionGrid cols={2}>
        <SectionCard
          href="/custom-plan?from=billing"
          icon={Handshake}
          tone="indigo"
          title={custom.paid ? "Need something different?" : "Want a custom plan?"}
          hint={custom.paid ? "Tell us what to change; you pay only for what you add, for the days left." : "Tell us what your business needs; we put together a plan with only what you use."}
          row
        />
        <SectionCard href="/done-for-you" icon={Sparkles} tone="violet" title="Done-for-you marketing" hint="Our team can run your social content and lead capture for you." row />
      </SectionGrid>
      {custom.call && (
        <p className="px-1 text-sm">
          {custom.call}{" "}
          <Link href="/custom-plan/call" className="font-semibold underline">
            See or move your call
          </Link>
        </p>
      )}
    </>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div role="status" className={cn(CARD, "flex items-start gap-3 p-4 sm:p-5")}>
      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
