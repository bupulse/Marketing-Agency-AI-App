import { notFound, redirect } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { AutomationEditor } from "@/components/automations/editor";
import { can } from "@/lib/team/roles";
import { listFields, listTags } from "@/lib/contacts/service";
import { getAutomation } from "@/lib/automations/service";

export const metadata = { title: "Automation" };

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const blocked = await featureGate("automations");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  if (!can(role, "automations")) redirect("/dashboard/no-access?need=automations");
  const { id } = await params;
  const automation = await getAutomation(business.id, id.slice(0, 60));
  if (!automation) notFound();
  const [fields, tags] = await Promise.all([listFields(business.id), listTags(business.id)]);
  return <AutomationEditor automation={automation} fields={fields.map((f) => ({ key: f.key, label: f.label }))} tags={tags.map((t) => t.name)} businessName={business.name} />;
}
