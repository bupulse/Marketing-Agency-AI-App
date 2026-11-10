import { requirePermission } from "@/lib/admin/auth";
import { hubGroup, hubPermissions } from "@/components/admin/nav";
import { HubContent } from "../../hub/hub-content";

export const metadata = { title: "System" };

/** The System hub: a card for each System page (Health, Services, Errors, Activity, Audit, Flags, Settings, Updates). */
export default async function SystemHubPage({ searchParams }: PageProps<"/admin/system">) {
  const group = hubGroup("system")!;
  const me = await requirePermission(hubPermissions(group));
  return <HubContent group={group} me={me} searchParams={await searchParams} />;
}
