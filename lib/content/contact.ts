// Contact links for the public pages. Pure, so it can be tested and used on the server or the client.

/** Digits of an international phone number ("+250 791 954 277" → "250791954277"); null when it can't be one. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** A wa.me link with an optional prefilled message, or null when the number is missing or invalid. */
export function whatsappLink(raw: string | null | undefined, text?: string): string | null {
  const digits = whatsappDigits(raw);
  if (!digits) return null;
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}
