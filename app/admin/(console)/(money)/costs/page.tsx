import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { Receipt } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { CostsHow, CostsOverview } from "@/components/admin/business/money-costs";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { requirePermission } from "@/lib/admin/auth";
import { listMonthlyCosts } from "@/lib/analytics/costs";
import { getMonthCosts, listProviderBills, listRecurringCosts } from "@/lib/money/costs";
import { addMonths } from "@/lib/money/costs-shared";
import { kigaliMonthOf } from "@/lib/time/kigali";

export const metadata = { title: "Costs" };

/** Costs: this month at a glance, and a card for each job (bills, recurring, one-month costs, month by month). */
export default async function CostsPage({ searchParams }: PageProps<"/admin/costs">) {
  await requirePermission("money.costs"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const sp = await searchParams;
  const thisMonth = kigaliMonthOf(new Date());
  const lastMonth = addMonths(thisMonth, -1);
  const [{ months, rwfPerUsd }, recurring, bills, entered] = await Promise.all([getMonthCosts(addMonths(thisMonth, -11), thisMonth), listRecurringCosts(), listProviderBills(), listMonthlyCosts()]);

  return (
    <>
      <PageHeader icon={Receipt} tone="green" title="Costs" description="Everything BuPulse pays for each month: AI (the real bill, or our estimate until you enter it), hosting, the domain and subscriptions." />
      <MoneyNotices sp={sp} />
      <CostsOverview fx={fx} months={months} recurring={recurring} bills={bills} entered={entered} thisMonth={thisMonth} lastMonth={lastMonth} />
      <CostsHow rwfPerUsd={rwfPerUsd} />
    </>
  );
}
