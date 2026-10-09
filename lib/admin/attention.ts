import "server-only";
import { pendingApprovalCount } from "./console";
import { getAiBudgetStatus } from "./ai-usage";
import { getHealthSummary, type HealthIssue } from "./health";
import { getServicesAttention } from "./services";

export type AttentionItem = { level: "warning" | "problem"; key: string; text: string; href: string };

/**
 * What needs the owner now, worst first: money requests waiting, failing jobs and queues, an error spike,
 * and anything the Services and AI pages report. One list for the Overview box.
 */
export async function getAttention(): Promise<AttentionItem[]> {
  const [approvals, health, services, budget] = await Promise.all([
    pendingApprovalCount(),
    getHealthSummary().catch(() => ({ status: "ok" as const, issues: [] as HealthIssue[] })),
    getServicesAttention().catch(() => ({ failing: [], off: [] })),
    getAiBudgetStatus().catch(() => null),
  ]);
  const items: AttentionItem[] = [];
  if (approvals > 0) items.push({ level: "warning", key: "approvals", text: `${approvals} money request${approvals === 1 ? " is" : "s are"} waiting for your approval.`, href: "/admin/approvals" });
  for (const f of services.failing) items.push({ level: "problem", key: `service:${f.key}`, text: `${f.label} is failing: ${f.reason}`, href: "/admin/services" });
  for (const o of services.off) items.push({ level: "warning", key: `off:${o.key}`, text: `${o.label} is switched off (${o.reason}).`, href: "/admin/services" });
  if (budget) {
    if (budget.paused) items.push({ level: "problem", key: "ai-budget", text: "The monthly AI cap is reached: every AI feature is paused.", href: "/admin/ai" });
    else if (budget.pct >= 80) items.push({ level: "warning", key: "ai-budget", text: `AI spend is at ${Math.round(budget.pct)}% of the monthly cap.`, href: "/admin/ai" });
  }
  for (const i of health.issues) if (i.key !== "approvals") items.push(i);
  return items.sort((a, b) => (a.level === b.level ? 0 : a.level === "problem" ? -1 : 1));
}
