import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { AutomationsScreen } from "@/components/automations/automations-screen";
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
  return <AutomationsScreen automations={automations} canEdit={can(role, "automations")} socialReady={social > 0} />;
}
