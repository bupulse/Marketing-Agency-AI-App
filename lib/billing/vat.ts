// VAT: the one module for it (docs/BILLING.md "VAT", docs/REGIONS.md "VAT"). Pure: no server imports, so the admin
// price editors, the client pages and the tests share one source of truth. The server builds the settings with
// getVatSettings() (lib/billing/vat-server.ts).
//
// The rules (owner, 12 Nov 2026: BuPulse is VAT-registered with RRA):
// - The rate lives on the pricing region: PricingRegion.vatRateBps (Admin -> Money -> Regions), 1800 = 18% for Rwanda,
//   0 everywhere else. There is no other switch: 0% means no VAT. Admin -> Settings -> VAT only keeps BuPulse's TIN.
// - VAT is only added to what BuPulse collects itself (Mobile Money, invoices), in a region's own currency. USD prices
//   never get it: card payments go through Paddle, the merchant of record, which adds tax itself. The region editor
//   refuses a VAT rate on a USD region, and two regions in one currency share one rate, so "the rate of a currency"
//   is always well defined (VatSettings.rates).
// - Every amount stored in the database (regional plan prices, custom plan prices, offers, add-on prices) is the
//   price BEFORE VAT. The client sees and pays the price WITH VAT: net x (1 + rate), rounded to the nearest 100 RWF
//   in RWF (to the smallest unit in any other currency). 15,000 -> 17,700, 50,000 -> 59,000, 80,000 -> 94,400.
// - Every VAT amount shown or stored (price lines, invoices, receipts, payments, revenue) is the split of the total the
//   client pays: VAT = round(total x rate / (100 + rate));
//   before VAT = total - VAT. 59,000 -> 9,000 VAT. Revenue counts the part before VAT.

import { formatMinor } from "@/lib/region-format";

/** The VAT the server knows: the rate of each currency that carries VAT (from the regions) and BuPulse's TIN. */
export type VatSettings = {
  /** Currency (upper case) -> percent. Only currencies with a rate above 0 are listed. */
  rates: Record<string, number>;
  /** BuPulse's tax id (TIN) at RRA. Empty until the owner fills it in; receipts then leave the TIN line out. */
  tin: string;
};

/** Rwanda's rate, the one BuPulse charges today; the default of grossRwf and friends. */
export const DEFAULT_VAT_RATE_PERCENT = 18;
/** No region read yet: no rates, no TIN. */
export const DEFAULT_VAT_SETTINGS: VatSettings = { rates: {}, tin: "" };

/** The currency whose prices with VAT are rounded to VAT_ROUND_TO. */
export const VAT_CURRENCY = "RWF";
/** Client prices with VAT in RWF are rounded to this many RWF. */
export const VAT_ROUND_TO = 100;

export const DEFAULT_VAT_LABEL = "VAT";
export const MAX_VAT_BPS = 10_000;

// ---- the one "add VAT" helper -------------------------------------------------------------------------------------

/**
 * The price with VAT of a price before VAT, at a rate in basis points. RWF is rounded to the nearest 100 (half up),
 * any other currency to its smallest unit. 0 or no rate: the price as it is.
 */
export function addVat(netMinor: number, rateBps: number, currency: string | null | undefined): number {
  if (!Number.isFinite(netMinor) || netMinor <= 0) return 0;
  if (!(rateBps > 0)) return Math.round(netMinor);
  const gross = (netMinor * (10_000 + rateBps)) / 10_000;
  if (String(currency ?? "").toUpperCase() === VAT_CURRENCY) return Math.round(gross / VAT_ROUND_TO) * VAT_ROUND_TO;
  return Math.round(gross);
}

/** The price with VAT in whole RWF, rounded to the nearest 100. 15,000 -> 17,700 at 18%. */
export function grossRwf(netMinor: number, ratePercent: number = DEFAULT_VAT_RATE_PERCENT): number {
  return addVat(netMinor, Math.round(ratePercent * 100), VAT_CURRENCY);
}

/** The VAT inside a total that includes it: round(total x rate / (100 + rate)). 17,700 -> 2,700 at 18%. */
export function vatPart(grossMinor: number, ratePercent: number = DEFAULT_VAT_RATE_PERCENT): number {
  if (!Number.isFinite(grossMinor) || grossMinor <= 0 || !(ratePercent > 0)) return 0;
  return Math.round((grossMinor * ratePercent) / (100 + ratePercent));
}

/** The amount before VAT inside a total that includes it. 17,700 -> 15,000 at 18%. */
export function netFromGross(grossMinor: number, ratePercent: number = DEFAULT_VAT_RATE_PERCENT): number {
  return Math.max(0, Math.round(grossMinor) - vatPart(grossMinor, ratePercent));
}

// ---- a region's VAT ----------------------------------------------------------------------------------------------

