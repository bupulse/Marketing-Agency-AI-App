// Manual Mobile Money payments: the parts with no database or server imports, so the client components, the
// admin pages and the tests share one set of rules (docs/MOMO.md).
import { z } from "zod";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import { addMonths } from "./period";

export const MANUAL_PAYMENT_STATUSES = ["pending", "confirmed", "rejected", "expired"] as const;
export type ManualPaymentStatus = (typeof MANUAL_PAYMENT_STATUSES)[number];

export const MOMO_NETWORKS = ["MTN", "AIRTEL"] as const;
export type MomoNetwork = (typeof MOMO_NETWORKS)[number];
export const NETWORK_LABEL: Record<MomoNetwork, string> = { MTN: "MTN Mobile Money", AIRTEL: "Airtel Money" };

/** Days after the paid period ends before the account becomes read-only (PAST_DUE). Nothing is deleted. */
export const GRACE_DAYS = 3;
/** Reminder emails go out this many days before the period ends. */
export const REMINDER_DAYS = [5, 1] as const;
/** A payment the client started but never submitted a transaction id for is closed after this long. */
export const UNSUBMITTED_TTL_HOURS = 48;
/** A rejected payment stays on the client's Billing page ("try again") for this long. */
export const REJECTED_SHOWN_DAYS = 7;

export const DAY_MS = 24 * 60 * 60 * 1000;

// ---- reference ---------------------------------------------------------------------------------------------

/** No 0/O, 1/I: the client types this on a phone and the owner reads it in an SMS. */
export const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERENCE_PREFIX = "BP-";
const REFERENCE = /^BP-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4,6}$/;

/** A new payment reference such as "BP-7K3Q". `random` is injectable for tests. */
export function makeReference(length = 4, random: () => number = Math.random): string {
  let out = REFERENCE_PREFIX;
  for (let i = 0; i < length; i++) out += REFERENCE_ALPHABET[Math.floor(random() * REFERENCE_ALPHABET.length)];
  return out;
}

/** A payment reference: "BP-7K3Q", or the invoice number ("BP-INV-0001") when the payment settles an invoice. */
export function isReference(value: unknown): value is string {
  return typeof value === "string" && (REFERENCE.test(value) || INVOICE_REFERENCE.test(value));
}
const INVOICE_REFERENCE = /^BP-INV-\d{4,}$/;

// ---- period ------------------------------------------------------------------------------------------------

export type PeriodInput = { plan: string; interval: BillingInterval; status: string; currentPeriodEnd: Date | null; provider: string | null; cancelAtPeriodEnd: boolean };

export type PeriodPlan = {
  /** extend: added after a running period of the same plan and interval; replace: a different plan or interval starts now and the running period is given up; fresh: nothing was running. */
  mode: "extend" | "replace" | "fresh";
  start: Date;
  end: Date;
  /** Whole days still paid for on the running period (extend and replace only). */
  daysLeft: number;
};

/**
 * The period a payment buys. A paid-up period that is still running is a Mobile Money one (ACTIVE, end in the future)
 * or a card one that the client has cancelled at its end (cancelAtPeriodEnd): same plan and interval extend it from
 * its end, so the client loses nothing; a different plan or interval starts now and replaces it (no free overlap: the
 * owner may credit by hand). A trial, an ended, past-due or still-renewing card plan starts now.
 */
export function planManualPeriod(sub: PeriodInput, plan: string, interval: BillingInterval, now: Date = new Date()): PeriodPlan {
  const end = sub.currentPeriodEnd;
  const running = end !== null && end > now && ((sub.provider === "MANUAL_MOMO" && sub.status === "ACTIVE") || (sub.provider === "PADDLE" && sub.status === "ACTIVE" && sub.cancelAtPeriodEnd));
  const months = interval === "YEAR" ? 12 : 1;
  if (!running) return { mode: "fresh", start: now, end: addMonths(now, months), daysLeft: 0 };
  const daysLeft = Math.ceil(((end as Date).getTime() - now.getTime()) / DAY_MS);
  if (sub.plan === plan && sub.interval === interval) return { mode: "extend", start: end as Date, end: addMonths(end as Date, months), daysLeft };
  return { mode: "replace", start: now, end: addMonths(now, months), daysLeft };
}

