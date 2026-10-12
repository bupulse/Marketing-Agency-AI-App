import "server-only";
import { pendingApprovalCount } from "./console";
import { getAiBudgetStatus } from "./ai-usage";
import { getHealthSummary, type HealthIssue } from "./health";
import { getServicesAttention } from "./services";
import { pendingManualPaymentCount } from "@/lib/billing/momo";
import { platformBytes } from "@/lib/media/service";
import { formatBytes, platformMaxBytes, platformNearlyFull } from "@/lib/media/rules";

export type AttentionItem = { level: "warning" | "problem"; key: string; text: string; href: string };

/**
 * What needs the owner now, worst first: money requests waiting, failing jobs and queues, an error spike,
 * and anything the Services and AI pages report. One list for the Overview box.
 */
export async function getAttention(): Promise<AttentionItem[]> {
  const [approvals, payments, health, services, budget, storageBytes] = await Promise.all([
    pendingApprovalCount(),
    pendingManualPaymentCount().catch(() => 0),
    getHealthSummary().catch(() => ({ status: "ok" as const, issues: [] as HealthIssue[] })),
    getServicesAttention().catch(() => ({ failing: [], off: [] })),
    getAiBudgetStatus().catch(() => null),
    platformBytes().catch(() => null),
  ]);
  const items: AttentionItem[] = [];
  if (payments > 0) items.push({ level: "warning", key: "payments", text: `${payments} Mobile Money payment${payments === 1 ? " is" : "s are"} waiting for you to check.`, href: "/admin/payments" });
  if (approvals > 0) items.push({ level: "warning", key: "approvals", text: `${approvals} money request${approvals === 1 ? " is" : "s are"} waiting for your approval.`, href: "/admin/approvals" });
  for (const f of services.failing) items.push({ level: "problem", key: `service:${f.key}`, text: `${f.label} is failing: ${f.reason}`, href: "/admin/services" });
  for (const o of services.off) items.push({ level: "warning", key: `off:${o.key}`, text: `${o.label} is switched off (${o.reason}).`, href: "/admin/services" });
  if (budget) {
    if (budget.paused) items.push({ level: "problem", key: "ai-budget", text: "The monthly AI cap is reached: every AI feature is paused.", href: "/admin/ai" });
    else if (budget.pct >= 80) items.push({ level: "warning", key: "ai-budget", text: `AI spend is at ${Math.round(budget.pct)}% of the monthly cap.`, href: "/admin/ai" });
  }
  // All companies' photos share one Storage project (MEDIA_PLATFORM_MAX_BYTES); new photos stop at the cap.
  if (storageBytes !== null && platformNearlyFull(storageBytes)) {
    const max = platformMaxBytes();
    const full = storageBytes >= max;
    items.push({ level: full ? "problem" : "warning", key: "media-storage", text: `Photo storage is ${full ? "full: new photos are refused" : `at ${Math.round((storageBytes / max) * 100)}%`} (${formatBytes(storageBytes)} of ${formatBytes(max)}). Raise MEDIA_PLATFORM_MAX_BYTES with a bigger Storage plan, or clear space.`, href: "/admin/errors" });
  }
  for (const i of health.issues) if (i.key !== "approvals") items.push(i);
  return items.sort((a, b) => (a.level === b.level ? 0 : a.level === "problem" ? -1 : 1));
}
