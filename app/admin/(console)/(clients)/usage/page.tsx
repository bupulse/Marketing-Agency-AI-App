import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { UsageView } from "@/components/admin/clients/usage-view";
import { requirePermission } from "@/lib/admin/auth";
import { getClientRows } from "@/lib/admin/client-health";
import { param } from "@/lib/admin/format";

export const metadata = { title: "Usage per client" };

export default async function UsagePage({ searchParams }: PageProps<"/admin/usage">) {
  await requirePermission("clients.view"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const s = param((await searchParams).sort);
  const sort = s === "margin" || s === "name" ? s : "cost";
  const rows = await getClientRows();
  return (
    <>
      <PageHeader icon={LayoutGrid} tone="blue" title="Usage per client" description="What each client used this period, what their AI cost this month, what they pay, and what is left (the margin)." />
      <UsageView rows={rows} sort={sort} fx={fx} />
    </>
  );
}
