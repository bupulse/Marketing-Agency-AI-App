import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { FilePlus2 } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { CostBills, CostsHow } from "@/components/admin/business/money-costs";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { getMonthCosts, listProviderBills } from "@/lib/money/costs";
import { addMonths } from "@/lib/money/costs-shared";
import { kigaliMonthOf } from "@/lib/time/kigali";

export const metadata = { title: "Provider bills" };

/** Provider bills (it was the #bills section of /admin/costs; ?month= picks the month in the form). Same permission. */
export default async function CostBillsPage({ searchParams }: PageProps<"/admin/costs/bills">) {
  await requirePermission("money.costs"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const sp = await searchParams;
  const thisMonth = kigaliMonthOf(new Date());
  const asked = param(sp.month);
  const billMonth = /^\d{4}-\d{2}$/.test(asked) ? asked : addMonths(thisMonth, -1);
  const [{ months, rwfPerUsd }, bills] = await Promise.all([getMonthCosts(addMonths(thisMonth, -11), thisMonth), listProviderBills()]);
  return (
    <>
      <PageHeader icon={FilePlus2} tone="green" title="Provider bills" description="What each AI provider really billed for a month. A bill replaces our estimate everywhere." back={{ href: "/admin/costs", label: "Costs" }} />
      <MoneyNotices sp={sp} />
      <CostBills fx={fx} bills={bills} months={months} thisMonth={thisMonth} billMonth={billMonth} />
      <CostsHow rwfPerUsd={rwfPerUsd} />
    </>
  );
}
