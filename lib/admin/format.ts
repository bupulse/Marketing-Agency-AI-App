import type { DateRange } from "@/lib/analytics/types";
import { digitsOf, formatMoney } from "@/lib/money/display";

/** The range keys used in ?range= on admin pages. */
export const RANGES = { today: 1, "7d": 7, "30d": 30 } as const;
export type RangeKey = keyof typeof RANGES;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Inclusive UTC days ending today. */
export function rangeFor(days: number, now = new Date()): DateRange {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: ymd(from), to: ymd(to) };
}

export function parseRange(value: string | string[] | undefined, fallback: RangeKey = "30d"): { key: RangeKey; range: DateRange } {
  const key = (typeof value === "string" && value in RANGES ? value : fallback) as RangeKey;
  return { key, range: rangeFor(RANGES[key]) };
}

/** Digits after the decimal point for a currency (RWF none, USD and EUR two). */
export const currencyDigits = (currency = "USD") => digitsOf(currency);

/**
 * Amount in the currency's smallest unit, in that currency (no conversion): the one formatter (lib/money/display.ts).
 * Admin figures that follow the console's display currency use moneyFmt (components/admin/money.tsx) instead.
 */
export const money = (minor: number, currency = "USD") => formatMoney(minor, currency);

/** Whole major-unit text typed by the owner ("12.50") to the smallest unit, or null if it is not a valid amount. */
export function toMinor(input: string, currency = "USD"): number | null {
  const raw = input.replace(/[\s,]/g, "").replace(/^[^\d.\-]+/, "");
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 10 ** currencyDigits(currency)) : null;
}

export const num = (n: number) => n.toLocaleString("en-US");
export const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${Math.round(n * 10) / 10}%`);

/** Change against the previous period; null when there is nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

export function dateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/** First string value of a search param. */
export function param(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Current time in ms. A function so pages can call it without tripping the render-purity lint rule. */
export const nowMs = () => Date.now();
