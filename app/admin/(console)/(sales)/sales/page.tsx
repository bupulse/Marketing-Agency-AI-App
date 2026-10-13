import { PageHeader } from "@/components/app";
import { MyClientsView } from "@/components/admin/sales/sales-views";
import { can, requirePermission } from "@/lib/admin/auth";
import { nowMs } from "@/lib/admin/format";
import { getLeaderboard, monthOf } from "@/lib/sales/attribution";
import { loadSalesClients } from "@/lib/sales/clients";
import { ensureRefCode, refUrl } from "@/lib/sales/referral";

export const metadata = { title: "My clients" };

export default async function MyClientsPage() {
  const identity = await requirePermission("clients.own"); // pages render alongside the layout, so check here too
  const month = monthOf(new Date());
  const staffId = identity.staffId;
  const [clients, board, code] = staffId
    ? await Promise.all([loadSalesClients(staffId), getLeaderboard(month), ensureRefCode(staffId).catch(() => null)])
    : [[], [], null];
  return (
    <>
      <PageHeader title="My clients" description="Your clients, how to reach them and how they stand, your referral link and your numbers this month." />
      <MyClientsView
        d={{ isStaff: !!staffId, clients, link: code ? { code, url: refUrl(code) } : null, month, board, staffId, canViewClients: can(identity, "clients.view"), now: nowMs() }}
      />
    </>
  );
}