export type VatInfo = { rateBps: number; label: string };

/** A region's VAT, or null when it has none (0%, missing or nonsense). */
export function vatOf(region: { vatRateBps?: number | null; vatLabel?: string | null } | null | undefined): VatInfo | null {
  const bps = Number(region?.vatRateBps ?? 0);
  if (!Number.isInteger(bps) || bps <= 0 || bps > MAX_VAT_BPS) return null;
  return { rateBps: bps, label: (region?.vatLabel ?? "").trim() || DEFAULT_VAT_LABEL };
}

/**
 * A price shown with its VAT: what the client pays (the price before VAT plus the rate, RWF rounded to 100) split the
 * way the receipt splits it, so a price, its invoice and its payment always show the same VAT.
 */
export type VatPrice = {
  /** The amount before VAT: totalMinor - vatMinor (the typed price; a few francs less when the 100-RWF rounding went down). */
  netMinor: number;
  /** The VAT inside totalMinor: round(total x rate / (100 + rate)). */
  vatMinor: number;
  /** What the client pays. */
  totalMinor: number;
  /** 0 when there is no VAT. */
  rateBps: number;
  label: string;
};

/** A price before VAT with a region's VAT on top (addVat); without VAT the total is the price, rate 0. */
export function priceWithVat(netMinor: number, vat: VatInfo | null, currency: string | null | undefined): VatPrice {
  const rateBps = vat?.rateBps ?? 0;
  const totalMinor = rateBps > 0 ? addVat(netMinor, rateBps, currency) : netMinor;
  const vatMinor = rateBps > 0 ? vatPart(totalMinor, rateBps / 100) : 0;
  return { netMinor: totalMinor - vatMinor, vatMinor, totalMinor, rateBps, label: vat?.label ?? DEFAULT_VAT_LABEL };
}

/** What gets stored on a Mobile Money payment: the VAT inside the amount sent (the receipt split) and its rate. */
export function paymentVat(amountMinor: number, rateBps: number | null | undefined): { vatMinor: number; vatRateBps: number | null } {
  return rateBps && rateBps > 0 ? { vatMinor: vatPart(amountMinor, rateBps / 100), vatRateBps: rateBps } : { vatMinor: 0, vatRateBps: null };
}

/** The rates of every currency that carries VAT, from the regions. USD never does (Paddle adds tax on card payments). */
export function vatRatesFromRegions(regions: readonly { currency: string; vatRateBps?: number | null }[]): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const r of regions) {
    const currency = r.currency.toUpperCase();
    const vat = vatOf(r);
    if (!vat || currency === "USD" || rates[currency]) continue;
    rates[currency] = vat.rateBps / 100;
  }
  return rates;
}

/** Settings holding just the rate a payment was made with (its vatRateBps snapshot), so a later rate change never re-prices it. */
export function vatSettingsAt(currency: string | null | undefined, rateBps: number | null | undefined, tin = ""): VatSettings {
  const code = String(currency ?? "").toUpperCase();
  return { rates: rateBps && rateBps > 0 && code && code !== "USD" ? { [code]: rateBps / 100 } : {}, tin };
}

/**
 * One region's VAT as settings: its rate on amounts in its own currency (never USD). What a company's custom offers
 * and plans are priced with, so the price shown always equals what Mobile Money charges (lib/billing/momo-shared.ts withRegionVat).
 */
export function vatSettingsOfRegion(region: { currency: string; vatRateBps?: number | null } | null | undefined, tin = ""): VatSettings {
  return region ? vatSettingsAt(region.currency, vatOf(region)?.rateBps ?? null, tin) : { rates: {}, tin };
}

// ---- by currency, for amounts that only know their currency (offers, custom plans, invoices, add-ons) ----------

/** The rate to use for `currency` in percent, or null when no VAT is added. */
export function vatRateFor(currency: string | null | undefined, vat: VatSettings): number | null {
  const rate = vat.rates[String(currency ?? "").toUpperCase()];
  return rate && rate > 0 ? rate : null;
}

/** True when prices in `currency` carry VAT with these settings. */
export function vatApplies(currency: string | null | undefined, vat: VatSettings): boolean {
  return vatRateFor(currency, vat) !== null;
}

/** What the client pays for a stored price: with VAT when its currency carries VAT, else the price as it is. */
export function clientPrice(netMinor: number, currency: string | null | undefined, vat: VatSettings): number {
  const rate = vatRateFor(currency, vat);
  return rate ? addVat(netMinor, Math.round(rate * 100), currency) : netMinor;
}

/** A total split for a receipt: what was paid, the VAT in it and the amount before VAT. */
export type VatBreakdown = { totalMinor: number; vatMinor: number; netMinor: number; ratePercent: number; tin: string };

