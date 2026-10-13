import Link from "next/link";
import { PageHeader } from "@/components/app";
import { RevenueView } from "@/components/admin/money/revenue-view";
import { requirePermission } from "@/lib/admin/auth";
import { getMoneyReportCached } from "@/lib/money/report";

export const metadata = { title: "Revenue and profit" };

export default async function RevenuePage() {
  await requirePermission("money.revenue"); // pages render alongside the layout, so check here too
  const report = await getMoneyReportCached(12);
  return (
    <>
      <PageHeader
        title="Revenue and profit"
        description="Revenue from every client ever (card, Mobile Money, invoices), MRR, churn and profit after every cost."
        action={<Link href="/admin/costs" className="text-sm font-medium underline">Costs</Link>}
      />
      <RevenueView r={report} />
    </>
  );
}
