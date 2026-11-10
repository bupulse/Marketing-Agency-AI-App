import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Download, Eye, FileText } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { InvoiceEditor } from "@/components/admin/invoice-editor";
import { CARD, DataList, PageHeader, StatusPill } from "@/components/admin/kit";
import { InvoiceStatus } from "@/components/admin/business/money-invoices";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { Panel, notice } from "@/components/admin/ui";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { buttonClasses, Field, Input, Select, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/types";
import { getInvoiceSettings, logoDataUrl } from "@/lib/invoices/settings";
import { getInvoiceRow, invoiceDocument, invoicePayments, MANUAL_PAY_LABEL, MANUAL_PAY_METHODS } from "@/lib/invoices/service";
import { formatInvoiceMoney, INVOICE_STATUS_LABEL, isOverdue, longInvoiceDate, readPaymentReviews, ymdOf } from "@/lib/invoices/shared";
import { prisma } from "@/lib/db";
import { markInvoicePaidAction, resendInvoiceAction, voidInvoiceAction } from "../actions";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

const PAY_TONE = { confirmed: "good", rejected: "bad", pending: "new" } as const;

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("payments.view"); // pages render alongside the layout, so check here too
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  let row;
  try {
    row = await getInvoiceRow(id);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  const [{ doc, logo }, payments, settings, owner] = await Promise.all([
    invoiceDocument(row),
    invoicePayments(row.id),
    getInvoiceSettings(),
    prisma.business.findUnique({ where: { id: row.businessId }, select: { name: true, user: { select: { email: true } } } }),
  ]);
  const logoSrc = await logoDataUrl(logo.path, logo.type);
  const overdue = isOverdue(row);
  const total = formatInvoiceMoney(row.totalMinor, row.currency);
  // A draft is priced with the current VAT setting (saving applies it); the preview shows the same.
  const draftDoc = row.status === "draft" ? { ...doc, taxRatePercent: settings.vatRatePercent } : doc;
  const received = row.status === "sent" ? readPaymentReviews(row.paymentReview) : [];
  const pdfHref = `/admin/invoices/${row.id}/pdf`;

  return (
    <>
      <PageHeader
        icon={FileText}
        tone="green"
        title={`Invoice ${row.number}`}
        description={`${owner?.name ?? "A company"} · ${total} · due ${longInvoiceDate(row.dueDate)}`}
        back={{ href: "/admin/invoices", label: "All invoices" }}
        actions={<InvoiceStatus status={row.status} overdue={overdue} />}
      />
      <MoneyNotices sp={sp} />
      {received.length > 0 && (
        <div role="alert" className={notice.bad}>
          <p className="font-semibold">{received.length > 1 ? "Payments received" : "Payment received"}: check and mark paid. {received.length > 1 && "More than one payment came in: possible double payment, refund the extra one."}</p>
          <ul className="list-disc pl-5">
            {received.map((r) => (
              <li key={`${r.source}:${r.reference}`}>{formatInvoiceMoney(r.amountMinor, r.currency)} by {r.source === "paddle" ? "card" : "Mobile Money"} ({r.reference}, {dateTime(new Date(r.receivedAt))}); the invoice is for {total}.</li>
            ))}
          </ul>
          <p>It was not marked paid. Check the money, then mark the invoice paid. Reminders keep going until you do.</p>
        </div>
      )}

      <div className={`flex flex-wrap items-center gap-2 p-3 sm:p-4 ${CARD}`}>
        <a href={pdfHref} target="_blank" rel="noopener" className={buttonClasses({ variant: "outline", size: "sm" })}><Eye aria-hidden className="size-4" /> Preview PDF</a>
        <a href={`${pdfHref}?download=1`} className={buttonClasses({ variant: "outline", size: "sm" })}><Download aria-hidden className="size-4" /> Download PDF</a>
        <Link href={`/admin/companies/${row.businessId}`} className={buttonClasses({ variant: "outline", size: "sm" })}><Building2 aria-hidden className="size-4" /> Company</Link>
        {row.status === "sent" && (
          <>
            <ConfirmButton action={resendInvoiceAction} fields={{ id: row.id }} label="Resend email" title={`Email ${row.number} again?`} description={`To ${row.sentTo.join(", ") || "the addresses it was sent to"}, with the same PDF. Written to the audit log.`} confirmLabel="Resend" />
            <ConfirmButton action={markInvoicePaidAction} fields={{ id: row.id }} variant="primary" label="Mark as paid" title={`Mark ${row.number} as paid?`} description={`Only after the ${total} has arrived. ${row.planKey ? "The plan on the invoice switches on (the same as confirming a Mobile Money payment) and the client is emailed." : "The invoice is marked paid."} Written to the audit log.`} confirmLabel="Mark as paid">
              <Field label="How the client paid" required>
                <Select name="method" defaultValue="MTN">
                  {MANUAL_PAY_METHODS.map((m) => (
                    <option key={m} value={m}>{MANUAL_PAY_LABEL[m]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Transaction id or receipt number" required hint="From the Mobile Money message, the bank or your receipt book. A transaction id can pay only once.">
                <Input name="reference" required minLength={4} maxLength={40} autoComplete="off" />
              </Field>
            </ConfirmButton>
          </>
        )}
        {(row.status === "draft" || row.status === "sent") && (
          <ConfirmButton action={voidInvoiceAction} fields={{ id: row.id }} label="Void" title={`Void ${row.number}?`} description={received.length ? "Money was received for this invoice. Voiding it does not return the money: refund the client, or mark the invoice paid instead. Written to the audit log." : "The client can no longer pay it and sees it as void. The number is not reused. Written to the audit log."} confirmLabel="Void invoice">
            <Field label="Reason" required><Textarea name="reason" rows={2} minLength={3} maxLength={300} required placeholder="Wrong plan, re-issued as a new invoice." /></Field>
            {received.length > 0 && (
              <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" name="acknowledgePayment" value="yes" required className="mt-1" /> Money was received for this invoice and I know voiding it does not refund it.</label>
            )}
          </ConfirmButton>
        )}
      </div>

      {row.status === "draft" ? (
        <Panel title="Edit the draft" description="Change lines, quantities, prices, the due date and notes. The preview shows the invoice as it will be sent.">
          <InvoiceEditor
            id={row.id}
            doc={draftDoc}
            logoSrc={logoSrc}
            initial={{ dueDate: ymdOf(row.dueDate), notes: row.notes ?? "", billingEmail: row.billingEmail ?? "" }}
            sendTo={owner?.user.email ?? null}
          />
        </Panel>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel icon={FileText} tone="green" title="Details" description="When it was sent, reminded, paid or voided, and by whom.">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
              <dt className="text-muted">Status</dt><dd>{INVOICE_STATUS_LABEL[row.status as keyof typeof INVOICE_STATUS_LABEL] ?? row.status}{overdue ? " (overdue)" : ""}</dd>
              {row.sentAt && (<><dt className="text-muted">Sent</dt><dd>{dateTime(row.sentAt)} to {row.sentTo.join(", ")}</dd></>)}
              {row.reminderSentAt && (<><dt className="text-muted">Reminder</dt><dd>{dateTime(row.reminderSentAt)}</dd></>)}
              {row.paidAt && (<><dt className="text-muted">Paid</dt><dd>{dateTime(row.paidAt)} · {row.paidBy}</dd></>)}
              {row.voidedAt && (<><dt className="text-muted">Voided</dt><dd>{dateTime(row.voidedAt)} · {row.voidReason}</dd></>)}
              <dt className="text-muted">Stored PDF</dt><dd>{row.pdfPath ? "Yes" : "Not stored (drawn on download)"}</dd>
              <dt className="text-muted">Created</dt><dd>{dateTime(row.createdAt)} by {row.createdBy}</dd>
            </dl>
          </Panel>
          <InvoicePreview doc={doc} logoSrc={logoSrc} />
        </div>
      )}

      {payments.length > 0 && (
        <Panel tone="green" title="Payments for this invoice" description="Mobile Money payments with this invoice number as the reference. Confirm or reject reported ones in Payments.">
          <DataList
            caption="Payments for this invoice"
            rows={payments}
            rowKey={(p) => p.id}
            columns={[
              { key: "amount", header: "Amount", cell: (p) => formatInvoiceMoney(p.amountMinor, p.currency), primary: true },
              { key: "status", header: "Status", cell: (p) => <StatusPill tone={PAY_TONE[p.status as keyof typeof PAY_TONE] ?? "muted"} dot>{p.status}</StatusPill> },
              { key: "tx", header: "Transaction", cell: (p) => <span className="flex flex-col"><span className="font-mono">{p.transactionId ?? ""}</span>{p.network && <span className="text-[13px] text-muted">{p.network}</span>}</span> },
              { key: "reported", header: "Reported", cell: (p) => <span className="whitespace-nowrap">{p.submittedAt ? dateTime(p.submittedAt) : "Not yet"}</span> },
              { key: "decided", header: "Decided", cell: (p) => <span className="whitespace-nowrap">{p.decidedAt ? `${dateTime(p.decidedAt)} · ${p.decidedBy ?? ""}` : p.status === "pending" && p.submittedAt ? <Link href="/admin/payments" className="underline">Decide in Payments</Link> : ""}</span> },
            ]}
          />
        </Panel>
      )}
    </>
  );
}
