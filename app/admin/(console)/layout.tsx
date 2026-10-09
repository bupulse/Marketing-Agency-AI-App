import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { AdminShell } from "@/components/admin/shell";
import { requireAdmin } from "@/lib/admin/auth";
import { pendingApprovalCount } from "@/lib/admin/console";
import { getHealthSummary } from "@/lib/admin/health";

export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const [pending, health] = await Promise.all([pendingApprovalCount(), getHealthSummary().catch(() => ({ status: "ok" as const, issues: [] }))]);
  return (
    <>
      <BackgroundBlobs />
      <AdminShell email={admin.email} badges={{ approvals: pending, health: { status: health.status, count: health.issues.length } }}>
        {children}
      </AdminShell>
    </>
  );
}
