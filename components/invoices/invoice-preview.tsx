import { formatInvoiceMoney, longInvoiceDate, type InvoiceDocument } from "@/lib/invoices/shared";

/**
 * The invoice as a page, in HTML: the same layout as the PDF (lib/invoices/pdf.ts), for the editor's live preview and
 * the settings preview. Always paper-white with dark ink, whatever the console theme, like the printed invoice.
 */
export function InvoicePreview({ doc, logoSrc }: { doc: InvoiceDocument; logoSrc?: string | null }) {
  const money = (minor: number) => formatInvoiceMoney(minor, doc.currency);
  const accent = doc.seller.accentColor;
  const d = doc.payment.details;
  const payRows: [string, string][] =
    doc.status === "paid"
      ? [["Reference", doc.payment.reference], ...(doc.paidAt ? ([["Paid on", longInvoiceDate(doc.paidAt)]] as [string, string][]) : [])]
      : [
          ...(d.merchantCode ? ([["MoMo Pay code", d.merchantCode]] as [string, string][]) : []),
          ...(d.momoNumber ? ([["MTN MoMo number", d.momoNumber]] as [string, string][]) : []),
          ...(d.airtelNumber ? ([["Airtel Money number", d.airtelNumber]] as [string, string][]) : []),
          ...(d.accountName ? ([["Account name", d.accountName]] as [string, string][]) : []),
          ["Reference", `Use reference ${doc.payment.reference}`],
          ["Pay online", doc.payment.payUrl],
        ];
  return (
    <article aria-label={`Preview of invoice ${doc.number}`} className="overflow-hidden rounded-xl bg-white text-[13px] leading-snug text-[#1c1c1f] shadow-glass ring-1 ring-black/5">
      <div style={{ background: accent }} className="h-1.5" />
      <div className="flex flex-col gap-6 p-5 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL or a short-lived private link */}
            {logoSrc && <img src={logoSrc} alt="" className="mb-2 max-h-12 max-w-[150px] object-contain object-left" />}
            <strong className={logoSrc ? "text-[15px]" : "text-[22px]"}>{doc.seller.businessName}</strong>
            {[doc.seller.address, doc.seller.email, doc.seller.phone, doc.seller.website, doc.seller.tin ? `TIN: ${doc.seller.tin}` : ""].filter(Boolean).map((l) => (
              <span key={l} className="whitespace-pre-line text-[12px] text-[#6e6e73]">{l}</span>
            ))}
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span style={{ color: accent }} className="text-[28px] font-bold leading-none tracking-tight">INVOICE</span>
            <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[12px]">
              <dt className="text-[#6e6e73]">Invoice no.</dt><dd className="font-semibold">{doc.number}</dd>
              <dt className="text-[#6e6e73]">Issue date</dt><dd>{longInvoiceDate(doc.issueDate)}</dd>
              <dt className="text-[#6e6e73]">Due date</dt><dd>{longInvoiceDate(doc.dueDate)}</dd>
              {doc.planLabel && (<><dt className="text-[#6e6e73]">Plan</dt><dd>{doc.planLabel}</dd></>)}
            </dl>
            {doc.status === "paid" && <span className="mt-1 border-2 border-[#21893f] px-2 py-0.5 text-[12px] font-bold text-[#21893f]">PAID{doc.paidAt ? ` ${longInvoiceDate(doc.paidAt).toUpperCase()}` : ""}</span>}
            {doc.status === "void" && <span className="mt-1 border-2 border-[#bf2929] px-2 py-0.5 text-[12px] font-bold text-[#bf2929]">VOID</span>}
            {doc.status === "draft" && <span className="mt-1 text-[12px] font-bold text-[#6e6e73]">DRAFT</span>}
          </div>
        </header>

        <section aria-label="Bill to" className="flex flex-col gap-0.5">
          <span style={{ color: accent }} className="text-[11px] font-bold tracking-wide">BILL TO</span>
          <strong className="text-[15px]">{doc.billTo.businessName}</strong>
          {[doc.billTo.ownerName, doc.billTo.phone, doc.billTo.email, doc.billTo.address, doc.billTo.country].filter(Boolean).map((l) => (
            <span key={l} className="text-[12px] text-[#6e6e73]">{l}</span>
          ))}
        </section>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[12px]">
            <thead>
              <tr style={{ background: `${accent}1F` }}>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Description</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Unit price</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-3 text-[#6e6e73]">No lines yet.</td></tr>
              ) : (
                doc.lines.map((l, i) => (
                  <tr key={i} className="border-b border-[#e0e0e5]">
                    <td className="break-words px-3 py-2">{l.description || <span className="text-[#6e6e73]">(no description)</span>}</td>
                    <td className="px-3 py-2 text-right">{l.quantity}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{money(l.unitMinor)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{money(l.quantity * l.unitMinor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto grid w-full max-w-[260px] grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[12px]">
          <dt className="text-[#6e6e73]">Subtotal</dt><dd className="text-right">{money(doc.subtotalMinor)}</dd>
          {doc.taxRatePercent ? (<><dt className="text-[#6e6e73]">VAT ({doc.taxRatePercent}%)</dt><dd className="text-right">{money(doc.taxMinor)}</dd></>) : null}
          <dt style={{ background: accent }} className="mt-1 px-2 py-1.5 font-bold text-white">{doc.status === "paid" ? "Total paid" : "Total due"}</dt>
          <dd style={{ background: accent }} className="mt-1 px-2 py-1.5 text-right font-bold text-white">{money(doc.totalMinor)}</dd>
        </dl>

        {doc.status !== "void" && (
          <section aria-label="How to pay" style={{ borderColor: `${accent}66`, background: `${accent}0F` }} className="flex flex-col gap-2 rounded-lg border p-4">
            <span style={{ color: accent }} className="text-[11px] font-bold tracking-wide">{doc.status === "paid" ? "PAYMENT RECEIVED" : "HOW TO PAY"}</span>
            <p className="whitespace-pre-line">{doc.status === "paid" ? "Thank you. This invoice is paid in full." : doc.payment.instructions}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12px]">
              {payRows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[#6e6e73]">{k}</dt>
                  <dd className={k === "Reference" || k === "MoMo Pay code" ? "break-all font-semibold" : "break-all"}>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {doc.notes && (
          <section aria-label="Notes" className="flex flex-col gap-1">
            <span style={{ color: accent }} className="text-[11px] font-bold tracking-wide">NOTES</span>
            <p className="whitespace-pre-line">{doc.notes}</p>
          </section>
        )}

        <footer className="flex flex-wrap justify-between gap-2 border-t border-[#e0e0e5] pt-3 text-[11px] text-[#6e6e73]">
          <span>{doc.seller.footer || doc.seller.businessName}</span>
          <span>{doc.number} · Page 1</span>
        </footer>
      </div>
    </article>
  );
}
