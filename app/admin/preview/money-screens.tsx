// Dev-only preview screens for the Money area (app/admin/preview), with made-up data. Not in production.
import Link from "next/link";
import { CalendarRange, Clock3, Coins, FileText, FilePlus2, History, Layers, Plus, Receipt, Repeat, Settings2, Smartphone, Sparkles, Tags, Users } from "lucide-react";
import { PageHeader, StatGrid, StatTile, chosen } from "@/components/admin/kit";
import { buttonClasses } from "@/components/ui";
import { moneyFmt } from "@/components/admin/money";
import { BOOKS } from "@/lib/money/display";
import { GoalSection } from "@/components/admin/money/goal-section";
import { RevenueClients, RevenueHow, RevenueMonths, RevenueView } from "@/components/admin/money/revenue-view";
import { CostBills, CostMonths, CostRecurring, CostsHow, CostsOverview } from "@/components/admin/business/money-costs";
import { HISTORY_FILTERS, PaymentsCardEvents, PaymentsHistory, PaymentsOverview, PaymentsStarted } from "@/components/admin/business/money-payments";
import { INVOICE_FILTERS, InvoicesList } from "@/components/admin/business/money-invoices";
import { OFFER_FILTERS, OffersList } from "@/components/admin/business/money-offers";
import { PlanExtras, PlansGrid } from "@/components/admin/business/money-plans";
import { AddonPricesView } from "@/components/admin/business/money-addons";
import { PlanForm } from "@/components/admin/plan-form";
import { notice } from "@/components/admin/ui";
import { goalProgress } from "@/lib/money/goal";
import { COST_PRESETS } from "@/lib/money/costs-shared";
import { money, num } from "@/lib/admin/format";
import type { ConfirmResult } from "@/components/admin/confirm-button";
import type { PreviewScreen } from "./business-screens";
import {
  PREVIEW_ADDONS, PREVIEW_BILLS, PREVIEW_CARD_EVENTS, PREVIEW_COST_MONTHS, PREVIEW_DECIDED, PREVIEW_ENTERED, PREVIEW_INVOICES, PREVIEW_LAST_MONTH, PREVIEW_MOMO, PREVIEW_OFFERS, PREVIEW_PLAN_DETAIL, PREVIEW_PLANS, PREVIEW_RECURRING,
  PREVIEW_REPORT, PREVIEW_STARTED, PREVIEW_THIS_MONTH, PREVIEW_TO_CHECK,
} from "./money-preview-data";

const fx = moneyFmt({ ...BOOKS, currency: "RWF" });
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** The preview never runs an action: the buttons open their dialogs, and confirming says so. */
async function noAction(): Promise<ConfirmResult> {
  "use server";
  return { ok: false, error: "The preview does not run actions." };
}

