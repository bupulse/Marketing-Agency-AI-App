import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import type { InvoiceDocument } from "@/lib/invoices/shared";

// The invoice PDF (pdf-lib, standard fonts: runs on Workers). Smoke tests: a real PDF, the invoice number in it, the logo
// embedded, characters the standard fonts cannot draw replaced instead of failing, and many lines over several pages.

const DOC: InvoiceDocument = {
  number: "BP-INV-0007",
  status: "sent",
  currency: "RWF",
  issueDate: "2026-10-13",
  dueDate: "2026-10-16",
  lines: [{ description: "BuPulse Business plan, monthly (1 month)", quantity: 1, unitMinor: 35000 }],
  subtotalMinor: 35000,
  taxRatePercent: null,
  taxMinor: 0,
  totalMinor: 35000,
  notes: "Thanks for the demo.",
  planLabel: "Business, monthly",
  seller: { businessName: "BuPulse", address: "Kigali, Rwanda", email: "hello@bupulse.com", phone: "", website: "https://bupulse.com", tin: "", footer: "Thank you.", accentColor: "#2F6BFF", hasLogo: false },
  billTo: { businessName: "Inzu Fashion", ownerName: "Aline Uwase", email: "owner@example.rw", phone: "+250 788 123 456", address: "M Peace Plaza — KN 4 Avenue, Kigali", country: "Rwanda" },
  payment: { instructions: "Pay by Mobile Money to MoMo Pay code 123456.", details: { merchantCode: "123456", momoNumber: "", airtelNumber: "", accountName: "BuPulse Ltd" }, reference: "BP-INV-0007", payUrl: "https://bupulse.com/dashboard/billing?invoice=BP-INV-0007" },
  paidAt: null,
};

// A 1x1 PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

/** Every text drawn on the pages: the content streams inflated, the hex strings decoded (WinAnsi = Latin-1 here). */
function pageText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    let body: string;
    try {
      body = inflateSync(chunk).toString("latin1");
    } catch {
      body = chunk.toString("latin1");
    }
    out += body.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
  }
  return out;
}

describe("renderInvoicePdf", () => {
  it("makes a non-empty PDF that carries the invoice number, the total and the reference", async () => {
    const bytes = await renderInvoicePdf(DOC);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Invoice BP-INV-0007");
    const [page] = pdf.getPages();
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
    const text = pageText(bytes);
    expect(text).toContain("BP-INV-0007");
    expect(text).toContain("Use reference BP-INV-0007");
    expect(text).toContain("35,000 RWF");
    expect(text).toContain("Inzu Fashion");
    expect(text).toContain("MoMo Pay code");
  });

  it("embeds the logo, and leaves a broken one out instead of failing", async () => {
    const withLogo = await renderInvoicePdf(DOC, { bytes: PNG, type: "image/png" });
    expect(Buffer.from(withLogo).toString("latin1")).toMatch(/\/Subtype \/Image/);
    const broken = await renderInvoicePdf(DOC, { bytes: new Uint8Array([1, 2, 3, 4]), type: "image/jpeg" });
    expect(Buffer.from(broken).toString("latin1")).not.toMatch(/\/Subtype \/Image/);
    expect(pageText(broken)).toContain("BP-INV-0007");
  });

  it("draws what the standard fonts cannot as ? instead of throwing", async () => {
    const bytes = await renderInvoicePdf({ ...DOC, lines: [{ description: "Launch 🎉 → Kigali 日本", quantity: 1, unitMinor: 1000 }], subtotalMinor: 1000, totalMinor: 1000 });
    expect(pageText(bytes)).toContain("Launch ? ? Kigali ??");
  });

  it("goes onto more pages when there are many lines, with the number on every page", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({ description: `Line ${i + 1}: a long description that wraps onto a second line in the table to take more room`, quantity: 1, unitMinor: 1000 }));
    const bytes = await renderInvoicePdf({ ...DOC, lines, subtotalMinor: 30000, totalMinor: 30000 });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pageText(bytes)).toContain(`BP-INV-0007 · Page 2 of ${pdf.getPageCount()}`);
  });

  it("marks a paid invoice PAID and a void one VOID, with VAT when set", async () => {
    const paid = pageText(await renderInvoicePdf({ ...DOC, status: "paid", paidAt: "2026-10-14", taxRatePercent: 18, taxMinor: 6300, totalMinor: 41300 }));
    expect(paid).toContain("PAID 14 OCTOBER 2026");
    expect(paid).toContain("VAT (18%)");
    expect(paid).toContain("41,300 RWF");
    expect(paid).not.toContain("HOW TO PAY");
    const voided = pageText(await renderInvoicePdf({ ...DOC, status: "void" }));
    expect(voided).toContain("VOID");
    expect(voided).not.toContain("HOW TO PAY");
  });
});
