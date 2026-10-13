import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { AdminShell, type ShellBadges } from "@/components/admin/shell";
import { requireAdmin } from "@/lib/admin/auth";
import { getHealthSummary } from "@/lib/admin/health";
import { getInboxCounts } from "@/lib/admin/inbox";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const [inbox, health] = await Promise.all([getInboxCounts(), getHealthSummary().catch(() => ({ status: "ok" as const, issues: [] }))]);
  const badges: ShellBadges = {
    inbox: { count: inbox.total, tone: "danger", label: plural(inbox.total, "item waiting in the inbox", "items waiting in the inbox") },
    payments: { count: inbox.payments, tone: "danger", label: plural(inbox.payments, "Mobile Money payment to check", "Mobile Money payments to check") },
    approvals: { count: inbox.approvals, tone: "danger", label: plural(inbox.approvals, "request waiting for approval", "requests waiting for approval") },
    requests: { count: inbox.requests, tone: "violet", label: plural(inbox.requests, "new plan request", "new plan requests") },
    errors: { count: inbox.errors, tone: "neutral", label: plural(inbox.errors, "error in the last 24 hours", "errors in the last 24 hours") },
    health: health.status === "ok" ? undefined : { count: health.issues.length, tone: health.status === "problem" ? "danger" : "violet", label: plural(health.issues.length, "health issue", "health issues") },
  };
  return (
    <>
      <BackgroundBlobs />
      <AdminShell email={admin.email} roleName={admin.isOwner && !admin.staffId ? undefined : admin.roleName} permissions={admin.permissions} badges={badges}>
        {children}
      </AdminShell>
    </>
  );
}
