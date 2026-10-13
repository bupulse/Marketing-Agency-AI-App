import type { ReactElement } from "react";
import { BOOKS, showMixed, showMoney, type MoneyDisplay, type Shown } from "@/lib/money/display";

// How admin pages print money in the chosen display currency (lib/money/display.ts). `text` for places that take a
// string (stat values, chart labels); `el` for tables and sentences: the figure with the original amount as tooltip.

export type MoneyFmt = {
  display: MoneyDisplay;
  /** An amount stored in `currency` (USD cents by default), as text ("≈ RWF 50,750" when converted). */
  text: (minor: number, currency?: string, opts?: { rwfRate?: number | null }) => string;
  /** The same, with the original amount in a tooltip when converted. */
  el: (minor: number, currency?: string, opts?: { rwfRate?: number | null }) => ReactElement;
  /** A USD total with a part received in RWF (exact in RWF). */
  mixed: (input: { usdCents: number; rwfMinor?: number; rwfUsdCents?: number }) => string;
  mixedEl: (input: { usdCents: number; rwfMinor?: number; rwfUsdCents?: number }) => ReactElement;
  /** The tooltip text of an amount (for a Stat), or undefined when it is shown exactly. */
  title: (minor: number, currency?: string, opts?: { rwfRate?: number | null }) => string | undefined;
};

const span = (s: Shown) => <span title={s.title ?? undefined}>{s.text}</span>;

export function moneyFmt(display: MoneyDisplay): MoneyFmt {
  const show = (minor: number, currency = "USD", opts: { rwfRate?: number | null } = {}) => showMoney(Math.round(minor), currency, display, opts);
  return {
    display,
    text: (m, c, o) => show(m, c, o).text,
    el: (m, c, o) => span(show(m, c, o)),
    mixed: (i) => showMixed({ ...i, usdCents: Math.round(i.usdCents) }, display).text,
    mixedEl: (i) => span(showMixed({ ...i, usdCents: Math.round(i.usdCents) }, display)),
    title: (m, c, o) => show(m, c, o).title ?? undefined,
  };
}

/** Amounts as stored (USD books): the default when a page does not pass the admin's display currency. */
export const BOOKS_FMT = moneyFmt(BOOKS);
