import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { RevenueClients, RevenueHow } from "@/components/admin/money/revenue-view";
import { requirePermission } from "@/lib/admin/auth";
import { getMoneyReportCached } from "@/lib/money/report";

export const metadata = { title: "Every client ever" };

/** Every client ever on its own page (it was a section of /admin/revenue; old #clients links come here). Same permission. */
export default async function RevenueClientsPage() {
  await requirePermission("money.revenue"); // pages render alongside the layout, so check here too
  const [fx, report] = await Promise.all([adminMoney().then(moneyFmt), getMoneyReportCached(12)]);
  return (
    <>
      <PageHeader icon={Users} tone="blue" title="Every client ever" description="What each client paid over all time, their AI cost, and what is left." back={{ href: "/admin/revenue", label: "Revenue and profit" }} />
      <RevenueClients r={report} fx={fx} />
      <RevenueHow />
    </>
  );
}
