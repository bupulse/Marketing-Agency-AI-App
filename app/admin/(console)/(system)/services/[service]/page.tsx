import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { isServiceId, serviceInfo } from "@/lib/admin/service-catalog";
import { listServicesWithKeys } from "@/lib/admin/services";
import { ServiceDetail } from "@/components/admin/system/services/service-detail";

export async function generateMetadata({ params }: PageProps<"/admin/services/[service]">) {
  const { service } = await params;
  return { title: isServiceId(service) ? serviceInfo(service).name : "Services" };
}

/** One outside service (Admin -> Services -> a card): its keys, Test now, the on/off switch, its last error and usage. */
export default async function ServicePage({ params, searchParams }: PageProps<"/admin/services/[service]">) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const [{ service }, sp] = await Promise.all([params, searchParams]);
  if (!isServiceId(service)) notFound();
  const { services } = await listServicesWithKeys();
  const s = services.find((x) => x.id === service);
  if (!s) notFound();
  return <ServiceDetail s={s} ok={param(sp.notice)} bad={param(sp.error)} />;
}
