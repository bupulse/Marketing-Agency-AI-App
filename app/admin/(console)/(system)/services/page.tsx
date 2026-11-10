import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listServicesWithKeys } from "@/lib/admin/services";
import { robotStatus } from "@/lib/visuals/robot";
import { inboxAdminView } from "@/lib/social/inbox/admin";
import { chosen } from "@/components/admin/kit";
import { ServicesGrid } from "@/components/admin/system/services/services-grid";
import { robotState } from "@/components/admin/system/services/more-services";
import { SERVICE_FILTERS, type ServiceFilter } from "@/components/admin/system/services/service-status";

export const metadata = { title: "Services" };

/**
 * Admin -> Services: a card per outside service (state, last test, what stops if it is off), each opening its own page
 * (./[service]/page.tsx) with its keys, Test now and the switch. Old #setup-<id> links open that page.
 */
export default async function ServicesPage({ searchParams }: PageProps<"/admin/services">) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [{ services, custom, unreadable }, robot, inbox] = await Promise.all([listServicesWithKeys(), robotStatus(), inboxAdminView()]);
  const composio = inbox.settings.transport === "composio";
  return (
    <ServicesGrid
      services={services.map((s) => ({ id: s.id, name: s.name, purpose: s.purpose, health: s.health, whenOff: s.whenOff, lastCheck: s.lastCheck ? { ok: s.lastCheck.ok, checkedAt: s.lastCheck.checkedAt } : null }))}
      extras={{ inbox: { ready: composio ? inbox.composioReady : inbox.metaReady }, custom: { count: custom.length, broken: custom.filter((k) => !k.inUse).length }, robot: robotState(robot) }}
      filter={chosen(sp, "show", SERVICE_FILTERS, "") as ServiceFilter}
      sp={sp}
      unreadable={unreadable}
      ok={param(sp.notice)}
      bad={param(sp.error)}
    />
  );
}