/** Kept for callers that only need the dates. */
export function nextManualPeriod(sub: PeriodInput, plan: string, interval: BillingInterval, now: Date = new Date()): { start: Date; end: Date } {
  const { start, end } = planManualPeriod(sub, plan, interval, now);
  return { start, end };
}

/** When a Mobile Money subscription becomes read-only: the end of the paid period plus the grace days. */
export function graceEnd(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() + GRACE_DAYS * DAY_MS);
}

/** Which reminder is due for a period ending at `end`, or null. The later one wins when a day was missed. */
export function reminderDue(end: Date, now: Date): "5d" | "1d" | null {
  const left = end.getTime() - now.getTime();
  if (left <= 1 * DAY_MS) return left > -GRACE_DAYS * DAY_MS ? "1d" : null;
  if (left <= 5 * DAY_MS) return "5d";
  return null;
}

// ---- money -------------------------------------------------------------------------------------------------

/** Digits after the decimal point: RWF has none, so amountMinor is whole francs. */
export const CURRENCY_DIGITS: Record<string, number> = { RWF: 0, USD: 2 };

/** "15,000 RWF". The amount is in the currency's smallest unit. */
export function formatMomoAmount(minor: number, currency = "RWF"): string {
  const digits = CURRENCY_DIGITS[currency] ?? 2;
  const major = minor / 10 ** digits;
  return `${major.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}

/** USD cents of a payment, for the revenue roll-up (which is in USD): RWF ÷ the USD->RWF rate (Admin -> Settings). */
export function usdCentsOf(amountMinor: number, currency: string, usdToRwf: number): number {
  if (currency === "USD") return amountMinor;
  if (currency === "RWF") return usdToRwf > 0 ? Math.round((amountMinor / usdToRwf) * 100) : 0;
  return 0;
}

/**
 * What a Mobile Money payment of a plan costs: the plan's own regional price (lib/region-prices.ts, docs/REGIONS.md),
 * in the region's currency. Null when the region does not take Mobile Money. One source of truth: the same amount
 * the pricing page and Billing show.
 */
export function momoPriceOf(plan: { monthlyPriceCents: number; yearlyPriceCents: number; currency: string; paymentMethods: readonly string[] }, interval: BillingInterval): { amountMinor: number; currency: string } | null {
  if (!plan.paymentMethods.includes("momo")) return null;
  return { amountMinor: interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents, currency: plan.currency.toUpperCase() };
}

// ---- owner settings (AdminSetting "billing.momo") ----------------------------------------------------------

export const MOMO_SETTING_KEY = "billing.momo";

/**
 * What the owner fills in once: where clients pay. Prices are not here: a plan's Mobile Money price is its regional
 * price (Admin -> Regions and prices), and the USD->RWF rate for the revenue roll-up is the pricing setting
 * (Admin -> Settings, lib/admin/settings.ts). Older rows may still carry `prices` and `usdToRwf`; they are ignored.
 */
export type MomoSettings = {
  merchantCode: string;
  momoNumber: string;
  accountName: string;
  airtelNumber: string;
};

export const EMPTY_MOMO_SETTINGS: MomoSettings = { merchantCode: "", momoNumber: "", accountName: "", airtelNumber: "" };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Reads the stored JSON defensively: a half-written row never breaks the Billing page. */
export function cleanMomoSettings(value: unknown): MomoSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    merchantCode: str(v.merchantCode, 20),
    momoNumber: str(v.momoNumber, 30),
    accountName: str(v.accountName, 80),
    airtelNumber: str(v.airtelNumber, 30),
  };
}

const MERCHANT_CODE = /^\d{4,12}$/;
const PHONE = /^\+?[\d\s().-]{6,24}$/;
const phoneDigits = (v: string) => v.replace(/\D/g, "").length;

/**
 * What the owner may save: a MoMo Pay code is 4 to 12 digits, numbers are phone numbers (9 to 15 digits, with or
 * without +250), the account name up to 80 characters. Returns the first problem in words, or null. Nothing is
 * truncated on save; cleanMomoSettings only trims what is already stored.
 */
export function momoSettingsProblem(s: MomoSettings): string | null {
  if (s.merchantCode && !MERCHANT_CODE.test(s.merchantCode)) return "The MoMo Pay code is 4 to 12 digits.";
  for (const [label, value] of [["MTN MoMo number", s.momoNumber], ["Airtel Money number", s.airtelNumber]] as const) {
    if (value && (!PHONE.test(value) || phoneDigits(value) < 9 || phoneDigits(value) > 15)) return `The ${label} must be a phone number, like 078 123 4567.`;
  }
  if (s.accountName.length > 80) return "The account name is at most 80 characters.";
  return null;
}

/** Clients can only be offered Mobile Money when there is somewhere to send the money. */
export function momoConfigured(s: Pick<MomoSettings, "merchantCode" | "momoNumber" | "airtelNumber">): boolean {
  return Boolean(s.merchantCode || s.momoNumber || s.airtelNumber);
}

// ---- what the client types ---------------------------------------------------------------------------------

/** The transaction id from the MoMo SMS: letters and digits, sometimes dots or dashes. */
export const transactionIdSchema = z
  .string()
  .trim()
  .min(4, "Enter the transaction id from your Mobile Money message.")
  .max(40, "That transaction id is too long.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9.\-_]*$/, "The transaction id can only have letters, digits, dots and dashes.");

/** The phone the client paid from, so the owner can match the SMS. 9 to 15 digits, with or without +250. */
export const payerPhoneSchema = z
  .string()
  .trim()
  .max(30, "That phone number is too long.")
  .transform((v, ctx) => {
    const digits = v.replace(/\D/g, "");
    if (!/^[+\d\s().-]+$/.test(v) || digits.length < 9 || digits.length > 15) {
      ctx.addIssue({ code: "custom", message: "Enter the phone number you paid from, like 078 123 4567." });
      return z.NEVER;
    }
    return v;
  });

export const proofSchema = z.object({
  paymentId: z.string().min(1).max(64),
  transactionId: transactionIdSchema,
  payerPhone: payerPhoneSchema,
  network: z.enum(MOMO_NETWORKS, { message: "Choose MTN or Airtel." }),
});
/** What the form sends; the schema checks it (network is one of MOMO_NETWORKS). */
export type ProofInput = { paymentId: string; transactionId: string; payerPhone: string; network: string };

/** How this payment meets the client's running period, shown before they pay and to the owner before confirming. */
export type PeriodNote = { mode: "extend" | "replace"; daysLeft: number; currentEnd: string };

/** What the Billing page shows the client about their payment. Never includes other clients' data. */
export type ManualPaymentView = {
  /** Null when nothing is running (trial, ended) or once the payment is decided. */
  periodNote: PeriodNote | null;
  id: string;
  planKey: string;
  planName: string;
  interval: BillingInterval;
  amountMinor: number;
  currency: string;
  reference: string;
  /** The invoice this payment settles (its number is the reference), or null for a plain plan payment. */
  invoiceId: string | null;
  /** The custom plan offer this payment pays (docs/OFFERS.md), or null. */
  offerId: string | null;
  status: ManualPaymentStatus;
  submitted: boolean;
  transactionId: string | null;
  payerPhone: string | null;
  network: MomoNetwork | null;
  rejectReason: string | null;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  periodEnd: string | null;
};

/** The owner's payment details, as shown on the pay screen. */
export type MomoPayDetails = Pick<MomoSettings, "merchantCode" | "momoNumber" | "accountName" | "airtelNumber">;

/** The message a client can paste into WhatsApp when they need help with a payment. */
export function whatsappText(input: { planName: string; amountMinor: number; currency: string; reference?: string | null; email?: string | null; periodEnd?: string | null }): string {
  const lines = [
    `Hello BuPulse, I am renewing my ${input.planName} plan (${formatMomoAmount(input.amountMinor, input.currency)}) by Mobile Money.`,
    input.reference ? `Reference: ${input.reference}` : null,
    input.email ? `Account: ${input.email}` : null,
    input.periodEnd ? `My plan ends on ${input.periodEnd}.` : null,
  ];
  return lines.filter(Boolean).join("\n");
}
