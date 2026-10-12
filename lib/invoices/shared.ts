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
