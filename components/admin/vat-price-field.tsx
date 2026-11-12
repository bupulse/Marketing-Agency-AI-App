"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";
import type { VatSettings } from "@/lib/billing/vat";
import { parseMoney } from "@/lib/invoices/shared";
import { vatHintText } from "./vat-hint";

/**
 * A price field where the admin types the price BEFORE VAT. For an RWF price (with VAT on) it shows, as they type,
 * "VAT 18%: X · Client pays: Y" (lib/billing/vat.ts); otherwise the plain hint.
 */
export function VatPriceField({ label, name, currency, vat, defaultValue = "", placeholder, required, className, hint }: { label: string; name: string; currency: string; vat: VatSettings; defaultValue?: string; placeholder?: string; required?: boolean; className?: string; hint?: string }) {
  const [value, setValue] = useState(defaultValue);
  const vatText = value.trim() ? vatHintText(parseMoney(value, currency), currency, vat) : null;
  const before = vat.enabled && currency.toUpperCase() === "RWF" ? "Before VAT." : null;
  return (
    <Field label={label} required={required} hint={vatText ?? ([before, hint].filter(Boolean).join(" ") || undefined)}>
      <Input name={name} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required={required} className={className} placeholder={placeholder} />
    </Field>
  );
}
