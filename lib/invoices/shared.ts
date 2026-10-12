// Invoices: the rules with no database or server imports, so the editor, the admin pages, the PDF and the tests share
// one copy (docs/INVOICES.md). Amounts are in the currency's smallest unit (RWF has none, USD in cents).
import { z } from "zod";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import { formatMinor, minorDigits } from "@/lib/region-format";

export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const isInvoiceStatus = (v: unknown): v is InvoiceStatus => typeof v === "string" && (INVOICE_STATUSES as readonly string[]).includes(v);

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { draft: "Draft", sent: "Sent", paid: "Paid", void: "Void" };

/** Days from the issue date to the due date of a new invoice (editable in the editor). */
export const DEFAULT_DUE_DAYS = 3;
/** The due date may be at most this many days after the issue date. */
export const MAX_DUE_DAYS = 365;
export const MAX_LINES = 30;
/** Postgres INTEGER, with room: no invoice total above this. */
export const MAX_TOTAL_MINOR = 2_000_000_000;
/** Invoice dates are calendar days in Kigali, where BuPulse works. */
export const INVOICE_TIME_ZONE = "Africa/Kigali";

// ---- numbers -----------------------------------------------------------------------------------------------

export const INVOICE_PREFIX = "BP-INV-";
const NUMBER = /^BP-INV-\d{4,}$/;

/** 1 -> "BP-INV-0001"; past 9999 the number simply grows ("BP-INV-12345"). */
export function formatInvoiceNumber(n: number | bigint): string {
  const v = typeof n === "bigint" ? n : BigInt(Math.trunc(n));
  if (v < BigInt(1)) throw new Error("Invoice numbers start at 1.");
  return `${INVOICE_PREFIX}${v.toString().padStart(4, "0")}`;
}

export function isInvoiceNumber(value: unknown): value is string {
  return typeof value === "string" && NUMBER.test(value);
}

// ---- lines and totals --------------------------------------------------------------------------------------

export type InvoiceLine = { description: string; quantity: number; unitMinor: number };

export const lineSchema = z.object({
  description: z.string().trim().min(1, "Describe each line.").max(200, "A line description is at most 200 characters."),
  quantity: z.number({ message: "The quantity must be a number." }).int("The quantity must be a whole number.").min(1, "The quantity is at least 1.").max(10_000, "The quantity is at most 10,000."),
  unitMinor: z.number({ message: "The price must be a number." }).int("The price has too many decimals.").min(0, "A price cannot be negative.").max(MAX_TOTAL_MINOR, "That price is too large."),
});

export const linesSchema = z.array(lineSchema).min(1, "Add at least one line.").max(MAX_LINES, `At most ${MAX_LINES} lines.`);

export type Totals = { subtotalMinor: number; taxMinor: number; totalMinor: number };

/** Subtotal = sum of quantity x unit price; tax = subtotal x rate, rounded to the smallest unit; no rate, no tax. */
export function computeTotals(lines: readonly InvoiceLine[], taxRatePercent: number | null | undefined): Totals {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.quantity * l.unitMinor, 0);
  const rate = taxRatePercent && taxRatePercent > 0 ? taxRatePercent : 0;
  const taxMinor = rate ? Math.round((subtotalMinor * rate) / 100) : 0;
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

