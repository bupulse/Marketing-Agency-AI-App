import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import Link from "next/link";
import { FileText } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Input, type BadgeTone } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listInvoices } from "@/lib/invoices/service";
import { INVOICE_STATUS_LABEL, longInvoiceDate } from "@/lib/invoices/shared";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const TONE: Record<string, BadgeTone> = { draft: "neutral", sent: "blue", paid: "success", void: "neutral" };
const FILTERS = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "sent", label: "Sent" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("payments.view"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const sp = await searchParams;
  const status = FILTERS.find((f) => f.key === param(sp.status))?.key ?? "";
  const q = param(sp.q).slice(0, 80);
  const businessId = param(sp.businessId).slice(0, 64);
  const invoices = await listInvoices({ status: status || undefined, q: q || undefined, businessId: businessId || undefined });
  const qs = (s: string) => `/admin/invoices?${new URLSearchParams({ ...(s && { status: s }), ...(q && { q }), ...(businessId && { businessId }) })}`;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Invoices to clients, mostly from Activate account → No trial, send invoice after a demo. Paying one (Mobile Money with the invoice number as the reference, card, or marked paid here) switches the plan on."
        action={<Link href="/admin/invoices/settings" className="glass inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium no-underline">Invoice settings</Link>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <Panel
        title={`${invoices.length} ${invoices.length === 1 ? "invoice" : "invoices"}${businessId ? " for this company" : ""}`}
        action={
          <form className="flex flex-wrap items-center gap-2" role="search">
            <nav aria-label="Status" className="flex flex-wrap gap-1 rounded-full bg-soft p-1">
              {FILTERS.map((f) => (
                <Link key={f.key || "all"} href={qs(f.key)} aria-current={status === f.key ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium no-underline ${status === f.key ? "bg-surface text-text shadow-glass" : "text-muted"}`}>
                  {f.label}
                </Link>
              ))}
            </nav>
            {status && <input type="hidden" name="status" value={status} />}
            {businessId && <input type="hidden" name="businessId" value={businessId} />}
            <Input name="q" defaultValue={q} placeholder="Number or company" aria-label="Search invoices" className="w-48" maxLength={80} />
            <button type="submit" className="glass inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-sm font-medium">Search</button>
          </form>
        }
      >
        {invoices.length === 0 ? (
          <EmptyState icon={FileText} title="No invoices here" text="After a demo, open Demos (or the company page) and choose Activate account → No trial, send invoice." />
        ) : (
          <TableWrap caption="Invoices">
            <thead>
              <tr><Th>Number</Th><Th>Company</Th><Th>Plan</Th><Th right>Total</Th><Th>Issued</Th><Th>Due</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <Td><Link href={`/admin/invoices/${i.id}`} className="font-mono font-semibold underline">{i.number}</Link></Td>
                  <Td className="max-w-[14rem]"><Link href={`/admin/companies/${i.businessId}`} className="block truncate underline">{i.company}</Link></Td>
                  <Td>{i.planLabel ?? <span className="text-muted">None</span>}</Td>
                  <Td right>{fx.el(i.totalMinor, i.currency)}</Td>
                  <Td className="whitespace-nowrap">{longInvoiceDate(i.issueDate)}</Td>
                  <Td className="whitespace-nowrap">{longInvoiceDate(i.dueDate)}</Td>
                  <Td>
                    <Badge tone={i.overdue ? "danger" : (TONE[i.status] ?? "neutral")}>{i.overdue ? "Overdue" : INVOICE_STATUS_LABEL[i.status]}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
