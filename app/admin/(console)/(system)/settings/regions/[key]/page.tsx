import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listRegionsAdmin } from "@/lib/admin/regions-service";
import { RegionEditor } from "@/components/admin/system/regions-view";

export const metadata = { title: "Region" };
export const dynamic = "force-dynamic";

export default async function RegionPage({ params, searchParams }: PageProps<"/admin/settings/regions/[key]">) {
  await requirePermission("plans.manage");
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const d = await listRegionsAdmin();
  const region = d.regions.find((r) => r.key === decodeURIComponent(key).toUpperCase());
  if (!region) notFound();
  return <RegionEditor d={d} r={region} ok={param(sp.notice)} bad={param(sp.error)} />;
}
