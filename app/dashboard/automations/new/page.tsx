import { redirect } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { NewAutomationScreen } from "@/components/automations/automations-screen";
import { prisma } from "@/lib/db";
import { can } from "@/lib/team/roles";

export const metadata = { title: "New automation" };

/** The templates to start a new automation from (moved off the list page, 12 November 2026). */
export default async function NewAutomationPage() {
  const blocked = await featureGate("automations");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  if (!can(role, "automations")) redirect("/dashboard/automations");
  const social = await prisma.connection.count({ where: { businessId: business.id, provider: { in: ["instagram", "facebook"] }, inboxEnabled: true } });
  return <NewAutomationScreen canEdit socialReady={social > 0} />;
}
