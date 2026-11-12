// VAT, per region (docs/REGIONS.md, "VAT"). Prices are typed before VAT; a region with a rate adds it on top, so a
// 50,000 RWF plan in Rwanda (18%) costs 50,000 + 9,000 VAT = 59,000 RWF. Amounts are in the currency's smallest unit
// (whole francs for RWF), so rounding to a whole number of minor units is the currency's own rounding. Pure.

import { formatMinor } from "@/lib/region-format";

export const DEFAULT_VAT_LABEL = "VAT";
export const MAX_VAT_BPS = 10_000;

export type VatInfo = { rateBps: number; label: string };

export type VatBreakdown = {
  /** The price before VAT. */
  netMinor: number;
  vatMinor: number;
  /** What the client pays. */
  totalMinor: number;
  /** 0 when the region has no VAT. */
  rateBps: number;
  label: string;
};

/** A region's VAT, or null when it has none (0%, missing or nonsense). */
export function vatOf(region: { vatRateBps?: number | null; vatLabel?: string | null } | null | undefined): VatInfo | null {
  const bps = Number(region?.vatRateBps ?? 0);
  if (!Number.isInteger(bps) || bps <= 0 || bps > MAX_VAT_BPS) return null;
  return { rateBps: bps, label: (region?.vatLabel ?? "").trim() || DEFAULT_VAT_LABEL };
}

/** The VAT on a net amount: rounded half up to the smallest unit (9,000 RWF on 50,000 at 18%). */
export function vatMinorOf(netMinor: number, rateBps: number): number {
  if (!(rateBps > 0) || !(netMinor > 0)) return 0;
  return Math.round((netMinor * rateBps) / 10_000);
}

/** Net, VAT and total of a price in a region (no VAT: total = net, rate 0). */
export function withVat(netMinor: number, vat: VatInfo | null): VatBreakdown {
  const rateBps = vat?.rateBps ?? 0;
  const vatMinor = vatMinorOf(netMinor, rateBps);
  return { netMinor, vatMinor, totalMinor: netMinor + vatMinor, rateBps, label: vat?.label ?? DEFAULT_VAT_LABEL };
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

/** "50,000 RWF + 9,000 VAT = 59,000 RWF", or just "50,000 RWF" without VAT. */
export function vatSentence(b: VatBreakdown, currency: string): string {
  if (b.vatMinor <= 0) return formatMinor(b.netMinor, currency);
  // "50,000 + 9,000 VAT = 59,000 RWF": the trailing currency code is said once; "$49 + $8.82 VAT = $57.82" keeps its signs.
  const bare = (minor: number) => formatMinor(minor, currency).replace(new RegExp(` ${currency.toUpperCase()}$`), "");
  return `${bare(b.netMinor)} + ${bare(b.vatMinor)} ${b.label} = ${formatMinor(b.totalMinor, currency)}`;
}
