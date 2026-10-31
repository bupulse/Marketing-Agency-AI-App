import { toE164 } from "@/lib/phone";

// The quote form's phone number, stored as E.164 so the owner can tap to call or WhatsApp it. Most people asking for a
// quote are in Rwanda and type their number the local way ("0788 123 456", "788123456", "250788123456"), so a number
// without a "+" or "00" is read as Rwandan. A number written with its own country code ("+254 712 345 678",
// "00 33 6 12 34 56 78") is kept as that country's. Pure, so the form, the server and the tests agree.

export const QUOTE_PHONE_COUNTRY = "RW" as const;

/** E.164 ("+250788123456"), or null when the text is not a valid phone number. */
export function normaliseQuotePhone(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 40 || /[^\d\s+().-]/.test(raw)) return null;
  const international = /^\s*(\+|00)/.test(raw);
  // An international number is checked against its own country (no country passed), a local one against Rwanda's.
  return international ? toE164(raw, null) : toE164(raw, QUOTE_PHONE_COUNTRY);
}

/** "tel:+250788123456": opens the phone app with the number ready to call. */
export function telHref(e164: string): string {
  return `tel:${e164.replace(/[^\d+]/g, "")}`;
}

/** "https://wa.me/250788123456": opens a WhatsApp chat with the number (wa.me wants the digits only). */
export function whatsappHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}
