import { PageHeader } from "@/components/app";
import { UsageView } from "@/components/admin/clients/usage-view";
import { requireAdmin } from "@/lib/admin/auth";
import { getClientRows } from "@/lib/admin/client-health";
import { param } from "@/lib/admin/format";

export const metadata = { title: "Usage per client" };

export default async function UsagePage({ searchParams }: PageProps<"/admin/usage">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const s = param((await searchParams).sort);
  const sort = s === "margin" || s === "name" ? s : "cost";
  const rows = await getClientRows();
  return (
    <>
      <PageHeader title="Usage per client" description="What each client used this period, what it cost in AI this month, what they pay, and the margin." />
      <UsageView rows={rows} sort={sort} />
    </>
  );
}
