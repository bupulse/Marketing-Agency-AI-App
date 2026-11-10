import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { PaymentsCardEvents } from "@/components/admin/business/money-payments";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { requirePermission } from "@/lib/admin/auth";
import { listUnprocessedPaddleEvents } from "@/lib/billing/paddle-events";

export const metadata = { title: "Card events not applied" };

/** Card events not applied (it was /admin/payments#card-events; Reprocess comes back here). Same permission as Payments. */
export default async function PaymentsCardEventsPage({ searchParams }: PageProps<"/admin/payments/card-events">) {
  await requirePermission(["payments.view", "payments.approve"]); // pages render alongside the layout, so check here too
  const [sp, events] = await Promise.all([searchParams, listUnprocessedPaddleEvents()]);
  return (
    <>
      <PageHeader icon={CreditCard} tone="green" title="Card events not applied" description="Card payment events from Paddle that BuPulse could not apply yet." back={{ href: "/admin/payments", label: "Payments" }} />
      <MoneyNotices sp={sp} />
      <PaymentsCardEvents events={events} />
    </>
  );
}
