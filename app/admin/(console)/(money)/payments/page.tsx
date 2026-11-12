import { Smartphone } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { PaymentsOverview } from "@/components/admin/business/money-payments";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { can, requirePermission } from "@/lib/admin/auth";
import { listManualPayments } from "@/lib/billing/momo";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { listUnprocessedPaddleEvents } from "@/lib/billing/paddle-events";
import { confirmPaymentAction, rejectPaymentAction } from "./actions";
import { getVatSettings } from "@/lib/billing/vat-server";

export const metadata = { title: "Payments" };

/**
 * Payments: the Mobile Money payments to check (confirm switches the plan on and emails the client; reject sends a
 * reason the client sees), a card for each other list, and where clients pay. Old #card-events links go to that page;
 * #settings stays on this page.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission(["payments.view", "payments.approve"]); // pages render alongside the layout, so check here too
  const canApprove = can(me, "payments.approve");
  const sp = await searchParams;
  const [pendingPage, history, settings, cardEvents, vat] = await Promise.all([
    listManualPayments({ status: "pending", limit: 100 }),
    listManualPayments({ limit: 100 }),
    getMomoSettings(),
    listUnprocessedPaddleEvents(),
    getVatSettings(),
  ]);
  // The screenshots of the payments to check go through the admin-only route (re-sniffed, nosniff; the bucket is private).
  return (
    <>
      <PageHeader icon={Smartphone} tone="green" title="Payments" description="Mobile Money payments clients made by hand. Check each against your MoMo or Airtel messages, then confirm or reject." />
      <MoneyNotices sp={sp} />
      <PaymentsOverview
        toCheck={pendingPage.items.filter((p) => p.submitted)}
        started={pendingPage.items.filter((p) => !p.submitted)}
        cardEvents={cardEvents}
        decided={history.items.filter((p) => p.status !== "pending")}
        settings={settings}
        vat={vat}
        canApprove={canApprove}
        confirmAction={confirmPaymentAction}
        rejectAction={rejectPaymentAction}
      />
    </>
  );
}
