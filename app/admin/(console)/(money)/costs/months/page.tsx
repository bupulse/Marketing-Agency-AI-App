import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { CostMonths, CostsHow } from "@/components/admin/business/money-costs";
import { requirePermission } from "@/lib/admin/auth";
import { getMonthCosts } from "@/lib/money/costs";
import { addMonths } from "@/lib/money/costs-shared";
import { kigaliMonthOf } from "@/lib/time/kigali";

export const metadata = { title: "Costs by month" };

/** The last 12 months of costs (it was a section of /admin/costs). Same permission. */
export default async function CostMonthsPage() {
  await requirePermission("money.costs"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const thisMonth = kigaliMonthOf(new Date());
  const { months, rwfPerUsd } = await getMonthCosts(addMonths(thisMonth, -11), thisMonth);
  return (
    <>
      <PageHeader icon={CalendarRange} tone="green" title="Costs by month" description="What BuPulse paid in each of the last 12 months, and how much is still an estimate." back={{ href: "/admin/costs", label: "Costs" }} />
      <CostMonths fx={fx} months={months} />
      <CostsHow rwfPerUsd={rwfPerUsd} />
    </>
  );
}
