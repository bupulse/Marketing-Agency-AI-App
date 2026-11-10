import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { RevenueHow, RevenuePlans } from "@/components/admin/money/revenue-view";
import { requirePermission } from "@/lib/admin/auth";
import { getMoneyReportCached } from "@/lib/money/report";

export const metadata = { title: "Revenue by plan" };

/** Revenue by plan on its own page (it was a section of /admin/revenue). Same permission as Revenue. */
export default async function RevenuePlansPage() {
  await requirePermission("money.revenue"); // pages render alongside the layout, so check here too
  const [fx, report] = await Promise.all([adminMoney().then(moneyFmt), getMoneyReportCached(12)]);
  return (
    <>
      <PageHeader icon={Layers} tone="green" title="Revenue by plan" description="Who pays for what now, and what each plan brought in over all time." back={{ href: "/admin/revenue", label: "Revenue and profit" }} />
      <RevenuePlans r={report} fx={fx} />
      <RevenueHow />
    </>
  );
}
