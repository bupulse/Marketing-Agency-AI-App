import { requirePermission } from "@/lib/admin/auth";
import { getSystemHealth } from "@/lib/admin/health";
import { getServicesAttention } from "@/lib/admin/services";
import { HealthView } from "@/components/admin/system/health-view";

export const metadata = { title: "System health" };

/** Admin -> Health: one status, what needs you, key numbers, the scheduled jobs, and details on demand. */
export default async function HealthPage() {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const [h, services] = await Promise.all([getSystemHealth(), getServicesAttention().catch(() => ({ failing: [], off: [] }))]);
  return <HealthView h={h} services={services} />;
}
