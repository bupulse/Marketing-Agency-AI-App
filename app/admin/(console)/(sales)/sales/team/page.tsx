import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { PageHeader } from "@/components/app";
import { notice } from "@/components/admin/ui";
import { TeamView } from "@/components/admin/sales/sales-views";
import { can, requirePermission } from "@/lib/admin/auth";
import { nowMs, param } from "@/lib/admin/format";
import { getLeaderboard, monthOf } from "@/lib/sales/attribution";
import { loadReassignments, loadSalesClients, loadSalesStaff } from "@/lib/sales/clients";
import { reassignClientAction } from "./actions";

export const metadata = { title: "Sales team" };

export default async function SalesTeamPage({ searchParams }: PageProps<"/admin/sales/team">) {
  const identity = await requirePermission("sales.team"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const month = monthOf(new Date());
  const [members, board, clients, reassignments] = await Promise.all([loadSalesStaff(), getLeaderboard(month), loadSalesClients(null), loadReassignments()]);
  return (
    <>
      <PageHeader title="Sales team" description="Every agent and their numbers this month, every client with its agent, and who moved which client and why." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <TeamView
        fx={moneyFmt(await adminMoney())}
        d={{ members, board, clients, reassignments, month, canViewClients: can(identity, "clients.view"), canReassign: can(identity, "clients.reassign"), now: nowMs() }}
        reassignAction={reassignClientAction}
      />
    </>
  );
}