/** Reads stored lines defensively (a half-written row shows as no lines rather than breaking a page). */
export function readLines(value: unknown): InvoiceLine[] {
  const parsed = linesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** What the editor types ("15,000", "12.50") in the currency's major unit -> the smallest unit, or null. */
export function parseMoney(input: string, currency: string): number | null {
  const raw = input.replace(/[\s,]/g, "");
  const digits = minorDigits(currency);
  const re = digits > 0 ? new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`) : /^\d+$/;
  if (!re.test(raw)) return null;
  const n = Math.round(Number(raw) * 10 ** digits);
  return Number.isSafeInteger(n) ? n : null;
}

/** The smallest unit back to what the editor shows ("15000", "12.50"). */
export function moneyInput(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  return digits ? (minor / 10 ** digits).toFixed(digits) : String(minor);
}

export const formatInvoiceMoney = (minor: number, currency: string) => formatMinor(minor, currency);

// ---- dates (calendar days in Kigali, stored as UTC midnight of that day) ------------------------------------

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isYmd(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = YMD.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Today's date in Kigali, "YYYY-MM-DD". */
export function invoiceToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: INVOICE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const dateOfYmd = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
export const ymdOf = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
export const addDaysYmd = (ymd: string, days: number) => ymdOf(new Date(dateOfYmd(ymd).getTime() + days * 86_400_000));
export const daysBetween = (from: string, to: string) => Math.round((dateOfYmd(to).getTime() - dateOfYmd(from).getTime()) / 86_400_000);

/** "14 October 2026". */
export function longInvoiceDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** A sent invoice whose due date has passed (Kigali calendar). */
export function isOverdue(inv: { status: string; dueDate: Date | string }, now: Date = new Date()): boolean {
  return inv.status === "sent" && ymdOf(inv.dueDate) < invoiceToday(now);
}

/** The reminder goes out on the due date (and later if a run was missed), once. */
export function reminderDueToday(inv: { status: string; dueDate: Date | string; reminderSentAt: Date | null }, now: Date = new Date()): boolean {
  return inv.status === "sent" && !inv.reminderSentAt && ymdOf(inv.dueDate) <= invoiceToday(now);
}

// ---- the editor ----------------------------------------------------------------------------------------------

const EMAIL = /^[^\s@"<>,;]+@[^\s@"<>,;]+\.[a-z]{2,}$/i;

/** What the editor saves on a draft. */
export const draftSchema = z.object({
  lines: linesSchema,
  dueDate: z.string().refine(isYmd, "Choose a due date."),
  notes: z.string().trim().max(1000, "Notes are at most 1,000 characters.").transform((v) => v || null),
  billingEmail: z
    .string()
    .trim()
    .max(120, "That email address is too long.")
    .refine((v) => v === "" || EMAIL.test(v), "Enter an email address like accounts@company.rw, or leave it empty.")
    .transform((v) => v.toLowerCase() || null),
});
export type DraftInput = z.input<typeof draftSchema>;
export type DraftData = z.output<typeof draftSchema>;

/**
 * Checks a draft against its issue date: the due date is on or after the issue date and at most a year later, and the
 * total fits. Returns the cleaned data or the first problem per field ("lines.0.description", "dueDate", ...).
 */
export function validateDraft(raw: unknown, issueYmd: string, taxRatePercent: number | null): { ok: true; data: DraftData; totals: Totals } | { ok: false; errors: Record<string, string> } {
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[issue.path.join(".") || "form"] ??= issue.message;
    return { ok: false, errors };
  }
  const { dueDate } = parsed.data;
  if (dueDate < issueYmd) return { ok: false, errors: { dueDate: "The due date cannot be before the issue date." } };
  if (daysBetween(issueYmd, dueDate) > MAX_DUE_DAYS) return { ok: false, errors: { dueDate: "The due date is at most a year after the issue date." } };
  const totals = computeTotals(parsed.data.lines, taxRatePercent);
  if (totals.totalMinor > MAX_TOTAL_MINOR) return { ok: false, errors: { lines: "The total is too large for one invoice." } };
  return { ok: true, data: parsed.data, totals };
}

// ---- settings (AdminSetting "invoice.settings") -------------------------------------------------------------

export const INVOICE_SETTING_KEY = "invoice.settings";

export type InvoiceSettings = {
  /** Object path of the logo in the private "invoices" bucket ("" = no logo), and its type (PNG or JPEG: what a PDF embeds). */
  logoPath: string;
  logoType: "" | "image/png" | "image/jpeg";
  businessName: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  /** Tax id (Rwanda: TIN). Optional; printed when set. */
  tin: string;
  /** VAT in percent; null = no tax line (the default). */
  vatRatePercent: number | null;
  footer: string;
  /** Printed under "How to pay". Empty = the default text, built from the Mobile Money settings. */
  paymentInstructions: string;
  /** Accent colour of the PDF and the preview, #RRGGBB. */
  accentColor: string;
};

export const DEFAULT_ACCENT = "#2F6BFF";

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  logoPath: "",
  logoType: "",
  businessName: "BuPulse",
  address: "Kigali, Rwanda",
  email: "hello@bupulse.com",
  phone: "",
  website: "https://bupulse.com",
  tin: "",
  vatRatePercent: null,
  footer: "Thank you for choosing BuPulse.",
  paymentInstructions: "",
  accentColor: DEFAULT_ACCENT,
};

export const INVOICE_SETTING_LIMITS = { businessName: 120, address: 300, email: 120, phone: 40, website: 200, tin: 40, footer: 300, paymentInstructions: 800 } as const;
const HEX = /^#[0-9a-f]{6}$/i;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Reads the stored JSON defensively: a half-written row never breaks the editor or the PDF. */
export function cleanInvoiceSettings(value: unknown): InvoiceSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const L = INVOICE_SETTING_LIMITS;
  const rate = typeof v.vatRatePercent === "number" && Number.isFinite(v.vatRatePercent) && v.vatRatePercent > 0 && v.vatRatePercent <= 100 ? v.vatRatePercent : null;
  const logoType = v.logoType === "image/png" || v.logoType === "image/jpeg" ? v.logoType : "";
  const logoPath = typeof v.logoPath === "string" && /^settings\/[A-Za-z0-9._-]{1,120}$/.test(v.logoPath) && logoType ? v.logoPath : "";
  // A key never saved takes its default; a key saved empty stays empty (the owner cleared it).
  const text = (k: keyof typeof L) => (typeof v[k] === "string" ? str(v[k], L[k]) : DEFAULT_INVOICE_SETTINGS[k]);
  return {
    logoPath,
    logoType: logoPath ? logoType : "",
    businessName: str(v.businessName, L.businessName) || DEFAULT_INVOICE_SETTINGS.businessName,
    address: text("address"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    tin: text("tin"),
    vatRatePercent: rate,
    footer: text("footer"),
    paymentInstructions: text("paymentInstructions"),
    accentColor: typeof v.accentColor === "string" && HEX.test(v.accentColor) ? v.accentColor.toUpperCase() : DEFAULT_ACCENT,
  };
}

/** What the owner may save. The first problem in words, or null. Nothing is truncated on save. */
export function invoiceSettingsProblem(s: Omit<InvoiceSettings, "vatRatePercent"> & { vatRatePercent: number | null }): string | null {
  const L = INVOICE_SETTING_LIMITS;
  if (!s.businessName.trim()) return "The business name is required.";
  for (const [key, label] of [["businessName", "business name"], ["address", "address"], ["email", "email"], ["phone", "phone"], ["website", "website"], ["tin", "TIN"], ["footer", "footer"], ["paymentInstructions", "payment instructions"]] as const) {
    if (s[key].length > L[key]) return `The ${label} is at most ${L[key]} characters.`;
  }
  if (s.email && !EMAIL.test(s.email)) return "The email must be an address like hello@bupulse.com.";
  if (s.website && !/^https?:\/\/[^\s<>"]+\.[^\s<>"]+$/i.test(s.website)) return "The website must be a full address like https://bupulse.com.";
  if (s.tin && !/^[A-Za-z0-9 .\-/]+$/.test(s.tin)) return "The TIN can only have letters, digits, spaces, dots, dashes and slashes.";
  if (s.vatRatePercent !== null && (!Number.isFinite(s.vatRatePercent) || s.vatRatePercent <= 0 || s.vatRatePercent > 100)) return "The VAT rate is a number above 0 and at most 100, or empty for no tax.";
  if (!HEX.test(s.accentColor)) return "The accent colour must look like #2F6BFF.";
  return null;
}

/** The Mobile Money details the invoice prints, as in MomoSettings (lib/billing/momo-shared.ts). */
export type InvoicePayDetails = { merchantCode: string; momoNumber: string; airtelNumber: string; accountName: string };

/** "How to pay" when the owner has not written their own: built from where clients pay by Mobile Money. */
export function defaultPaymentInstructions(d: InvoicePayDetails): string {
  const ways = [
    d.merchantCode ? `MoMo Pay code ${d.merchantCode}` : null,
    d.momoNumber ? `MTN MoMo ${d.momoNumber}` : null,
    d.airtelNumber ? `Airtel Money ${d.airtelNumber}` : null,
  ].filter(Boolean);
  if (ways.length === 0) return "Pay online with the link below, by card or Mobile Money.";
  return `Pay by Mobile Money to ${ways.join(" or ")}${d.accountName ? ` (${d.accountName})` : ""}, or online with the link below.`;
}

// ---- what the PDF and the preview show ------------------------------------------------------------------------

export type BillTo = { businessName: string; ownerName: string | null; email: string | null; phone: string | null; address: string | null; country: string | null };
export type Seller = Omit<InvoiceSettings, "logoPath" | "logoType" | "vatRatePercent" | "paymentInstructions"> & { hasLogo: boolean };

/** Everything one invoice page needs, already decided: the PDF (lib/invoices/pdf.ts) and the editor preview draw this. */
export type InvoiceDocument = {
  number: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLine[];
  subtotalMinor: number;
  taxRatePercent: number | null;
  taxMinor: number;
  totalMinor: number;
  notes: string | null;
  planLabel: string | null;
  seller: Seller;
  billTo: BillTo;
  payment: { instructions: string; details: InvoicePayDetails; reference: string; payUrl: string };
  paidAt: string | null;
};

export function intervalLabel(i: BillingInterval | null | undefined): string {
  return i === "YEAR" ? "yearly" : "monthly";
}

// ---- card payments (Paddle transaction.completed) -------------------------------------------------------------

/** A completed card payment, as far as invoices care. */
export type CardPayment = {
  transactionId: string;
  subscriptionId: string | null;
  priceId: string | null;
  /** Grand total in the currency's smallest unit. */
  amountMinor: number;
  currency: string;
  paidAt: Date;
  /** Paddle's origin: "web" / "api" for a first purchase, "subscription_recurring" for a renewal, ... */
  origin: string | null;
  userId: string | null;
};

/**
 * Reads a Paddle `transaction.completed` event (the event that records money received). Null for any other event or a
 * payload without an amount: subscription.created / updated (renewals, edits) never settle an invoice.
 */
export function cardPaymentOf(event: { event_type?: unknown; occurred_at?: unknown; data?: unknown } | null | undefined): CardPayment | null {
  if (!event || event.event_type !== "transaction.completed" || !event.data || typeof event.data !== "object") return null;
  const d = event.data as Record<string, unknown>;
  const totals = ((d.details as Record<string, unknown> | undefined)?.totals ?? {}) as Record<string, unknown>;
  const amount = Number(totals.grand_total ?? totals.total);
  const currency = String(totals.currency_code ?? d.currency_code ?? "").toUpperCase();
  if (typeof d.id !== "string" || !Number.isSafeInteger(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  const when = new Date(String(d.billed_at ?? d.updated_at ?? event.occurred_at ?? ""));
  const items = Array.isArray(d.items) ? (d.items as { price?: { id?: unknown }; price_id?: unknown }[]) : [];
  const priceId = items[0]?.price?.id ?? items[0]?.price_id;
  const custom = (d.custom_data ?? {}) as { userId?: unknown };
  return {
    transactionId: d.id,
    subscriptionId: typeof d.subscription_id === "string" ? d.subscription_id : null,
    priceId: typeof priceId === "string" ? priceId : null,
    amountMinor: amount,
    currency,
    paidAt: Number.isNaN(when.getTime()) ? new Date() : when,
    origin: typeof d.origin === "string" ? d.origin : null,
    userId: typeof custom.userId === "string" ? custom.userId : null,
  };
}

/**
 * Which open invoice a card payment settles, or null. Only invoices for the paid plan and interval that were sent
 * before the payment. An invoice whose total and currency equal the payment wins (the newest such). Otherwise (an RWF
 * invoice paid at the plan's USD card price) only a first purchase settles one, the newest; a renewal never settles an
 * invoice it does not match exactly.
 */
export function invoiceForCardPayment<T extends { sentAt: Date | null; totalMinor: number; currency: string; planKey: string | null; interval: string | null }>(
  invoices: readonly T[],
  pay: Pick<CardPayment, "amountMinor" | "currency" | "paidAt" | "origin">,
  plan: { plan: string; interval: string },
): T | null {
  const candidates = invoices
    .filter((i) => i.sentAt && i.sentAt.getTime() <= pay.paidAt.getTime() && i.planKey === plan.plan && i.interval === plan.interval)
    .sort((a, b) => (b.sentAt as Date).getTime() - (a.sentAt as Date).getTime());
  const exact = candidates.find((i) => i.totalMinor === pay.amountMinor && i.currency.toUpperCase() === pay.currency);
  if (exact) return exact;
  if (pay.origin === "subscription_recurring") return null;
  return candidates[0] ?? null;
}

// ---- logo checks ---------------------------------------------------------------------------------------------

/** The largest logo, in pixels per side. A small file can still declare a huge image (a decompression bomb). */
export const MAX_LOGO_PX = 2000;

/**
 * Width and height read from a PNG's IHDR or a JPEG's SOF header, without decoding any pixels; null when the bytes are
 * not a well-formed PNG or JPEG (an SVG, a renamed file, a truncated header).
 */
export function imageDimensions(bytes: Uint8Array): { type: "image/png" | "image/jpeg"; width: number; height: number } | null {
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u32 = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && PNG.every((b, i) => bytes[i] === b)) {
    if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
    return { type: "image/png", width: u32(16), height: u32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++; // fill byte
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2; // markers without a length
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null; // end of image or start of scan before any frame header
      const length = u16(i + 2);
      if (length < 2) return null;
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC): precision, height, width.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "image/jpeg", width: u16(i + 7), height: u16(i + 5) };
      }
      i += 2 + length;
    }
  }
  return null;
}

/** The logo problem in words, or null when it may be stored and drawn. */
export function logoProblem(bytes: Uint8Array): string | null {
  const dims = imageDimensions(bytes);
  if (!dims) return "The logo must be a PNG or JPEG image.";
  if (dims.width < 1 || dims.height < 1 || dims.width > MAX_LOGO_PX || dims.height > MAX_LOGO_PX) return `The logo must be at most ${MAX_LOGO_PX} × ${MAX_LOGO_PX} pixels (this one is ${dims.width} × ${dims.height}).`;
  return null;
}
