import { RequestsView } from "@/components/admin/business/requests-view";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listPlanRequests } from "@/lib/offers/requests";
import { isRequestStatus } from "@/lib/offers/shared";
import { setRequestStatusAction } from "./actions";

export const metadata = { title: "Plan requests" };
export const dynamic = "force-dynamic";

export default async function PlanRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("requests"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const status = isRequestStatus(param(sp.status)) ? param(sp.status) : "";
  const open = param(sp.open);
  const requests = await listPlanRequests({ status: status || undefined });
  return <RequestsView requests={requests} status={status} open={open} sp={sp} setStatusAction={setRequestStatusAction} />;
}
