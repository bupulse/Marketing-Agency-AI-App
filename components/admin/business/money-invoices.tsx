import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { DataList, EmptyState, FilterChips, StatusPill, type PillTone, type SearchParamsLike } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { Button, Input } from "@/components/ui";
import type { InvoiceListItem } from "@/lib/invoices/service";
import { INVOICE_STATUS_LABEL, longInvoiceDate } from "@/lib/invoices/shared";

// Admin -> Money -> Invoices: the list (status chips, search, a table on a computer and cards on a phone). Plain data
// in: the page loads it, the dev preview passes made-up rows.

export const INVOICE_TONE: Record<string, PillTone> = { draft: "muted", sent: "info", paid: "good", void: "muted" };
export const INVOICE_FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "sent", label: "Sent" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

/** An invoice's state in words: Overdue beats Sent. */
export function InvoiceStatus({ status, overdue }: { status: string; overdue: boolean }) {
  return <StatusPill tone={overdue ? "bad" : (INVOICE_TONE[status] ?? "muted")} dot>{overdue ? "Overdue" : (INVOICE_STATUS_LABEL[status as keyof typeof INVOICE_STATUS_LABEL] ?? status)}</StatusPill>;
}

export function InvoicesList({ invoices, status, q, businessId, sp, fx = BOOKS_FMT }: { invoices: InvoiceListItem[]; status: string; q: string; businessId: string; sp: SearchParamsLike; fx?: MoneyFmt }) {
  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterChips label="Show invoices" param="status" base="/admin/invoices" params={sp} current={status} options={INVOICE_FILTERS} />
        <form className="flex w-full gap-2 lg:w-auto" role="search">
          {status && <input type="hidden" name="status" value={status} />}
          {businessId && <input type="hidden" name="businessId" value={businessId} />}
          <Input name="q" defaultValue={q} placeholder="Number or company" aria-label="Search invoices" className="min-w-0 flex-1 lg:w-56" maxLength={80} />
          <Button type="submit" variant="outline" leading={<Search aria-hidden className="size-4" />}>Search</Button>
        </form>
      </div>
      <Panel icon={FileText} tone="green" title={`${invoices.length} ${invoices.length === 1 ? "invoice" : "invoices"}${businessId ? " for this company" : ""}`} description="Newest first. Open one to send, resend, mark paid or void it.">
        <DataList<InvoiceListItem>
          caption="Invoices"
          rows={invoices}
          rowKey={(i) => i.id}
          rowHref={(i) => `/admin/invoices/${i.id}`}
          columns={[
            { key: "number", header: "Number", cell: (i) => <span className="font-mono">{i.number}</span>, primary: true },
            { key: "company", header: "Company", cell: (i) => <Link href={`/admin/companies/${i.businessId}`} className="block max-w-[14rem] truncate underline-offset-2 hover:underline">{i.company}</Link> },
            { key: "total", header: "Total", cell: (i) => <span className="font-semibold">{fx.el(i.totalMinor, i.currency)}</span>, align: "right" },
            { key: "status", header: "Status", cell: (i) => <InvoiceStatus status={i.status} overdue={i.overdue} /> },
            { key: "due", header: "Due", cell: (i) => <span className="whitespace-nowrap">{longInvoiceDate(i.dueDate)}</span> },
            { key: "plan", header: "Plan", cell: (i) => i.planLabel ?? <span className="text-muted">None</span>, hideOnPhone: true },
            { key: "issued", header: "Issued", cell: (i) => <span className="whitespace-nowrap">{longInvoiceDate(i.issueDate)}</span>, hideOnPhone: true },
          ]}
          empty={<EmptyState icon={FileText} title="No invoices here" hint="After a demo, open Demos (or the company page) and choose Activate account → No trial, send invoice." />}
        />
      </Panel>
    </>
  );
}
