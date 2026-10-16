// The invoice PDF: pure JavaScript (pdf-lib, the standard Helvetica fonts), so it runs the same on Cloudflare Workers,
// in Node and in the tests. One A4 page in the usual case, more when there are many lines. No server imports: it draws
// an InvoiceDocument (lib/invoices/shared.ts) that the service has already put together.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { formatInvoiceMoney, imageDimensions, logoProblem, longInvoiceDate, type InvoiceDocument } from "./shared";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_W = A4.width - MARGIN * 2;
const FOOTER_H = 56;

const INK = rgb(0.11, 0.11, 0.12);
const MUTED = rgb(0.43, 0.43, 0.45);
const LINE = rgb(0.88, 0.88, 0.9);
const WHITE = rgb(1, 1, 1);

export type InvoiceLogo = { bytes: Uint8Array; type: "image/png" | "image/jpeg" };

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return rgb(0.18, 0.42, 1);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/** The accent mixed with white, for the table header and the payment box. */
function tint(c: RGB, amount: number): RGB {
  return rgb(c.red + (1 - c.red) * amount, c.green + (1 - c.green) * amount, c.blue + (1 - c.blue) * amount);
}

type Fonts = { regular: PDFFont; bold: PDFFont };

/**
 * The standard fonts only encode WinAnsi (Latin-1 plus a few signs): anything else (emoji, arrows, other scripts)
 * becomes "?" instead of failing the whole PDF. Line breaks and tabs become spaces.
 */
function safeText(font: PDFFont, text: string): string {
  const supported = charsetOf(font);
  let out = "";
  for (const ch of text.replace(/[\r\n\t]+/g, " ")) out += supported.has(ch.codePointAt(0) ?? 0) ? ch : "?";
  return out;
}
const charsets = new WeakMap<PDFFont, Set<number>>();
function charsetOf(font: PDFFont): Set<number> {
  let set = charsets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsets.set(font, set);
  }
  return set;
}

/** Splits text into lines no wider than `width` (words longer than the line are cut). Keeps the author's line breaks. */
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = safeText(font, paragraph).split(/\s+/).filter(Boolean);
    let line = "";
    for (let word of words) {
      while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
        // A very long word (a URL): cut it to fit.
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
        if (line) out.push(line);
        out.push(word.slice(0, cut));
        line = "";
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  // Drop trailing empty lines, keep blank lines between paragraphs.
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
}

class Writer {
  page: PDFPage;
  y: number;
  pages: PDFPage[] = [];
  constructor(
    private pdf: PDFDocument,
    public fonts: Fonts,
    public accent: RGB,
  ) {
    this.page = this.addPage();
    this.y = A4.height - MARGIN;
  }

  private addPage(): PDFPage {
    const page = this.pdf.addPage([A4.width, A4.height]);
    // A thin accent band at the top of every page.
    page.drawRectangle({ x: 0, y: A4.height - 6, width: A4.width, height: 6, color: this.accent });
    this.pages.push(page);
    return page;
  }

  /** Room for `height` points above the footer, or a new page. Returns true when a page was added. */
  ensure(height: number): boolean {
    if (this.y - height >= MARGIN + FOOTER_H) return false;
    this.page = this.addPage();
    this.y = A4.height - MARGIN;
    return true;
  }

  text(text: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: RGB; align?: "left" | "right"; maxWidth?: number } = {}) {
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const size = opts.size ?? 10;
    let t = safeText(font, text);
    if (opts.maxWidth) while (t.length > 1 && font.widthOfTextAtSize(t, size) > opts.maxWidth) t = `${t.slice(0, -2)}…`.replace(/……$/, "…");
    const w = font.widthOfTextAtSize(t, size);
    this.page.drawText(t, { x: opts.align === "right" ? x - w : x, y, size, font, color: opts.color ?? INK });
    return w;
  }

  /** Wrapped text from the current y downwards; returns the height used. */
  paragraph(text: string, x: number, width: number, opts: { size?: number; bold?: boolean; color?: RGB; leading?: number } = {}): number {
    const size = opts.size ?? 10;
    const leading = opts.leading ?? size * 1.4;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const lines = wrap(font, size, text, width);
    for (const line of lines) {
      this.ensure(leading);
      this.y -= leading;
      if (line) this.page.drawText(line, { x, y: this.y + (leading - size) / 2, size, font, color: opts.color ?? INK });
    }
    return lines.length * leading;
  }
}

