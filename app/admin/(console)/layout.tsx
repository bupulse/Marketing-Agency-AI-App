import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { AdminShell } from "@/components/admin/shell";
import { requireAdmin } from "@/lib/admin/auth";
import { pendingApprovalCount } from "@/lib/admin/console";

export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const pending = await pendingApprovalCount();
  return (
    <>
      <BackgroundBlobs />
      <AdminShell email={admin.email} pendingApprovals={pending}>
        {children}
      </AdminShell>
    </>
  );
}
