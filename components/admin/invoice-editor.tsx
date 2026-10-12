"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Field, Input, Textarea } from "@/components/ui";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { saveInvoiceAction, sendInvoiceAction } from "@/app/admin/(console)/invoices/actions";
import { computeTotals, formatInvoiceMoney, MAX_LINES, moneyInput, parseMoney, validateDraft, type InvoiceDocument, type InvoiceLine } from "@/lib/invoices/shared";

type LineInput = { key: number; description: string; quantity: string; price: string };

/**
 * The draft editor: lines (description, quantity, unit price), due date, notes and a billing contact, with the invoice
 * preview updating as you type. Save keeps it a draft; Send saves what is shown and emails it. The server checks
 * everything again (lib/invoices/service.ts) and the actions re-check the admin.
 */
export function InvoiceEditor({ doc, logoSrc, id, initial, sendTo }: { doc: InvoiceDocument; logoSrc: string | null; id: string; initial: { dueDate: string; notes: string; billingEmail: string }; sendTo: string | null }) {
  const currency = doc.currency;
  const [lines, setLines] = useState<LineInput[]>(() => doc.lines.map((l, i) => ({ key: i, description: l.description, quantity: String(l.quantity), price: moneyInput(l.unitMinor, currency) })));
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [notes, setNotes] = useState(initial.notes);
  const [billingEmail, setBillingEmail] = useState(initial.billingEmail);
  const [confirmSend, setConfirmSend] = useState(false);
  const [nextKey, setNextKey] = useState(lines.length);

  // What the server will receive, and what it will say about it.
  const parsedLines: InvoiceLine[] = lines.map((l) => ({ description: l.description.trim(), quantity: /^\d+$/.test(l.quantity.trim()) ? Number(l.quantity) : NaN, unitMinor: parseMoney(l.price, currency) ?? NaN }));
  const payload = { lines: parsedLines, dueDate, notes, billingEmail };
  const check = validateDraft(payload, doc.issueDate, doc.taxRatePercent);
  const errors = check.ok ? {} : check.errors;
  const priceError = (i: number) => (Number.isNaN(parsedLines[i].unitMinor) ? `Type a price like ${currency === "RWF" ? "15000" : "49.00"}.` : errors[`lines.${i}.unitMinor`]);
  const qtyError = (i: number) => (Number.isNaN(parsedLines[i].quantity) ? "A whole number." : errors[`lines.${i}.quantity`]);
  const lineValid = (l: InvoiceLine) => Number.isFinite(l.quantity) && Number.isFinite(l.unitMinor);
  const shown = parsedLines.map((l) => ({ ...l, quantity: Number.isFinite(l.quantity) ? l.quantity : 0, unitMinor: Number.isFinite(l.unitMinor) ? l.unitMinor : 0 }));
  const totals = computeTotals(shown, doc.taxRatePercent);
  const preview: InvoiceDocument = { ...doc, lines: shown, ...totals, dueDate: dueDate || doc.dueDate, notes: notes.trim() || null };
  const ready = check.ok && parsedLines.every(lineValid) && totals.totalMinor > 0;
  const data = JSON.stringify(payload);

  const update = (i: number, patch: Partial<LineInput>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = () => {
    setLines((ls) => [...ls, { key: nextKey, description: "", quantity: "1", price: "" }]);
    setNextKey((k) => k + 1);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form action={saveInvoiceAction} className="flex min-w-0 flex-col gap-4">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="data" value={data} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-base font-semibold">Lines</legend>
          {lines.map((l, i) => (
            <div key={l.key} className="grid grid-cols-[1fr_5rem_8rem_auto] items-start gap-2 rounded-2xl bg-soft p-3 max-sm:grid-cols-2">
              <Field label={`Line ${i + 1}`} error={errors[`lines.${i}.description`]} className="max-sm:col-span-2">
                <Input value={l.description} onChange={(e) => update(i, { description: e.target.value })} maxLength={200} placeholder="What the client pays for" />
              </Field>
              <Field label="Qty" error={qtyError(i)}>
                <Input value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} inputMode="numeric" />
              </Field>
              <Field label={`Unit price (${currency})`} error={priceError(i)}>
                <Input value={l.price} onChange={(e) => update(i, { price: e.target.value })} inputMode="decimal" />
              </Field>
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`} className="glass mt-6 inline-flex size-11 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40">
                <Trash2 aria-hidden className="size-4" />
              </button>
            </div>
          ))}
          {errors.lines && <p role="alert" className="text-sm text-danger">{errors.lines}</p>}
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={lines.length >= MAX_LINES} leading={<Plus aria-hidden className="size-4" />} className="self-start">
            Add line
          </Button>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due date" error={errors.dueDate} hint={`Issued ${doc.issueDate}; sending sets the issue date to the day it goes out.`}>
            <Input type="date" value={dueDate} min={doc.issueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </Field>
          <Field label="Billing contact (optional)" error={errors.billingEmail} hint={sendTo ? `Also sent to the owner, ${sendTo}.` : "The company has no owner email: add one here."}>
            <Input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} maxLength={120} placeholder="accounts@company.rw" />
          </Field>
        </div>
        <Field label="Notes (printed on the invoice)" error={errors.notes}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
        </Field>
        <p className="text-sm">
          Total <strong>{formatInvoiceMoney(totals.totalMinor, currency)}</strong>
          {doc.taxRatePercent ? ` (incl. VAT ${doc.taxRatePercent}%: ${formatInvoiceMoney(totals.taxMinor, currency)})` : " (no VAT)"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={!check.ok || !parsedLines.every(lineValid)}>
            Save draft
          </Button>
          <Button type="button" onClick={() => setConfirmSend(true)} disabled={!ready}>
            Send
          </Button>
        </div>
      </form>

      <div className="min-w-0">
        <InvoicePreview doc={preview} logoSrc={logoSrc} />
      </div>

      <Dialog open={confirmSend} onOpenChange={setConfirmSend} title={`Send ${doc.number}?`} description={`Saves what you see and emails the invoice (${formatInvoiceMoney(totals.totalMinor, currency)}, due ${dueDate}) with the PDF to ${[sendTo, billingEmail.trim()].filter(Boolean).join(" and ") || "nobody yet"}. After sending it can no longer be edited, only voided. Written to the audit log.`}>
        <form action={sendInvoiceAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="data" value={data} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmSend(false)}>
              Cancel
            </Button>
            <Button type="submit">Send invoice</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
