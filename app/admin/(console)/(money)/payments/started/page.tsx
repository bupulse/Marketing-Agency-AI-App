import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { Clock3 } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { PaymentsStarted } from "@/components/admin/business/money-payments";
import { requirePermission } from "@/lib/admin/auth";
import { listManualPayments } from "@/lib/billing/momo";

export const metadata = { title: "Payments started" };

/** Payments started but not reported paid (it was a section of /admin/payments). Same permission as Payments. */
export default async function PaymentsStartedPage() {
  await requirePermission(["payments.view", "payments.approve"]); // pages render alongside the layout, so check here too
  const [fx, pending] = await Promise.all([adminMoney().then(moneyFmt), listManualPayments({ status: "pending", limit: 100 })]);
  return (
    <>
      <PageHeader icon={Clock3} tone="green" title="Started, not paid yet" description="Clients who opened the Mobile Money pay screen but have not tapped I've paid." back={{ href: "/admin/payments", label: "Payments" }} />
      <PaymentsStarted fx={fx} started={pending.items.filter((p) => !p.submitted)} />
    </>
  );
}
