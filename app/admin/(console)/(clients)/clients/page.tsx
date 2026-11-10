import { requirePermission } from "@/lib/admin/auth";
import { hubGroup, hubPermissions } from "@/components/admin/nav";
import { HubContent } from "../../hub/hub-content";

export const metadata = { title: "Clients" };

/** The Clients hub: a card for each Clients page the viewer may open (Companies, Users, Client health, Demos...). */
export default async function ClientsHubPage({ searchParams }: PageProps<"/admin/clients">) {
  const group = hubGroup("clients")!;
  const me = await requirePermission(hubPermissions(group));
  return <HubContent group={group} me={me} searchParams={await searchParams} />;
}
