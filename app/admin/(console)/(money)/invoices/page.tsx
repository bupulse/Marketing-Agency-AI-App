import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import Link from "next/link";
import { FileText, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { INVOICE_FILTERS, InvoicesList } from "@/components/admin/business/money-invoices";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { buttonClasses } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listInvoices } from "@/lib/invoices/service";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("payments.view"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const sp = await searchParams;
  const status = INVOICE_FILTERS.find((f) => f.value === param(sp.status))?.value ?? "";
  const q = param(sp.q).slice(0, 80);
  const businessId = param(sp.businessId).slice(0, 64);
  const invoices = await listInvoices({ status: status || undefined, q: q || undefined, businessId: businessId || undefined });

  return (
    <>
      <PageHeader
        icon={FileText}
        tone="green"
        title="Invoices"
        description="Invoices to clients, mostly sent after a demo. Paying one (Mobile Money with the invoice number as the reference, card, or marked paid here) switches the plan on."
        actions={
          <Link href="/admin/invoices/settings" className={buttonClasses({ variant: "outline" })}>
            <Settings2 aria-hidden className="size-4" /> Invoice settings
          </Link>
        }
      />
      <MoneyNotices sp={sp} />
      <InvoicesList fx={fx} invoices={invoices} status={status} q={q} businessId={businessId} sp={sp} />
    </>
  );
}
