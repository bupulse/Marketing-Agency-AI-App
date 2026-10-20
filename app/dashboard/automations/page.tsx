import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { AutomationsList } from "@/components/automations/automations-list";
import { prisma } from "@/lib/db";
import { can } from "@/lib/team/roles";
import { listAutomations } from "@/lib/automations/service";

export const metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const blocked = await featureGate("automations");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  const [automations, social] = await Promise.all([
    listAutomations(business.id),
    prisma.connection.count({ where: { businessId: business.id, provider: { in: ["instagram", "facebook"] }, inboxEnabled: true } }),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Automations" description="Answer messages and comments automatically: send prices, ask questions, book visits and hand people to your team. Start from a template and change the words." />
      <AutomationsList automations={automations} canEdit={can(role, "automations")} socialReady={social > 0} />
    </div>
  );
}
