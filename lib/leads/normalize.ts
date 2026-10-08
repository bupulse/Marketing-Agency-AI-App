// Loose, forgiving cleaning of the details a visitor types into the chat. Pure, no I/O.
// A value that does not look right is dropped (not stored); it never blocks the lead.

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Trims, strips control characters and cuts to `max`. Empty becomes undefined. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(CONTROL, "").trim().slice(0, max);
  return text || undefined;
}

/** Lower-case email, or undefined when it does not look like one. */
export function normalizeEmail(value: unknown): string | undefined {
  const email = cleanText(value, 200)?.toLowerCase();
  if (!email) return undefined;
  return /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/.test(email) ? email : undefined;
}

/**
 * Phone as digits with an optional leading "+" (spaces, dashes, dots and brackets removed;
 * "00" at the start means "+"). Needs 7 to 15 digits, otherwise undefined.
 */
export function normalizePhone(value: unknown): string | undefined {
  const raw = cleanText(value, 40);
  if (!raw) return undefined;
  if (/[^\d\s()+\-.\/]/.test(raw)) return undefined;
  let digits = raw.replace(/\D/g, "");
  let plus = raw.startsWith("+");
  if (!plus && digits.startsWith("00")) {
    digits = digits.slice(2);
    plus = true;
  }
  if (digits.length < 7 || digits.length > 15) return undefined;
  return (plus ? "+" : "") + digits;
}

/** wa.me link for a stored phone, or null when it has no usable number. */
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}

/** tel: link for a stored phone. */
export function telLink(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  return normalized ? `tel:${normalized}` : null;
}

/** http(s) page URL, or undefined. Only the URL is kept, never script or data URLs. */
export function normalizePageUrl(value: unknown): string | undefined {
  const text = cleanText(value, 500);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString().slice(0, 500) : undefined;
  } catch {
    return undefined;
  }
}
