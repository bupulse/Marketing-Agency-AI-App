// VAT on Rwandan prices (owner's decision, 12 Nov 2026; docs/BILLING.md, "VAT"). Pure: no server imports, so the admin price
// editors, the client pages and the tests share one source of truth. The server reads the settings with
// getVatSettings() (lib/billing/vat-server.ts).
//
// The rules:
// - Only RWF prices carry VAT (the Rwanda region, paid by Mobile Money or invoice). USD prices never do: card payments
//   go through Paddle, which is the merchant of record and adds tax itself.
// - Every RWF amount stored in the database (regional plan prices, custom plan prices, offers, add-on prices) is the
//   price BEFORE VAT. The client sees and pays the price WITH VAT: net x (1 + rate), rounded to the nearest 100 RWF.
// - A receipt splits what was paid: VAT = round(total x rate / (100 + rate)); before VAT = total - VAT.

export type VatSettings = {
  /** On by default: BuPulse is VAT-registered with RRA. */
  enabled: boolean;
  /** Percent, 18 in Rwanda. */
  ratePercent: number;
  /** BuPulse's tax id (TIN) at RRA. Empty until the owner fills it in; receipts then leave the TIN line out. */
  tin: string;
};

export const DEFAULT_VAT_RATE_PERCENT = 18;
export const DEFAULT_VAT_SETTINGS: VatSettings = { enabled: true, ratePercent: DEFAULT_VAT_RATE_PERCENT, tin: "" };

/** The only currency VAT is added to. */
export const VAT_CURRENCY = "RWF";

/** Client prices with VAT are rounded to this many RWF. */
export const VAT_ROUND_TO = 100;

/** True when prices in `currency` carry VAT with these settings (RWF only, switch on, a rate above 0). */
export function vatApplies(currency: string | null | undefined, vat: VatSettings): boolean {
  return vat.enabled && vat.ratePercent > 0 && String(currency ?? "").toUpperCase() === VAT_CURRENCY;
}

/** The rate to use for `currency`, or null when no VAT is added. */
export function vatRateFor(currency: string | null | undefined, vat: VatSettings): number | null {
  return vatApplies(currency, vat) ? vat.ratePercent : null;
}

/** The price with VAT of a price before VAT, in whole RWF, rounded to the nearest 100. 15,000 -> 17,700 at 18%. */
export function grossRwf(netMinor: number, ratePercent: number = DEFAULT_VAT_RATE_PERCENT): number {
  if (!Number.isFinite(netMinor) || netMinor <= 0) return 0;
  if (!(ratePercent > 0)) return Math.round(netMinor);
  return Math.round((netMinor * (100 + ratePercent)) / (100 * VAT_ROUND_TO)) * VAT_ROUND_TO;
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

/** What the client pays for a stored price: with VAT when it applies to the currency, else the price as it is. */
export function clientPrice(netMinor: number, currency: string | null | undefined, vat: VatSettings): number {
  return vatApplies(currency, vat) ? grossRwf(netMinor, vat.ratePercent) : netMinor;
}

/** A total split for a receipt: what was paid, the VAT in it and the amount before VAT. */
export type VatBreakdown = { totalMinor: number; vatMinor: number; netMinor: number; ratePercent: number; tin: string };

/** The split of a paid total, or null when the currency carries no VAT (or the switch is off). */
export function vatBreakdown(totalMinor: number, currency: string | null | undefined, vat: VatSettings): VatBreakdown | null {
  if (!vatApplies(currency, vat)) return null;
  const vatMinor = vatPart(totalMinor, vat.ratePercent);
  return { totalMinor, vatMinor, netMinor: totalMinor - vatMinor, ratePercent: vat.ratePercent, tin: vat.tin };
}

/** For an admin price field: what the VAT is and what the client pays for a price before VAT. Null when no VAT. */
export function adminVatPreview(netMinor: number | null | undefined, currency: string | null | undefined, vat: VatSettings): { ratePercent: number; vatMinor: number; grossMinor: number } | null {
  if (!vatApplies(currency, vat) || netMinor == null || !Number.isFinite(netMinor) || netMinor <= 0) return null;
  const grossMinor = grossRwf(netMinor, vat.ratePercent);
  return { ratePercent: vat.ratePercent, vatMinor: grossMinor - netMinor, grossMinor };
}

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

// ---- reading the stored settings (AdminSetting rows, defaults when missing or malformed) -------------------------

export const VAT_SETTING_KEYS = { enabled: "billing.vat.enabled", ratePercent: "billing.vat.ratePercent", tin: "billing.vat.tin" } as const;

/** Checks a TIN: letters, digits, spaces, dots, dashes and slashes, at most 40 characters. Empty is allowed. */
export function vatTinProblem(tin: string): string | null {
  if (tin.length > 40) return "The TIN is at most 40 characters.";
  if (tin && !/^[A-Za-z0-9 .\-/]+$/.test(tin)) return "The TIN can only have letters, digits, spaces, dots, dashes and slashes.";
  return null;
}

/** Turns stored values into settings; anything missing or malformed takes the default. */
export function cleanVatSettings(raw: { enabled?: unknown; ratePercent?: unknown; tin?: unknown }): VatSettings {
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_VAT_SETTINGS.enabled;
  const rate = typeof raw.ratePercent === "number" ? raw.ratePercent : typeof raw.ratePercent === "string" ? Number(raw.ratePercent) : NaN;
  const ratePercent = Number.isFinite(rate) && rate > 0 && rate <= 100 ? rate : DEFAULT_VAT_SETTINGS.ratePercent;
  const tin = typeof raw.tin === "string" && !vatTinProblem(raw.tin.trim()) ? raw.tin.trim() : DEFAULT_VAT_SETTINGS.tin;
  return { enabled, ratePercent, tin };
}
