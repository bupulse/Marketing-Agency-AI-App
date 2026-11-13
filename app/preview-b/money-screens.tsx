// Made-up data for the client preview's money screens (Billing, Usage). Placeholder numbers only.
import type { ReactNode } from "react";
import { chosen } from "@/components/admin/kit";
import { BILLING_TABS, BillingView, type BillingTab } from "@/components/billing/billing-view";
import { ClientInvoices } from "@/components/billing/client-invoices";
import { PlanActions } from "@/components/billing/plan-actions";
import { PlanPicker } from "@/components/billing/plan-picker";
import { UsageView } from "@/components/billing/usage-view";
import { priceWithVat } from "@/lib/billing/vat";
import type { ClientInvoice } from "@/lib/invoices/service";
import { SEED_PLANS } from "@/lib/plans";
import type { RegionalPlan } from "@/lib/region-prices";

type Sp = Record<string, string | string[] | undefined>;

/** Rwanda's plans as a client sees them: RWF prices with 18% VAT included (net 50,000 / 80,000 a month). */
function rwPlans(): RegionalPlan[] {
  const vat = { rateBps: 1800, label: "VAT" };
  const net: Record<string, [number, number]> = { STANDARD: [50_000, 500_000], PRO: [80_000, 800_000] };
  return (["STANDARD", "PRO"] as const).map((key) => {
    const p = SEED_PLANS[key];
    const [m, y] = net[key];
    const v = { rateBps: vat.rateBps, label: vat.label, monthly: priceWithVat(m, vat, "RWF"), yearly: priceWithVat(y, vat, "RWF") };
    return {
      key,
      name: p.name,
      description: p.description,
      isTrial: false,
      trialDays: null,
      highlight: p.highlight,
      monthlyPriceCents: v.monthly.totalMinor,
      yearlyPriceCents: v.yearly.totalMinor,
      currency: "RWF",
      limits: p.limits,
      highlights: p.highlights,
      features: p.features,
      regionKey: "RW",
      paymentMethods: ["momo", "card"],
      card: { monthlyUsdCents: 3900, yearlyUsdCents: 39000 },
      vat: v,
      vatRatePercent: 18,
    } as RegionalPlan;
  });
}

export function billingPreview(sp: Sp): ReactNode {
  const tab = chosen(sp, "show", BILLING_TABS, "plans") as BillingTab;
  const invoices = [
    { id: "inv1", number: "BP-2026-0042", status: "paid", paidAt: "2026-11-01", dueDate: "2026-11-05", total: "RWF 59,000", overdue: false },
    { id: "inv2", number: "BP-2026-0031", status: "paid", paidAt: "2026-10-01", dueDate: "2026-10-05", total: "RWF 59,000", overdue: false },
  ] as unknown as ClientInvoice[];
  return (
    <BillingView
      base="/preview-b/billing"
      params={sp}
      tab={tab}
      alerts={{ pastDue: null, stale: null, cardPending: null }}
      plan={{ name: "Standard", interval: "Monthly", price: "RWF 59,000 (VAT included) per month, by Mobile Money", lines: [{ text: "Your plan is paid until December 1, 2026. You can renew from November 24, 7 days before it ends." }], status: { label: "Active", tone: "good" } }}
      planActions={<PlanActions cancelAtPeriodEnd={false} pastDue={false} periodEnd="December 1, 2026" method="momo" canResume={false} />}
      usage={{ resets: "Resets December 1, 2026", meters: [{ label: "Text generations", used: 42, max: 100 }, { label: "AI image credits", used: 12, max: 30 }] }}
      plans={
        <>
          <PlanPicker plans={rwPlans()} current={{ plan: "STANDARD", interval: "MONTH", paid: true, pastDue: false, method: "momo" }} pay={{ regionMethods: ["momo", "card"], momoConfigured: true, cardConfigured: false, cardPriced: {} }} />
          <p className="px-1 text-sm text-muted">Prices for Rwanda. Prices in Rwandan francs, VAT included.</p>
        </>
      }
      add={<p className="text-sm text-muted">(Add features: the real list shows here.)</p>}
      receipts={<ClientInvoices invoices={invoices} />}
      receiptsCount={2}
      custom={{ paid: true, call: null }}
    />
  );
}

export function usagePreview(): ReactNode {
  return (
    <UsageView
      planName="Standard"
      period="What you have used this billing period, which ends December 1."
      rows={[
        { key: "text", label: "Text generations", unit: "generations", used: 42, limit: 100 },
        { key: "image", label: "AI image credits", unit: "credits", used: 28, limit: 30 },
        { key: "videos", label: "Videos", unit: "videos", used: 0, limit: 0 },
        { key: "voiceCharacters", label: "Voice characters", unit: "characters", used: 0, limit: 0 },
      ]}
      videosToday={{ used: 0, max: 4 }}
      canBill
    />
  );
}
