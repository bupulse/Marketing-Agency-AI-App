import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listRegionsAdmin } from "@/lib/admin/regions-service";
import { RegionsView } from "@/components/admin/system/regions-view";
import { getVatSettings } from "@/lib/billing/vat-server";

export const metadata = { title: "Regions and prices" };
export const dynamic = "force-dynamic";

export default async function RegionsPage({ searchParams }: PageProps<"/admin/settings/regions">) {
  await requirePermission("plans.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [d, vat] = await Promise.all([listRegionsAdmin(), getVatSettings()]);
  return <RegionsView d={d} vat={vat} ok={param(sp.notice)} bad={param(sp.error)} />;
}
