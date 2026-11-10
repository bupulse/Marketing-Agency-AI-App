import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { AdminError, getAuditLog } from "@/lib/admin/service";
import { AuditView } from "@/components/admin/system/logs-view";

export const metadata = { title: "Audit log" };

/** Admin -> Audit log: every admin and Jarvis action with what changed; read-only. */
export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const actor = param(sp.actor);
  const action = param(sp.action);
  const target = param(sp.target);
  const since = param(sp.since);
  const until = param(sp.until);
  const cursor = param(sp.cursor);
  let page;
  let bad: string | null = null;
  try {
    page = await getAuditLog({ actor: actor || undefined, action: action || undefined, target: target || undefined, since: since ? `${since}T00:00:00Z` : undefined, until: until ? `${until}T23:59:59Z` : undefined, cursor: cursor || undefined, limit: 50 });
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    bad = e.message;
  }
  const next = page?.nextCursor ? `/admin/audit?${new URLSearchParams({ ...(actor && { actor }), ...(action && { action }), ...(target && { target }), ...(since && { since }), ...(until && { until }), cursor: page.nextCursor })}` : null;
  return <AuditView items={page?.items ?? null} more={Boolean(page?.nextCursor)} next={next} f={{ actor, action, target, since, until }} bad={bad} />;
}
