import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listRegionsAdmin } from "@/lib/admin/regions-service";
import { NewRegionView } from "@/components/admin/system/regions-view";

export const metadata = { title: "New region" };
export const dynamic = "force-dynamic";

export default async function NewRegionPage({ searchParams }: PageProps<"/admin/settings/regions/new">) {
  await requirePermission("plans.manage");
  const sp = await searchParams;
  return <NewRegionView d={await listRegionsAdmin()} bad={param(sp.error)} />;
}
