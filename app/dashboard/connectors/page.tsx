import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { ConnectorsView } from "@/components/connectors/connectors-view";
import { getCatalog } from "@/lib/connectors/catalog";

export const metadata = { title: "Connectors" };

export default async function ConnectorsPage({ searchParams }: PageProps<"/dashboard/connectors">) {
  const blocked = await pageGate("connectors");
  if (blocked) return blocked;
  const [{ actorId, business, entitlements }, sp] = await Promise.all([getAppContext(), searchParams]);
  // Canva is personal (each teammate links their own account); everything else in the catalog belongs to the company.
  const items = await getCatalog({ userId: actorId, businessId: business.id, features: entitlements.inPlan });
  const group = typeof sp.group === "string" ? sp.group : "";

  return <ConnectorsView items={items} group={group} params={sp} />;
}