export const MONEY_SCREENS: Record<string, PreviewScreen> = {
  revenue: {
    path: "/admin/revenue",
    render: () => {
      const goal = goalProgress({ goalRwf: 9_000_000, mrrRwf: 3_100_000, payingNow: 34, startMonth: "2026-10", thisMonth: PREVIEW_THIS_MONTH });
      return (
        <>
          <PageHeader icon={Coins} tone="green" title="Revenue and profit" description="What clients paid (card, Mobile Money, invoices), what BuPulse spent, and what is left." actions={<Link href="/admin/preview/costs" className={buttonClasses({ variant: "outline" })}><Receipt aria-hidden className="size-4" /> Costs</Link>} />
          <GoalSection g={goal} newThisMonth={6} startMonth="2026-10" />
          <RevenueView r={PREVIEW_REPORT} fx={fx} />
        </>
      );
    },
  },
  "revenue-months": {
    path: "/admin/revenue/months",
    render: () => (
      <>
        <PageHeader icon={CalendarRange} tone="green" title="Profit by month" description="Revenue by how it was paid, refunds, costs and profit, for each of the last 12 months." back={{ href: "/admin/preview/revenue", label: "Revenue and profit" }} />
        <RevenueMonths r={PREVIEW_REPORT} fx={fx} />
        <RevenueHow />
      </>
    ),
  },
  "revenue-clients": {
    path: "/admin/revenue/clients",
    render: () => (
      <>
        <PageHeader icon={Users} tone="blue" title="Every client ever" description="What each client paid over all time, their AI cost, and what is left." back={{ href: "/admin/preview/revenue", label: "Revenue and profit" }} />
        <RevenueClients r={PREVIEW_REPORT} fx={fx} />
      </>
    ),
  },
  costs: {
    path: "/admin/costs",
    render: (sp) => (
      <>
        <PageHeader icon={Receipt} tone="green" title="Costs" description="Everything BuPulse pays for each month: AI (the real bill, or our estimate until you enter it), hosting, the domain and subscriptions." />
        {first(sp.notice) && <p role="status" className={notice.ok}>{first(sp.notice)}</p>}
        <CostsOverview fx={fx} months={PREVIEW_COST_MONTHS} recurring={PREVIEW_RECURRING} bills={PREVIEW_BILLS} entered={PREVIEW_ENTERED} thisMonth={PREVIEW_THIS_MONTH} lastMonth={PREVIEW_LAST_MONTH} />
        <CostsHow rwfPerUsd={1450} />
      </>
    ),
  },
  "costs-bills": {
    path: "/admin/costs/bills",
    render: () => (
      <>
        <PageHeader icon={FilePlus2} tone="green" title="Provider bills" description="What each AI provider really billed for a month. A bill replaces our estimate everywhere." back={{ href: "/admin/preview/costs", label: "Costs" }} />
        <CostBills fx={fx} bills={PREVIEW_BILLS} months={PREVIEW_COST_MONTHS} thisMonth={PREVIEW_THIS_MONTH} billMonth={PREVIEW_LAST_MONTH} />
      </>
    ),
  },
  "costs-recurring": {
    path: "/admin/costs/recurring",
    render: (sp) => (
      <>
        <PageHeader icon={Repeat} tone="green" title="Recurring costs" description="Hosting, the domain and subscriptions: costs paid every month or year." back={{ href: "/admin/preview/costs", label: "Costs" }} />
        <CostRecurring fx={fx} recurring={PREVIEW_RECURRING} thisMonth={PREVIEW_THIS_MONTH} lastMonth={PREVIEW_LAST_MONTH} rwfPerUsd={1450} presetKey={chosen(sp, "preset", COST_PRESETS.map((p) => p.key), "")} sp={sp} />
      </>
    ),
  },
  "costs-months": {
    path: "/admin/costs/months",
    render: () => (
      <>
        <PageHeader icon={CalendarRange} tone="green" title="Costs by month" description="What BuPulse paid in each of the last 12 months, and how much is still an estimate." back={{ href: "/admin/preview/costs", label: "Costs" }} />
        <CostMonths fx={fx} months={PREVIEW_COST_MONTHS} />
      </>
    ),
  },
  payments: {
    path: "/admin/payments",
    render: (sp) => (
      <>
        <PageHeader icon={Smartphone} tone="green" title="Payments" description="Mobile Money payments clients made by hand. Check each against your MoMo or Airtel messages, then confirm or reject." />
        <PaymentsOverview toCheck={sp.empty ? [] : PREVIEW_TO_CHECK} started={PREVIEW_STARTED} cardEvents={PREVIEW_CARD_EVENTS} decided={PREVIEW_DECIDED} settings={PREVIEW_MOMO} canApprove={first(sp.role) !== "support"} confirmAction={noAction} rejectAction={noAction} />
      </>
    ),
  },
  "payments-started": {
    path: "/admin/payments/started",
    render: () => (
      <>
        <PageHeader icon={Clock3} tone="green" title="Started, not paid yet" description="Clients who opened the Mobile Money pay screen but have not tapped I've paid." back={{ href: "/admin/preview/payments", label: "Payments" }} />
        <PaymentsStarted fx={fx} started={PREVIEW_STARTED} />
        <PaymentsCardEvents events={PREVIEW_CARD_EVENTS} />
      </>
    ),
  },
  "payments-history": {
    path: "/admin/payments/history",
    render: (sp) => (
      <>
        <PageHeader icon={History} tone="green" title="Payment history" description="Mobile Money payments you confirmed or rejected, and the ones that expired." back={{ href: "/admin/preview/payments", label: "Payments" }} />
        <PaymentsHistory fx={fx} sp={sp} status={chosen(sp, "status", HISTORY_FILTERS, "")} decided={PREVIEW_DECIDED} />
      </>
    ),
  },
  invoices: {
    path: "/admin/invoices",
    render: (sp) => {
      const status = INVOICE_FILTERS.find((f) => f.value === first(sp.status))?.value ?? "";
      const rows = PREVIEW_INVOICES.filter((i) => !status || (status === "overdue" ? i.overdue : i.status === status && !(status === "sent" && i.overdue)));
      return (
        <>
          <PageHeader icon={FileText} tone="green" title="Invoices" description="Invoices to clients, mostly sent after a demo. Paying one (Mobile Money with the invoice number as the reference, card, or marked paid here) switches the plan on." actions={<Link href="/admin/preview/invoices" className={buttonClasses({ variant: "outline" })}><Settings2 aria-hidden className="size-4" /> Invoice settings</Link>} />
          <InvoicesList fx={fx} invoices={rows} status={status} q="" businessId="" sp={sp} />
        </>
      );
    },
  },
  offers: {
    path: "/admin/offers",
    render: (sp) => {
      const status = OFFER_FILTERS.find((f) => f.value === first(sp.status))?.value ?? "";
      return (
        <>
          <PageHeader icon={Sparkles} tone="green" title="Offers" description="Custom plans offered to one company, made from the company page (Customise plan) or a plan request. The client accepts on Billing and pays; confirming the payment switches the plan on." actions={<Link href="/admin/preview/addon-prices" className={buttonClasses({ variant: "outline" })}><Tags aria-hidden className="size-4" /> Add-on prices</Link>} />
          <OffersList offers={PREVIEW_OFFERS.filter((o) => !status || o.status === status)} status={status} businessId="" sp={sp} now={new Date("2026-11-10T09:00:00Z")} />
        </>
      );
    },
  },
  plans: {
    path: "/admin/plans",
    render: () => (
      <>
        <PageHeader icon={Layers} tone="green" title="Plans" description="What clients can buy. The pricing page, checkout, limits and Jarvis all read these plans. Open one to change it." actions={<Link href="/admin/preview/plan" className={buttonClasses({ size: "md" })}><Plus aria-hidden className="size-4" /> New plan</Link>} />
        <StatGrid cols={3} className="grid-cols-1 sm:grid-cols-3">
          <StatTile icon={Repeat} tone="green" label="MRR from plans" value={money(PREVIEW_PLANS.reduce((s, p) => s + p.mrrCents, 0))} hint="What paying clients bring in a month, at today's plan prices." />
          <StatTile icon={Users} tone="blue" label="Paying clients" value={num(35)} hint="On a paid plan now (active or late paying)." />
          <StatTile icon={Layers} tone="green" label="Plans" value={num(PREVIEW_PLANS.length)} hint="4 on sale, the rest hidden or retired." />
        </StatGrid>
        <PlansGrid plans={PREVIEW_PLANS} />
      </>
    ),
  },
  plan: {
    path: "/admin/plans/STANDARD",
    render: () => {
      const { plan } = PREVIEW_PLAN_DETAIL;
      return (
        <>
          <PageHeader icon={Layers} tone="green" title={plan.name} description={`${plan.key} · 13 clients · ${money(26000)} MRR`} back={{ href: "/admin/preview/plans", label: "All plans" }} />
          <PlanForm mode="edit" paddleConnected subscribers={13} initial={{ key: plan.key, name: plan.name, description: plan.description, isTrial: false, isCustom: false, currency: "USD", trialDays: null, status: plan.status, sortOrder: plan.sortOrder, highlight: plan.highlight, monthlyPriceCents: plan.monthlyPriceCents, yearlyPriceCents: plan.yearlyPriceCents, limits: plan.limits, highlights: plan.highlights, features: plan.features }} />
          <PlanExtras d={PREVIEW_PLAN_DETAIL} />
        </>
      );
    },
  },
  "addon-prices": {
    path: "/admin/addon-prices",
    render: (sp) => (
      <>
        <PageHeader icon={Tags} tone="green" title="Add-on prices" description="What each feature, block of a limit and extra user costs a month in each region. Custom plan offers add these on top of the base plan (yearly = 10 months)." />
        <AddonPricesView table={PREVIEW_ADDONS} regionKey={first(sp.region)} sp={sp} />
      </>
    ),
  },
};
