import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { Receipt } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { CostOneOff } from "@/components/admin/business/money-costs";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { requirePermission } from "@/lib/admin/auth";
import { listMonthlyCosts } from "@/lib/analytics/costs";
import { kigaliMonthOf } from "@/lib/time/kigali";

export const metadata = { title: "One-month costs" };

/** One-month costs (it was the #one-off section of /admin/costs). Same permission. */
export default async function CostOneOffPage({ searchParams }: PageProps<"/admin/costs/one-off">) {
  await requirePermission("money.costs"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const sp = await searchParams;
  const entered = await listMonthlyCosts();
  return (
    <>
      <PageHeader icon={Receipt} tone="green" title="One-month costs" description="Costs for one month only, such as a one-off purchase." back={{ href: "/admin/costs", label: "Costs" }} />
      <MoneyNotices sp={sp} />
      <CostOneOff fx={fx} entered={entered} thisMonth={kigaliMonthOf(new Date())} />
    </>
  );
}
