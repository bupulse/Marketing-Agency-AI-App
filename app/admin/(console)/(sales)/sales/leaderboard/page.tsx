import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { PageHeader } from "@/components/app";
import { LeaderboardView } from "@/components/admin/sales/sales-views";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { MONTH, getLeaderboard, monthOf } from "@/lib/sales/attribution";

export const metadata = { title: "Leaderboard" };

/** The current month and the eleven before it, newest first. */
function lastMonths(now: Date, n = 12): string[] {
  return Array.from({ length: n }, (_, i) => monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
}

export default async function LeaderboardPage({ searchParams }: PageProps<"/admin/sales/leaderboard">) {
  const identity = await requirePermission("sales.board"); // pages render alongside the layout, so check here too
  const months = lastMonths(new Date());
  const asked = param((await searchParams).month);
  const month = MONTH.test(asked) && months.includes(asked) ? asked : months[0];
  const rows = await getLeaderboard(month);
  return (
    <>
      <PageHeader title="Leaderboard" description="Sales per agent for the month: own sales, their share of unassigned clients' payments, and the total." />
      <LeaderboardView  fx={moneyFmt(await adminMoney())} rows={rows} month={month} months={months} me={identity.staffId} />
    </>
  );
}
