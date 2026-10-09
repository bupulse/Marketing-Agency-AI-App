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

export function isReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE.test(value);
}

// ---- period ------------------------------------------------------------------------------------------------

export type PeriodInput = { status: string; currentPeriodEnd: Date | null; provider: string | null };

/**
 * The period a confirmed payment buys. A client still inside a paid Mobile Money period renews early: the new period
 * starts where the current one ends, so they lose nothing. Everyone else (trial, ended, past due, card) starts now.
 */
export function nextManualPeriod(sub: PeriodInput, interval: BillingInterval, now: Date = new Date()): { start: Date; end: Date } {
  const extend = sub.provider === "MANUAL_MOMO" && sub.status === "ACTIVE" && sub.currentPeriodEnd !== null && sub.currentPeriodEnd > now;
  const start = extend ? (sub.currentPeriodEnd as Date) : now;
  return { start, end: addMonths(start, interval === "YEAR" ? 12 : 1) };
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

/** USD cents of a payment, for the revenue roll-up (which is in USD): RWF ÷ the admin's rate. */
export function usdCentsOf(amountMinor: number, currency: string, usdToRwf: number): number {
  if (currency === "USD") return amountMinor;
  if (currency === "RWF") return usdToRwf > 0 ? Math.round((amountMinor / usdToRwf) * 100) : 0;
  return 0;
}

/** The USD price (cents) converted to whole francs, rounded to the nearest 100 RWF. */
export function rwfFromUsdCents(cents: number, usdToRwf: number): number {
  return Math.round(((cents / 100) * usdToRwf) / 100) * 100;
}

// ---- owner settings (AdminSetting "billing.momo") ----------------------------------------------------------

export const MOMO_SETTING_KEY = "billing.momo";
/** Rwandan francs per US dollar used to show card prices and to count MoMo revenue in USD (October 2026 estimate). */
export const DEFAULT_USD_TO_RWF = 1450;

export type MomoPlanPrice = { monthlyMinor: number; yearlyMinor: number };

/**
 * What the owner fills in once: where clients pay, and the RWF price of each plan. A plan without an entry in `prices`
 * is sold at its USD price converted with `usdToRwf`. R1 (regions) folds `prices` into per-region plan prices; until
 * then this is the one place RWF prices live.
 */
export type MomoSettings = {
  merchantCode: string;
  momoNumber: string;
  accountName: string;
  airtelNumber: string;
  usdToRwf: number;
  prices: Record<string, MomoPlanPrice>;
};

export const EMPTY_MOMO_SETTINGS: MomoSettings = { merchantCode: "", momoNumber: "", accountName: "", airtelNumber: "", usdToRwf: DEFAULT_USD_TO_RWF, prices: {} };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const whole = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** Reads the stored JSON defensively: a half-written row never breaks the Billing page. */
export function cleanMomoSettings(value: unknown): MomoSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rate = typeof v.usdToRwf === "number" && v.usdToRwf > 0 ? v.usdToRwf : DEFAULT_USD_TO_RWF;
  const prices: Record<string, MomoPlanPrice> = {};
  if (v.prices && typeof v.prices === "object") {
    for (const [key, p] of Object.entries(v.prices as Record<string, unknown>)) {
      const row = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const monthlyMinor = whole(row.monthlyMinor);
      const yearlyMinor = whole(row.yearlyMinor);
      if (monthlyMinor !== null && yearlyMinor !== null && /^[A-Za-z0-9_-]{1,64}$/.test(key)) prices[key] = { monthlyMinor, yearlyMinor };
    }
  }
  return {
    merchantCode: str(v.merchantCode, 20),
    momoNumber: str(v.momoNumber, 30),
    accountName: str(v.accountName, 80),
    airtelNumber: str(v.airtelNumber, 30),
    usdToRwf: rate,
    prices,
  };
}

/** Clients can only be offered Mobile Money when there is somewhere to send the money. */
export function momoConfigured(s: Pick<MomoSettings, "merchantCode" | "momoNumber" | "airtelNumber">): boolean {
  return Boolean(s.merchantCode || s.momoNumber || s.airtelNumber);
}

/** The RWF price of a plan for an interval: the owner's RWF price, else the USD price converted. */
export function momoPriceFor(plan: { key: string; monthlyPriceCents: number; yearlyPriceCents: number }, interval: BillingInterval, settings: MomoSettings): number {
  const own = settings.prices[plan.key];
  if (own) return interval === "YEAR" ? own.yearlyMinor : own.monthlyMinor;
  return rwfFromUsdCents(interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents, settings.usdToRwf);
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

/** What the Billing page shows the client about their payment. Never includes other clients' data. */
export type ManualPaymentView = {
  id: string;
  planKey: string;
  planName: string;
  interval: BillingInterval;
  amountMinor: number;
  currency: string;
  reference: string;
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
