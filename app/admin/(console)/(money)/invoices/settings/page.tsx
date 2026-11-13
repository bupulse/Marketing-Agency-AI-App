import Link from "next/link";
import { Image as ImageIcon, PenLine, Settings2 } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { PageHeader } from "@/components/admin/kit";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { Panel } from "@/components/admin/ui";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { Button, Field, Input, PhoneInput, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { getVatSettings } from "@/lib/billing/vat-server";
import { vatRateFor } from "@/lib/billing/vat";
import { sampleInvoiceDocument } from "@/lib/invoices/service";
import { getInvoiceSettings, logoDataUrl } from "@/lib/invoices/settings";
import { defaultPaymentInstructions, INVOICE_SETTING_LIMITS as L } from "@/lib/invoices/shared";
import { removeInvoiceLogoAction, saveInvoiceSettingsAction, uploadInvoiceLogoAction } from "../actions";

export const metadata = { title: "Invoice settings" };
export const dynamic = "force-dynamic";

export default async function InvoiceSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("payments.view"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [s, momo, sample, vat] = await Promise.all([getInvoiceSettings(), getMomoSettings(), sampleInvoiceDocument(), getVatSettings()]);
  const logoSrc = await logoDataUrl(s.logoPath, s.logoType);
  // The payment text starts as the one built from where clients pay by Mobile Money (Payments -> Where clients pay).
  const instructions = s.paymentInstructions || defaultPaymentInstructions(momo);

  return (
    <>
      <PageHeader
        icon={Settings2}
        tone="green"
        title="Invoice settings"
        description="What every invoice shows about BuPulse: logo, details, tax, how to pay and colour. Drafts and new invoices use these; a sent invoice keeps what it was sent with."
        back={{ href: "/admin/invoices", label: "All invoices" }}
      />
      <MoneyNotices sp={sp} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel icon={ImageIcon} tone="green" title="Logo" description="PNG or JPEG, at most 512 KB and 2000 × 2000 pixels. Stored privately; printed at the top left of every invoice.">
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

          <Panel icon={PenLine} tone="green" title="Details and texts" description="Every change is audited.">
            <form action={saveInvoiceSettingsAction} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business / legal name" required><Input name="businessName" defaultValue={s.businessName} maxLength={L.businessName} required /></Field>
                <Field label="Email"><Input name="email" type="email" defaultValue={s.email} maxLength={L.email} /></Field>
                <PhoneInput name="phone" label="Phone" defaultValue={s.phone} />
                <Field label="Website"><Input name="website" defaultValue={s.website} maxLength={L.website} placeholder="https://bupulse.com" /></Field>
                <div className="flex flex-col gap-1 rounded-2xl bg-soft px-4 py-3 text-[14px] sm:col-span-2">
                  <span className="font-semibold">TIN and VAT</span>
                  <span className="text-muted">
                    {vatRateFor("RWF", vat) ? `Rwanda (RWF) invoices add ${vatRateFor("RWF", vat)}% VAT to the prices you type.` : "No region has VAT: invoices have no VAT line."} The rate is set per region in{" "}
                    <Link href="/admin/settings/regions" className="font-semibold underline">Regions</Link>; an invoice keeps the rate it was written with. USD invoices never get VAT.{" "}
                    {vat.tin || s.tin ? `TIN printed: ${vat.tin || s.tin}.` : "No TIN yet: invoices are printed without one."}{" "}
                    <Link href="/admin/settings/vat" className="font-semibold underline">Change the TIN in Settings, VAT</Link>
                  </span>
                </div>
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
          <p className="mb-2 px-1 text-[13px] font-semibold text-muted">Preview with a made-up client</p>
          <InvoicePreview doc={sample.doc} logoSrc={logoSrc} />
        </div>
      </div>
    </>
  );
}
