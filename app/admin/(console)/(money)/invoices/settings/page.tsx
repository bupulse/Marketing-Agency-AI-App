import Link from "next/link";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel, notice } from "@/components/admin/ui";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { sampleInvoiceDocument } from "@/lib/invoices/service";
import { getInvoiceSettings, logoDataUrl } from "@/lib/invoices/settings";
import { defaultPaymentInstructions, INVOICE_SETTING_LIMITS as L } from "@/lib/invoices/shared";
import { removeInvoiceLogoAction, saveInvoiceSettingsAction, uploadInvoiceLogoAction } from "../actions";

export const metadata = { title: "Invoice settings" };
export const dynamic = "force-dynamic";

export default async function InvoiceSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("payments.view"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [s, momo, sample] = await Promise.all([getInvoiceSettings(), getMomoSettings(), sampleInvoiceDocument()]);
  const logoSrc = await logoDataUrl(s.logoPath, s.logoType);
  // The payment text starts as the one built from where clients pay by Mobile Money (Payments -> Where clients pay).
  const instructions = s.paymentInstructions || defaultPaymentInstructions(momo);

  return (
    <>
      <PageHeader title="Invoice settings" description="What every invoice shows about BuPulse: logo, details, tax, payment instructions and colour. Drafts and new invoices use these; a sent invoice keeps what it was sent with. Every change is audited." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <Link href="/admin/invoices" className="inline-flex min-h-11 items-center self-start px-2 text-sm font-medium underline">All invoices</Link>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Logo" description="PNG or JPEG, at most 512 KB and 2000 × 2000 pixels. Stored privately; printed at the top left of every invoice.">
            <form action={uploadInvoiceLogoAction} className="flex flex-wrap items-end gap-3">
              <Field label="Logo file">
                <Input name="logo" type="file" accept="image/png,image/jpeg" required />
              </Field>
              <Button type="submit">Upload</Button>
            </form>
            {s.logoPath && (
              <ConfirmButton action={removeInvoiceLogoAction} fields={{}} label="Remove logo" title="Remove the invoice logo?" description="New invoices show the business name instead. Sent invoices keep theirs. Written to the audit log." confirmLabel="Remove" />
            )}
          </Panel>

          <Panel title="Details and texts">
            <form action={saveInvoiceSettingsAction} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business / legal name" required><Input name="businessName" defaultValue={s.businessName} maxLength={L.businessName} required /></Field>
                <Field label="Email"><Input name="email" type="email" defaultValue={s.email} maxLength={L.email} /></Field>
                <Field label="Phone"><Input name="phone" defaultValue={s.phone} maxLength={L.phone} inputMode="tel" /></Field>
                <Field label="Website"><Input name="website" defaultValue={s.website} maxLength={L.website} placeholder="https://bupulse.com" /></Field>
                <Field label="TIN (optional)" hint="Printed when filled in."><Input name="tin" defaultValue={s.tin} maxLength={L.tin} /></Field>
                <Field label="VAT rate % (optional)" hint="Empty = no tax line (the default). 18 adds an 18% VAT line."><Input name="vatRatePercent" defaultValue={s.vatRatePercent ?? ""} inputMode="decimal" placeholder="None" /></Field>
                <Field label="Accent colour" hint="Headings, the total and the top band.">
                  <Input name="accentColor" type="color" defaultValue={s.accentColor} className="h-11 w-24 p-1" />
                </Field>
              </div>
              <Field label="Address"><Textarea name="address" defaultValue={s.address} rows={2} maxLength={L.address} /></Field>
              <Field label="Payment instructions" hint="Printed under How to pay. Starts from your Mobile Money details; the MoMo code, numbers and the invoice number as the reference are printed below it anyway.">
                <Textarea name="paymentInstructions" defaultValue={instructions} rows={3} maxLength={L.paymentInstructions} />
              </Field>
              <Field label="Footer"><Input name="footer" defaultValue={s.footer} maxLength={L.footer} /></Field>
              <Button type="submit" className="self-start">Save invoice settings</Button>
            </form>
          </Panel>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-sm text-muted">Preview with a made-up client</p>
          <InvoicePreview doc={sample.doc} logoSrc={logoSrc} />
        </div>
      </div>
    </>
  );
}
