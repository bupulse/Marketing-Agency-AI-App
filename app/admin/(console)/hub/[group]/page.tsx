import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/auth";
import { hubGroup, hubPermissions } from "@/components/admin/nav";
import { HubContent } from "../hub-content";

export const metadata = { title: "Area" };

/**
 * The hubs whose own path is taken by a page (/admin/sales is My clients, /admin/content is Content performance...):
 * /admin/hub/sales, /admin/hub/content, /admin/hub/ai, /admin/hub/organisation. A group whose hub lives elsewhere
 * (/admin/money) is sent there.
 */
export default async function GroupHubPage({ params, searchParams }: PageProps<"/admin/hub/[group]">) {
  const { group: id } = await params;
  const group = hubGroup(id);
  if (!group) notFound();
  if (group.hub !== `/admin/hub/${id}`) redirect(group.hub!);
  const me = await requirePermission(hubPermissions(group));
  return <HubContent group={group} me={me} searchParams={await searchParams} />;
}
