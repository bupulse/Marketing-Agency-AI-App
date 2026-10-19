import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import Link from "next/link";
import { PageHeader } from "@/components/app";
import { GoalSection } from "@/components/admin/money/goal-section";
import { RevenueView } from "@/components/admin/money/revenue-view";
import { requirePermission } from "@/lib/admin/auth";
import { getSettings } from "@/lib/admin/settings";
import { goalProgress, mrrInRwf } from "@/lib/money/goal";
import { getMoneyReportCached } from "@/lib/money/report";
import { kigaliMonthOf } from "@/lib/time/kigali";

export const metadata = { title: "Revenue and profit" };

export default async function RevenuePage() {
  await requirePermission("money.revenue"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const [report, settings] = await Promise.all([getMoneyReportCached(12), getSettings()]);
  // The goal tracker (docs/bizdev/PLAN.md): MRR in RWF against the monthly goal and the pace plan's target.
  const goal = goalProgress({ goalRwf: settings.revenueGoalRwf, mrrRwf: mrrInRwf(report.mrrCents, report.mrrRwf, report.rwfPerUsd), payingNow: report.lifetime.payingNow, startMonth: settings.goalStartMonth, thisMonth: report.thisMonth });
  const newThisMonth = report.clients.filter((c) => c.payments > 0 && kigaliMonthOf(new Date(c.firstAt)) === report.thisMonth).length;
  return (
    <>
      <PageHeader
        title="Revenue and profit"
        description="Revenue from every client ever (card, Mobile Money, invoices), MRR, churn and profit after every cost."
        action={<Link href="/admin/costs" className="text-sm font-medium underline">Costs</Link>}
      />
      {settings.revenueGoalRwf > 0 && <GoalSection g={goal} newThisMonth={newThisMonth} startMonth={settings.goalStartMonth} />}
      <RevenueView r={report} fx={fx} />
    </>
  );
}
