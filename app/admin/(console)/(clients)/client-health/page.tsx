import { PageHeader } from "@/components/app";
import { ClientHealthView } from "@/components/admin/clients/health-view";
import { requireAdmin } from "@/lib/admin/auth";
import { getClientRows } from "@/lib/admin/client-health";
import { FLAG_LABEL, type HealthFlag } from "@/lib/admin/client-health-shared";
import { nowMs, param } from "@/lib/admin/format";

export const metadata = { title: "Client health" };

export default async function ClientHealthPage({ searchParams }: PageProps<"/admin/client-health">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const raw = param((await searchParams).flag);
  const flag = raw === "all" ? "all" : raw in FLAG_LABEL ? (raw as HealthFlag) : null;
  const rows = await getClientRows();
  return (
    <>
      <PageHeader title="Client health" description="Who is active, whose trial ends soon, who is late paying or barely using BuPulse, with one-click WhatsApp and email." />
      <ClientHealthView rows={rows} flag={flag} now={nowMs()} />
    </>
  );
}
