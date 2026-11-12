import { adminVatPreview, type VatSettings } from "@/lib/billing/vat";
import { formatMinor } from "@/lib/region-format";
import { cn } from "@/lib/cn";

/** "VAT 18%: 2,700 RWF · Client pays: 17,700 RWF" for a price before VAT, or the plain text without VAT. */
export function vatHintText(netMinor: number | null | undefined, currency: string, vat: VatSettings): string | null {
  const p = adminVatPreview(netMinor, currency, vat);
  return p ? `VAT ${p.ratePercent}%: ${formatMinor(p.vatMinor, currency)} · Client pays: ${formatMinor(p.grossMinor, currency)}` : null;
}

/**
 * Beside a price an admin set (before VAT): what the VAT is and what the client pays (lib/billing/vat.ts). Shows
 * nothing for a currency without VAT (USD, card prices) or with the VAT switch off.
 */
export function VatHint({ minor, currency, vat, className }: { minor: number | null | undefined; currency: string; vat: VatSettings; className?: string }) {
  const text = vatHintText(minor, currency, vat);
  if (!text) return null;
  return <span className={cn("block text-[12px] font-normal text-muted", className)}>{text}</span>;
}
