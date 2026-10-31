// The pre-chat form's checks (name, email and business required; WhatsApp optional, after the flag and dial code
// picker, Rwanda's +250 to start with). Pure, so tested.
import { toE164 } from "@/lib/phone";
import { prechatBody } from "../contract";
import { COPY } from "./copy";

export type PrechatValues = { name: string; email: string; business: string; whatsapp: string };
export type PrechatErrors = Partial<Record<keyof PrechatValues, string>>;

/** "0788 123 456", "788123456", "+250 788 123 456" → "+250788123456"; "" stays empty; anything else is null. */
export function rwandaWhatsapp(raw: string): string | null {
  let d = raw.replace(/[\s().-]/g, "");
  if (!d) return "";
  if (d.startsWith("+250")) d = d.slice(4);
  else if (d.startsWith("250") && d.length === 12) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return /^7\d{8}$/.test(d) ? `+250${d}` : null;
}

/**
 * The number from the phone field: a Rwandan one the usual ways (above), or another country's, which the field only
 * gives with its own dial code ("+254 712 345678") once that country is picked. "" stays empty; anything else is null.
 */
export function prechatWhatsapp(raw: string): string | null {
  const rwanda = rwandaWhatsapp(raw);
  if (rwanda !== null) return rwanda;
  const compact = raw.replace(/[\s().-]/g, "");
  if (!compact.startsWith("+") || compact.startsWith("+250")) return null;
  return toE164(compact, null);
}

export function checkPrechat(v: PrechatValues): { ok: true; body: { name: string; email: string; business: string; whatsapp?: string } } | { ok: false; errors: PrechatErrors } {
  const errors: PrechatErrors = {};
  const wa = prechatWhatsapp(v.whatsapp);
  if (!v.name.trim()) errors.name = COPY.needName;
  if (!prechatBody.shape.email.safeParse(v.email.trim()).success) errors.email = COPY.needEmail;
  if (!v.business.trim()) errors.business = COPY.needBusiness;
  if (wa === null) errors.whatsapp = COPY.badPhone;
  if (Object.keys(errors).length) return { ok: false, errors };
  const body = { name: v.name.trim().slice(0, 120), email: v.email.trim().slice(0, 200), business: v.business.trim().slice(0, 160), ...(wa ? { whatsapp: wa } : {}) };
  return { ok: true, body };
}
