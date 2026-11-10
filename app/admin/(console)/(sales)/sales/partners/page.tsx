import { PartnersView } from "@/components/admin/business/partners-view";
import { can, requirePermission } from "@/lib/admin/auth";
import { loadPartners } from "@/lib/partners/service";
import { approvePartnerAction, pausePartnerAction, recordPayoutAction, rejectPartnerAction } from "./actions";

export const metadata = { title: "Partners" };

export default async function PartnersPage({ searchParams }: PageProps<"/admin/sales/partners">) {
  const identity = await requirePermission(["sales.team", "money.revenue"]); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const rows = await loadPartners();
  return (
    <PartnersView
      rows={rows}
      canDecide={can(identity, "sales.team")}
      canPay={can(identity, "payments.approve")}
      sp={sp}
      actions={{ approve: approvePartnerAction, reject: rejectPartnerAction, pause: pausePartnerAction, payout: recordPayoutAction }}
    />
  );
}