/** Draws one invoice. `logo` is the invoice settings' PNG or JPEG; a file that cannot be read is left out. */
export async function renderInvoicePdf(doc: InvoiceDocument, logo?: InvoiceLogo | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${doc.number}`);
  pdf.setSubject(`${doc.seller.businessName} invoice ${doc.number} for ${doc.billTo.businessName}`);
  pdf.setAuthor(doc.seller.businessName);
  pdf.setKeywords([doc.number, "invoice"]);
  pdf.setCreator("BuPulse");
  pdf.setProducer("BuPulse invoices (pdf-lib)");
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const accent = hexToRgb(doc.seller.accentColor);
  let image: PDFImage | null = null;
  // The header is checked before pdf-lib decodes anything: a stored logo that is not a sane PNG / JPEG is left out.
  if (logo?.bytes.length && !logoProblem(logo.bytes) && imageDimensions(logo.bytes)?.type === logo.type) {
    try {
      image = logo.type === "image/png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
    } catch {
      image = null; // a broken logo never stops an invoice
    }
  }
  const w = new Writer(pdf, fonts, accent);
  const money = (minor: number) => formatInvoiceMoney(minor, doc.currency);
  const right = A4.width - MARGIN;

  // ---- header: logo and seller on the left, INVOICE and the numbers on the right
  const top = w.y;
  let leftY = top;
  if (image) {
    const scale = Math.min(150 / image.width, 48 / image.height, 1);
    const iw = image.width * scale;
    const ih = image.height * scale;
    w.page.drawImage(image, { x: MARGIN, y: top - ih, width: iw, height: ih });
    leftY = top - ih - 12;
  }
  w.text(doc.seller.businessName, MARGIN, leftY - 12, { size: image ? 12 : 18, bold: true, maxWidth: 280 });
  leftY -= image ? 18 : 26;
  const sellerLines = [
    ...(doc.seller.address ? wrap(fonts.regular, 9, doc.seller.address, 260) : []),
    doc.seller.email,
    doc.seller.phone,
    doc.seller.website,
    doc.seller.tin ? `TIN: ${doc.seller.tin}` : "",
  ].filter(Boolean);
  for (const line of sellerLines) {
    leftY -= 12.5;
    w.text(line, MARGIN, leftY, { size: 9, color: MUTED, maxWidth: 270 });
  }

  w.text("INVOICE", right, top - 22, { size: 26, bold: true, color: accent, align: "right" });
  const meta: [string, string][] = [
    ["Invoice no.", doc.number],
    ["Issue date", longInvoiceDate(doc.issueDate)],
    ["Due date", longInvoiceDate(doc.dueDate)],
    ...(doc.planLabel ? ([["Plan", doc.planLabel]] as [string, string][]) : []),
  ];
  let metaY = top - 44;
  for (const [label, value] of meta) {
    w.text(label, right - 150, metaY, { size: 9, color: MUTED });
    w.text(value, right, metaY, { size: 9.5, bold: label === "Invoice no.", align: "right", maxWidth: 140 });
    metaY -= 14;
  }
  if (doc.status !== "draft" && doc.status !== "sent") {
    // PAID or VOID, in a box under the numbers.
    const label = doc.status === "paid" ? `PAID${doc.paidAt ? ` ${longInvoiceDate(doc.paidAt).toUpperCase()}` : ""}` : "VOID";
    const color = doc.status === "paid" ? rgb(0.13, 0.55, 0.3) : rgb(0.75, 0.16, 0.16);
    const bw = fonts.bold.widthOfTextAtSize(label, 11) + 16;
    w.page.drawRectangle({ x: right - bw, y: metaY - 10, width: bw, height: 20, borderColor: color, borderWidth: 1.5 });
    w.text(label, right - 8, metaY - 3.5, { size: 11, bold: true, color, align: "right" });
    metaY -= 26;
  } else if (doc.status === "draft") {
    w.text("DRAFT", right, metaY - 4, { size: 11, bold: true, color: MUTED, align: "right" });
    metaY -= 20;
  }
  w.y = Math.min(leftY, metaY) - 22;

  // ---- bill to
  w.text("BILL TO", MARGIN, w.y, { size: 8.5, bold: true, color: accent });
  w.y -= 4;
  w.paragraph(doc.billTo.businessName, MARGIN, 300, { size: 11.5, bold: true });
  for (const line of [doc.billTo.ownerName, doc.billTo.phone, doc.billTo.email, doc.billTo.address, doc.billTo.country].filter((v): v is string => Boolean(v))) {
    w.paragraph(line, MARGIN, 300, { size: 9.5, color: MUTED, leading: 13 });
  }
  w.y -= 20;

  // ---- the lines
  const cols = { desc: MARGIN + 10, qty: MARGIN + CONTENT_W * 0.62, unit: MARGIN + CONTENT_W * 0.8, amount: right - 10 };
  const descWidth = cols.qty - cols.desc - 40;
  const header = () => {
    w.page.drawRectangle({ x: MARGIN, y: w.y - 22, width: CONTENT_W, height: 22, color: tint(accent, 0.88) });
    const hy = w.y - 15;
    w.text("Description", cols.desc, hy, { size: 8.5, bold: true });
    w.text("Qty", cols.qty, hy, { size: 8.5, bold: true, align: "right" });
    w.text("Unit price", cols.unit, hy, { size: 8.5, bold: true, align: "right" });
    w.text("Amount", cols.amount, hy, { size: 8.5, bold: true, align: "right" });
    w.y -= 22;
  };
  w.ensure(60);
  header();
  for (const line of doc.lines) {
    const descLines = wrap(fonts.regular, 9.5, line.description, descWidth);
    const rowH = Math.max(1, descLines.length) * 13 + 12;
    if (w.ensure(rowH)) header();
    const rowTop = w.y;
    descLines.forEach((d, i) => w.text(d, cols.desc, rowTop - 16 - i * 13, { size: 9.5 }));
    w.text(String(line.quantity), cols.qty, rowTop - 16, { size: 9.5, align: "right" });
    w.text(money(line.unitMinor), cols.unit, rowTop - 16, { size: 9.5, align: "right" });
    w.text(money(line.quantity * line.unitMinor), cols.amount, rowTop - 16, { size: 9.5, align: "right" });
    w.y = rowTop - rowH;
    w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: right, y: w.y }, thickness: 0.6, color: LINE });
  }

  // ---- totals
  const totals: [string, string, boolean][] = [
    ["Subtotal", money(doc.subtotalMinor), false],
    ...(doc.taxRatePercent ? ([[`VAT (${doc.taxRatePercent}%)`, money(doc.taxMinor), false]] as [string, string, boolean][]) : []),
    [doc.status === "paid" ? "Total paid" : "Total due", money(doc.totalMinor), true],
  ];
  w.ensure(totals.length * 18 + 20);
  w.y -= 8;
  for (const [label, value, strong] of totals) {
    if (strong) {
      w.page.drawRectangle({ x: cols.unit - 90, y: w.y - 22, width: right - (cols.unit - 90), height: 24, color: accent });
      w.text(label, cols.unit - 80, w.y - 15, { size: 10, bold: true, color: WHITE });
      w.text(value, cols.amount, w.y - 15, { size: 11, bold: true, color: WHITE, align: "right" });
      w.y -= 26;
    } else {
      w.text(label, cols.unit - 80, w.y - 13, { size: 9.5, color: MUTED });
      w.text(value, cols.amount, w.y - 13, { size: 9.5, align: "right" });
      w.y -= 18;
    }
  }
  w.y -= 18;

  // ---- how to pay (not on a void invoice)
  if (doc.status !== "void") {
    const d = doc.payment.details;
    const paid = doc.status === "paid";
    const rows: [string, string][] = paid
      ? [["Reference", doc.payment.reference], ...(doc.paidAt ? ([["Paid on", longInvoiceDate(doc.paidAt)]] as [string, string][]) : [])]
      : [
      ...(d.merchantCode ? ([["MoMo Pay code", d.merchantCode]] as [string, string][]) : []),
      ...(d.momoNumber ? ([["MTN MoMo number", d.momoNumber]] as [string, string][]) : []),
      ...(d.airtelNumber ? ([["Airtel Money number", d.airtelNumber]] as [string, string][]) : []),
      ...(d.accountName ? ([["Account name", d.accountName]] as [string, string][]) : []),
      ["Reference", `Use reference ${doc.payment.reference}`],
      ["Pay online", doc.payment.payUrl],
    ];
    const instr = wrap(fonts.regular, 9.5, paid ? "Thank you. This invoice is paid in full." : doc.payment.instructions, CONTENT_W - 28);
    const boxH = 30 + instr.length * 13 + rows.length * 14 + 10;
    w.ensure(boxH + 10);
    const boxTop = w.y;
    w.page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: CONTENT_W, height: boxH, color: tint(accent, 0.94), borderColor: tint(accent, 0.7), borderWidth: 0.8 });
    w.text(paid ? "PAYMENT RECEIVED" : "HOW TO PAY", MARGIN + 14, boxTop - 18, { size: 8.5, bold: true, color: accent });
    let py = boxTop - 33;
    for (const line of instr) {
      w.text(line, MARGIN + 14, py, { size: 9.5 });
      py -= 13;
    }
    py -= 3;
    for (const [label, value] of rows) {
      w.text(label, MARGIN + 14, py, { size: 9, color: MUTED });
      w.text(value, MARGIN + 130, py, { size: 9.5, bold: label === "Reference" || label === "MoMo Pay code", maxWidth: CONTENT_W - 130 });
      py -= 14;
    }
    w.y = boxTop - boxH - 18;
  }

  // ---- notes
  if (doc.notes) {
    w.ensure(40);
    w.text("NOTES", MARGIN, w.y, { size: 8.5, bold: true, color: accent });
    w.y -= 2;
    w.paragraph(doc.notes, MARGIN, CONTENT_W, { size: 9.5, color: INK, leading: 13 });
  }

  // ---- footer on every page
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 26 }, end: { x: right, y: MARGIN + 26 }, thickness: 0.6, color: LINE });
    const footer = safeText(fonts.regular, doc.seller.footer || doc.seller.businessName);
    const lines = wrap(fonts.regular, 8.5, footer, CONTENT_W - 120).slice(0, 2);
    lines.forEach((l, j) => page.drawText(l, { x: MARGIN, y: MARGIN + 12 - j * 11, size: 8.5, font: fonts.regular, color: MUTED }));
    const pageLabel = safeText(fonts.regular, `${doc.number} · Page ${i + 1} of ${total}`);
    page.drawText(pageLabel, { x: right - fonts.regular.widthOfTextAtSize(pageLabel, 8.5), y: MARGIN + 12, size: 8.5, font: fonts.regular, color: MUTED });
  });

  return pdf.save();
}

/** "BP-INV-0001.pdf". */
export const invoiceFileName = (number: string) => `${number}.pdf`;
