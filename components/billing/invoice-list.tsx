import { Badge, GlassCard } from "@/components/ui";
import type { Invoice } from "@/lib/billing/types";
import { formatDate } from "./helpers";
import { ReceiptButton } from "./receipt-button";

/** Receipts and invoices, newest first. */
export function InvoiceList({ invoices }: { invoices: Invoice[] }) {
  return (
    <GlassCard as="section" aria-labelledby="invoices-heading" className="flex flex-col gap-3 p-5 sm:p-6">
      <h2 id="invoices-heading" className="text-lg font-semibold">
        Receipts and invoices
      </h2>
      {invoices.length === 0 ? (
        <p className="text-sm text-muted">No payments yet. Your receipts will appear here after your first payment.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-[15px]">
              <span className="min-w-[8.5rem] font-medium">{formatDate(invoice.date)}</span>
              <span>{invoice.amount}</span>
              <Badge tone={invoice.status.toLowerCase() === "paid" || invoice.status.toLowerCase() === "completed" ? "success" : "neutral"} className="capitalize">
                {invoice.status.replace(/_/g, " ")}
              </Badge>
              <ReceiptButton id={invoice.id} url={invoice.url} />
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
