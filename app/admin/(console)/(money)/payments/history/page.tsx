import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { History } from "lucide-react";
import { PageHeader, chosen } from "@/components/admin/kit";
import { HISTORY_FILTERS, PaymentsHistory } from "@/components/admin/business/money-payments";
import { requirePermission } from "@/lib/admin/auth";
import { listManualPayments } from "@/lib/billing/momo";

export const metadata = { title: "Payment history" };

/** Decided payments, newest first, with a status filter (it was a section of /admin/payments). Same permission. */
export default async function PaymentsHistoryPage({ searchParams }: PageProps<"/admin/payments/history">) {
  await requirePermission(["payments.view", "payments.approve"]); // pages render alongside the layout, so check here too
  const [fx, sp, history] = await Promise.all([adminMoney().then(moneyFmt), searchParams, listManualPayments({ limit: 100 })]);
  return (
    <>
      <PageHeader icon={History} tone="green" title="Payment history" description="Mobile Money payments you confirmed or rejected, and the ones that expired." back={{ href: "/admin/payments", label: "Payments" }} />
      <PaymentsHistory fx={fx} sp={sp} status={chosen(sp, "status", HISTORY_FILTERS, "")} decided={history.items.filter((p) => p.status !== "pending")} />
    </>
  );
}
