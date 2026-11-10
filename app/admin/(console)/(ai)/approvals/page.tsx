import { requirePermission } from "@/lib/admin/auth";
import { APPROVAL_VIEWS, ApprovalsView } from "@/components/admin/content-ai/approvals-view";
import { chosen } from "@/components/admin/kit";
import { isExpiredApproval, splitApprovals } from "@/lib/admin/approvals-view";
import { nowMs, param } from "@/lib/admin/format";
import { APPROVAL_TTL_MS, listApprovals, type ApprovalView } from "@/lib/admin/service";
import { getPaddleConfig } from "@/lib/billing/paddle-config";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: PageProps<"/admin/approvals">) {
  await requirePermission("approvals.decide"); // pages render alongside the layout, so check here too
  const paddleEnv = (await getPaddleConfig()).environment;
  const sp = await searchParams;
  // Pending is its own query so a waiting request can never fall off the newest-100 history.
  const [pendingRows, recent] = await Promise.all([listApprovals({ status: "pending", limit: 100 }), listApprovals({ limit: 100 })]);
  const { pending, history } = splitApprovals(pendingRows, recent, nowMs(), APPROVAL_TTL_MS);
  const isExpired = (a: ApprovalView) => isExpiredApproval(a, nowMs(), APPROVAL_TTL_MS);
  const view = chosen(sp, "view", APPROVAL_VIEWS, "waiting") as (typeof APPROVAL_VIEWS)[number];
  return <ApprovalsView pending={pending} history={history} isExpired={isExpired} paddleEnv={paddleEnv} view={view} params={sp} message={{ notice: param(sp.notice) || undefined, error: param(sp.error) || undefined }} />;
}
