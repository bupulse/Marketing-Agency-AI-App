// The admin console's display currency (docs/ADMIN.md, "Currency"): every money figure in the admin can be shown in
// RWF, USD or EUR. Pure, so the pages, the components and the tests share one conversion and one formatter.
//
// Rules:
//  - an amount shown in the currency it was stored in is exact (RWF from Mobile Money stays the RWF that was paid);
//  - anything converted is marked "≈" and its tooltip gives the original amount and currency;
//  - a stored rate wins over today's (a payment's USD value fixed at confirmation, a bill's RWF/USD rate);
//  - RWF has no decimals; USD and EUR have cents. One formatter (`formatMoney`) for every figure.

export const DISPLAY_CURRENCIES = ["RWF", "USD", "EUR"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export const CURRENCY_NAME: Record<DisplayCurrency, string> = { RWF: "Rwandan francs (RWF)", USD: "US dollars (USD)", EUR: "Euros (EUR)" };
export const isDisplayCurrency = (v: unknown): v is DisplayCurrency => typeof v === "string" && (DISPLAY_CURRENCIES as readonly string[]).includes(v);

/** RWF per USD (the Settings rate) and EUR per USD (Settings, or the day's ECB rate). */
export type Rates = { usdToRwf: number; usdToEur: number };
export type MoneyDisplay = { currency: DisplayCurrency; rates: Rates };

/** Digits after the decimal point: RWF none, USD and EUR two (any other ISO currency: what Intl says). */
export function digitsOf(currency: string): number {
  if (currency === "RWF") return 0;
  if (currency === "USD" || currency === "EUR") return 2;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** "$1,234.50", "€12.00", "RWF 35,000". The amount is in the currency's smallest unit. The one money formatter. */
export function formatMoney(minor: number, currency = "USD"): string {
  const digits = digitsOf(currency);
  const abs = Math.abs(minor) / 10 ** digits;
  let text: string;
  try {
    text = abs.toLocaleString("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    text = `${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
  }
  // Intl writes "RWF 35,000" with a non-breaking space; keep it, it never wraps.
  return minor < 0 ? `-${text}` : text;
}

/** Major units per USD for a currency (USD 1, RWF the Settings rate, EUR the EUR rate), or null when unknown. */
function perUsd(currency: string, rates: Rates, storedRwfRate?: number | null): number | null {
  if (currency === "USD") return 1;
  if (currency === "RWF") return storedRwfRate && storedRwfRate > 0 ? storedRwfRate : rates.usdToRwf > 0 ? rates.usdToRwf : null;
  if (currency === "EUR") return rates.usdToEur > 0 ? rates.usdToEur : null;
  return null;
}

/**
 * `minor` of `from` in `to`, in `to`'s smallest unit. `rwfRate` is a stored RWF-per-USD rate for this amount (it
 * replaces today's rate on the RWF side). Null when a rate is missing. Same currency: the amount itself.
 */
export function convertMinor(minor: number, from: string, to: string, rates: Rates, rwfRate?: number | null): number | null {
  if (from === to) return minor;
  const a = perUsd(from, rates, rwfRate);
  const b = perUsd(to, rates, rwfRate);
  if (!a || !b) return null;
  const major = minor / 10 ** digitsOf(from);
  return Math.round((major / a) * b * 10 ** digitsOf(to));
}

export type Shown = { text: string; approx: boolean; title: string | null };

/**
 * One amount for the admin: exact in its own currency, otherwise converted with "≈" and the original in the tooltip.
 * An amount in a currency without a rate stays in its own currency.
 */
export function showMoney(minor: number, from: string, d: MoneyDisplay, opts: { rwfRate?: number | null } = {}): Shown {
  const cur = (from || "USD").toUpperCase();
  if (cur === d.currency) return { text: formatMoney(minor, cur), approx: false, title: null };
  const converted = convertMinor(minor, cur, d.currency, d.rates, opts.rwfRate);
  if (converted === null) return { text: formatMoney(minor, cur), approx: false, title: null };
  return { text: `≈ ${formatMoney(converted, d.currency)}`, approx: true, title: `${formatMoney(minor, cur)}${opts.rwfRate ? ` (at ${opts.rwfRate.toLocaleString("en-US")} RWF/USD)` : ""}` };
}

/**
 * A total kept in USD cents (the books) of which a part was received in RWF: `rwfMinor` exact RWF worth `rwfUsdCents`
 * at the rates fixed when they were paid. In RWF the RWF part is shown exactly and only the rest is converted; in USD
 * the stored USD values are used; in EUR everything goes through the USD values.
 */
export function showMixed(input: { usdCents: number; rwfMinor?: number; rwfUsdCents?: number }, d: MoneyDisplay): Shown {
  const rwfMinor = input.rwfMinor ?? 0;
  const rwfUsd = input.rwfUsdCents ?? 0;
  if (d.currency === "USD") return { text: formatMoney(input.usdCents, "USD"), approx: false, title: rwfMinor ? `Includes ${formatMoney(rwfMinor, "RWF")} received in RWF, at the rates on the day` : null };
  if (d.currency === "RWF") {
    const rest = input.usdCents - rwfUsd;
    const restRwf = rest === 0 ? 0 : convertMinor(rest, "USD", "RWF", d.rates);
    if (restRwf === null) return { text: formatMoney(input.usdCents, "USD"), approx: false, title: null };
    const total = rwfMinor + restRwf;
    if (rest === 0) return { text: formatMoney(total, "RWF"), approx: false, title: null };
    return { text: `≈ ${formatMoney(total, "RWF")}`, approx: true, title: `${formatMoney(input.usdCents, "USD")}${rwfMinor ? `, of which ${formatMoney(rwfMinor, "RWF")} received in RWF (exact)` : ""}` };
  }
  return showMoney(input.usdCents, "USD", d);
}

/** A display that converts nothing (USD as stored): the default outside a request and in tests. */
export const BOOKS: MoneyDisplay = { currency: "USD", rates: { usdToRwf: 1450, usdToEur: 0.92 } };

/** EUR per USD from the ECB reference rates (api.frankfurter.app answer), or null when the answer is not usable. */
export function parseFrankfurter(body: unknown): number | null {
  const rate = (body as { rates?: { EUR?: unknown } } | null)?.rates?.EUR;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0.1 && rate < 10 ? rate : null;
}