/** The split of a paid total at a known rate (percent), or null without a rate. */
export function splitTotal(totalMinor: number, ratePercent: number | null | undefined, tin = ""): VatBreakdown | null {
  if (!ratePercent || !(ratePercent > 0)) return null;
  const vatMinor = vatPart(totalMinor, ratePercent);
  return { totalMinor, vatMinor, netMinor: totalMinor - vatMinor, ratePercent, tin };
}

/** The split of a paid total, or null when the currency carries no VAT. */
export function vatBreakdown(totalMinor: number, currency: string | null | undefined, vat: VatSettings): VatBreakdown | null {
  return splitTotal(totalMinor, vatRateFor(currency, vat), vat.tin);
}

/** For an admin price field: what the VAT is and what the client pays for a price before VAT. Null when no VAT. */
export function adminVatPreview(netMinor: number | null | undefined, currency: string | null | undefined, vat: VatSettings): { ratePercent: number; vatMinor: number; grossMinor: number } | null {
  const rate = vatRateFor(currency, vat);
  if (!rate || netMinor == null || !Number.isFinite(netMinor) || netMinor <= 0) return null;
  const grossMinor = addVat(netMinor, Math.round(rate * 100), currency);
  return { ratePercent: rate, vatMinor: vatPart(grossMinor, rate), grossMinor };
}

// ---- words -------------------------------------------------------------------------------------------------------

/** The small note beside a price that includes VAT. */
export const VAT_INCLUDED_NOTE = "VAT included";

/** "VAT included (18%)" */
export function vatIncludedText(ratePercent: number): string {
  return `VAT included (${ratePercent}%)`;
}

/** Plain-text receipt lines for emails: "Of which VAT (18%): 2,700 RWF", "Before VAT: 15,000 RWF", "BuPulse TIN: …". */
export function vatReceiptLines(b: VatBreakdown, format: (minor: number) => string): { label: string; value: string }[] {
  return [
    { label: `Of which VAT (${b.ratePercent}%)`, value: format(b.vatMinor) },
    { label: "Amount before VAT", value: format(b.netMinor) },
    ...(b.tin ? [{ label: "BuPulse TIN", value: b.tin }] : []),
  ];
}

/** 1800 -> "18%", 1650 -> "16.5%". */
export function formatVatRate(rateBps: number): string {
  return `${(rateBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** "18" or "16.5" typed by the admin -> basis points; "", "0" -> 0; null when it is not a rate from 0 to 100. */
export function parseVatPercent(input: string | number | null | undefined): number | null {
  const raw = String(input ?? "").replace(/[%\s]/g, "").replace(",", ".");
  if (raw === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const bps = Math.round(Number(raw) * 100);
  return bps >= 0 && bps <= MAX_VAT_BPS ? bps : null;
}

/** The invoice's percent column (Invoice.taxRatePercent) of a rate in basis points: 1800 -> 18; none -> null. */
export function vatPercentOf(rateBps: number | null | undefined): number | null {
  return rateBps && rateBps > 0 ? rateBps / 100 : null;
}

/** "50,000 + 9,000 VAT = 59,000 RWF", or just "50,000 RWF" without VAT. */
export function vatSentence(b: VatPrice, currency: string): string {
  if (b.vatMinor <= 0) return formatMinor(b.netMinor, currency);
  // "50,000 + 9,000 VAT = 59,000 RWF": the trailing currency code is said once; "$49 + $8.82 VAT = $57.82" keeps its signs.
  const bare = (minor: number) => formatMinor(minor, currency).replace(new RegExp(` ${currency.toUpperCase()}$`), "");
  return `${bare(b.netMinor)} + ${bare(b.vatMinor)} ${b.label} = ${formatMinor(b.totalMinor, currency)}`;
}

// ---- BuPulse's TIN (an AdminSetting row) ------------------------------------------------------------------------

/**
 * The AdminSetting keys. Only the TIN is read: the rate moved to the regions (PricingRegion.vatRateBps). The old
 * "billing.vat.enabled" / "billing.vat.ratePercent" rows, if any exist, are ignored.
 */
export const VAT_SETTING_KEYS = { tin: "billing.vat.tin" } as const;

/** Checks a TIN: letters, digits, spaces, dots, dashes and slashes, at most 40 characters. Empty is allowed. */
export function vatTinProblem(tin: string): string | null {
  if (tin.length > 40) return "The TIN is at most 40 characters.";
  if (tin && !/^[A-Za-z0-9 .\-/]+$/.test(tin)) return "The TIN can only have letters, digits, spaces, dots, dashes and slashes.";
  return null;
}

/** A stored TIN, cleaned; anything missing or malformed is empty. */
export function cleanVatTin(raw: unknown): string {
  return typeof raw === "string" && !vatTinProblem(raw.trim()) ? raw.trim() : "";
}
