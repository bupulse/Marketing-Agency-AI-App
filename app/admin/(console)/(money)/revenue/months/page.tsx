import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { RevenueHow, RevenueMonths } from "@/components/admin/money/revenue-view";
import { requirePermission } from "@/lib/admin/auth";
import { getMoneyReportCached } from "@/lib/money/report";

export const metadata = { title: "Profit by month" };

/** Profit by month on its own page (it was a section of /admin/revenue; old #profit links come here). Same permission. */
export default async function RevenueMonthsPage() {
  await requirePermission("money.revenue"); // pages render alongside the layout, so check here too
  const [fx, report] = await Promise.all([adminMoney().then(moneyFmt), getMoneyReportCached(12)]);
  return (
    <>
      <PageHeader icon={CalendarRange} tone="green" title="Profit by month" description="Revenue by how it was paid, refunds, costs and profit, for each of the last 12 months." back={{ href: "/admin/revenue", label: "Revenue and profit" }} />
      <RevenueMonths r={report} fx={fx} />
      <RevenueHow />
    </>
  );
}
