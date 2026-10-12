import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { AdminShell } from "@/components/admin/shell";
import { requireAdmin } from "@/lib/admin/auth";
import { pendingApprovalCount } from "@/lib/admin/console";
import { getHealthSummary } from "@/lib/admin/health";
import { pendingManualPaymentCount } from "@/lib/billing/momo";
import { newPlanRequestCount } from "@/lib/offers/requests";

export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const [pending, payments, requests, health] = await Promise.all([pendingApprovalCount(), pendingManualPaymentCount().catch(() => 0), newPlanRequestCount().catch(() => 0), getHealthSummary().catch(() => ({ status: "ok" as const, issues: [] }))]);
  return (
    <>
      <BackgroundBlobs />
      <AdminShell email={admin.email} badges={{ approvals: pending, payments, requests, health: { status: health.status, count: health.issues.length } }}>
        {children}
      </AdminShell>
    </>
  );
}
