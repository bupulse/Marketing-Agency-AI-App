import { FileDown } from "lucide-react";
import { Badge, GlassCard, type BadgeTone } from "@/components/ui";
import type { ClientInvoice } from "@/lib/invoices/service";
import { INVOICE_STATUS_LABEL, longInvoiceDate } from "@/lib/invoices/shared";

const TONE: Record<string, BadgeTone> = { sent: "blue", paid: "success", void: "neutral" };

/** The company's BuPulse invoices on the Billing page, newest first, each with its PDF. */
export function ClientInvoices({ invoices }: { invoices: ClientInvoice[] }) {
  return (
    <GlassCard as="section" aria-labelledby="bp-invoices-heading" className="flex flex-col gap-3 p-5 sm:p-6">
      <h2 id="bp-invoices-heading" className="text-lg font-semibold">
        Invoices
      </h2>
      <ul className="flex flex-col divide-y divide-line">
        {invoices.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-[15px]">
            <span className="min-w-[8.5rem] font-mono font-medium">{i.number}</span>
            <span className="min-w-[7rem] text-sm text-muted">{i.status === "paid" && i.paidAt ? `Paid ${longInvoiceDate(i.paidAt)}` : `Due ${longInvoiceDate(i.dueDate)}`}</span>
            <span>{i.total}</span>
            <Badge tone={i.overdue ? "danger" : (TONE[i.status] ?? "neutral")}>{i.overdue ? "Overdue" : i.status === "sent" ? "To pay" : INVOICE_STATUS_LABEL[i.status]}</Badge>
            <a href={`/api/invoices/${encodeURIComponent(i.id)}/pdf`} className="glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium no-underline" aria-label={`Download invoice ${i.number} (PDF)`}>
              <FileDown aria-hidden className="size-4" /> PDF
            </a>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}
