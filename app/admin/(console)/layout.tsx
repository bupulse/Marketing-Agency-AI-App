import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { AdminShell, type ShellBadges } from "@/components/admin/shell";
import { requireAdmin } from "@/lib/admin/auth";
import { getHealthSummary } from "@/lib/admin/health";
import { countsSignature, getInboxCounts, inboxTotalFor, LIVE_COUNT_PERMISSIONS } from "@/lib/admin/inbox";
import { LiveCounts } from "@/components/admin/live-counts";
import { adminMoney } from "@/lib/money/display-server";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  // Badges only for what the person can see (the sidebar hides the rest anyway); health needs the system permission.
  const [inbox, display, health] = await Promise.all([getInboxCounts(), adminMoney(), admin.permissions.includes("system") ? getHealthSummary().catch(() => ({ status: "ok" as const, issues: [] })) : Promise.resolve({ status: "ok" as const, issues: [] })]);
  const mine = inboxTotalFor(inbox, admin.permissions);
  const badges: ShellBadges = {
    inbox: { count: mine, tone: "danger", label: plural(mine, "item waiting in the inbox", "items waiting in the inbox") },
    payments: { count: inbox.payments, tone: "danger", label: plural(inbox.payments, "Mobile Money payment to check", "Mobile Money payments to check") },
    approvals: { count: inbox.approvals, tone: "danger", label: plural(inbox.approvals, "request waiting for approval", "requests waiting for approval") },
    requests: { count: inbox.requests, tone: "violet", label: plural(inbox.requests, "new plan request", "new plan requests") },
    reports: { count: inbox.reports, tone: "violet", label: plural(inbox.reports, "open creator marketplace report", "open creator marketplace reports") },
    errors: { count: inbox.errors, tone: "neutral", label: plural(inbox.errors, "error in the last 24 hours", "errors in the last 24 hours") },
    health: health.status === "ok" ? undefined : { count: health.issues.length, tone: health.status === "problem" ? "danger" : "violet", label: plural(health.issues.length, "health issue", "health issues") },
  };
  return (
    <>
      <BackgroundBlobs />
      <AdminShell email={admin.email} roleName={admin.isOwner && !admin.staffId ? undefined : admin.roleName} permissions={admin.permissions} badges={badges} currency={display.currency}>
        {children}
      </AdminShell>
      {admin.permissions.some((p) => LIVE_COUNT_PERMISSIONS.includes(p)) && <LiveCounts signature={countsSignature(inbox)} />}
    </>
  );
}
