import { requirePermission } from "@/lib/admin/auth";
import { hubGroup, hubPermissions } from "@/components/admin/nav";
import { HubContent } from "../../hub/hub-content";

export const metadata = { title: "Money" };

/** The Money hub: a card for each Money page the viewer may open (Revenue, Payments, Invoices, Plans, Costs...). */
export default async function MoneyHubPage({ searchParams }: PageProps<"/admin/money">) {
  const group = hubGroup("money")!;
  const me = await requirePermission(hubPermissions(group));
  return <HubContent group={group} me={me} searchParams={await searchParams} />;
}
