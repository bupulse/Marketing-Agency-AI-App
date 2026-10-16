// Ways customers can reach the business: phone numbers (E.164), an email, a website and social profiles.
// Pure (lib/phone is pure too), so the form, the server action, the chat prompt and the widget agree.
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { formatPhone, isValidPhone, phoneErrorMessage, toE164 } from "@/lib/phone";
import { COUNTRY_CODES } from "@/lib/region-format";

export const CONTACT_TYPES = ["whatsapp", "phone", "whatsapp_call", "email", "website", "instagram", "facebook", "tiktok"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_LABELS: Record<ContactType, string> = {
  whatsapp: "WhatsApp",
  phone: "Phone call",
  whatsapp_call: "WhatsApp + calls (same number)",
  email: "Email",
  website: "Website",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export const MAX_CONTACTS = 10;

/**
 * A stored contact. `value` is normalised: E.164 for the phone types, a lower-case address for email, an https URL
 * for the website, and the handle (no @) for Instagram and TikTok, or the page path for Facebook.
 */
export type Contact = { type: ContactType; value: string; primary?: boolean };

export const isPhoneType = (t: ContactType) => t === "whatsapp" || t === "phone" || t === "whatsapp_call";
export const canWhatsApp = (t: ContactType) => t === "whatsapp" || t === "whatsapp_call";
export const canCall = (t: ContactType) => t === "phone" || t === "whatsapp_call";

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const TIKTOK_HANDLE = /^[A-Za-z0-9._]{2,24}$/;
const FACEBOOK_PATH = /^[A-Za-z0-9.\-]{1,80}$/;

const SOCIAL_HOSTS: Record<"instagram" | "facebook" | "tiktok", string[]> = {
  instagram: ["instagram.com", "www.instagram.com", "m.instagram.com"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "www.fb.com"],
  tiktok: ["tiktok.com", "www.tiktok.com", "m.tiktok.com"],
};

function asUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^(www\.|m\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(text)) return null;
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/** The website as "https://host/path", or null when it is not a public web address. */
export function normaliseWebsite(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)) return null;
  url.hash = "";
  const out = url.toString();
  return out.endsWith("/") && url.pathname === "/" && !url.search ? out.slice(0, -1) : out;
}

/** "@shop.kigali", "instagram.com/shop.kigali/" and "https://www.instagram.com/shop.kigali?igsh=x" all give "shop.kigali". */
export function normaliseSocial(type: "instagram" | "facebook" | "tiktok", raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const url = asUrl(text);
  let handle: string;
  if (url) {
    if (!SOCIAL_HOSTS[type].includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (type === "facebook" && parts[0] === "profile.php") {
      const id = url.searchParams.get("id");
      return id && /^\d{1,30}$/.test(id) ? `profile.php?id=${id}` : null;
    }
    if (type === "facebook" && parts[0] === "people" && parts.length >= 3 && /^\d{1,30}$/.test(parts[2])) return `profile.php?id=${parts[2]}`;
    handle = (type === "facebook" && parts[0] === "pg" ? parts[1] : parts[0]) ?? "";
  } else {
    if (type === "facebook" && /^profile\.php\?id=\d{1,30}$/.test(text)) return text;
    handle = text;
  }
  try {
    handle = decodeURIComponent(handle);
  } catch {
    return null; // a stray "%" is a typo, not a profile
  }
  handle = handle.replace(/^@/, "");
  if (type === "instagram") return HANDLE.test(handle) && !handle.startsWith(".") && !handle.endsWith(".") ? handle.toLowerCase() : null;
  if (type === "tiktok") return TIKTOK_HANDLE.test(handle) ? handle.toLowerCase() : null;
  return FACEBOOK_PATH.test(handle) ? handle : null;
}

/** Turns what was typed into the stored value, or explains what is wrong. `country` is the ISO code for phone types. */
export function normaliseContact(
  type: ContactType,
  raw: string,
  country: CountryCode | null,
  countryName?: string | null,
): { ok: true; value: string } | { ok: false; error: string } {
  const text = raw.trim();
  if (isPhoneType(type)) {
    const e164 = isValidPhone(text, country) ? toE164(text, country) : null;
    return e164 ? { ok: true, value: e164 } : { ok: false, error: phoneErrorMessage(countryName) };
  }
  if (type === "email") {
    const email = text.toLowerCase().replace(/^mailto:/, "");
    return EMAIL.test(email) && email.length <= 254 ? { ok: true, value: email } : { ok: false, error: "Enter an email like hello@yourbusiness.com." };
  }
  if (type === "website") {
    const url = text.length <= 300 ? normaliseWebsite(text) : null;
    return url ? { ok: true, value: url } : { ok: false, error: "Enter a website like yourbusiness.com." };
  }
  const handle = normaliseSocial(type, text);
  const name = CONTACT_LABELS[type];
  return handle ? { ok: true, value: handle } : { ok: false, error: `Enter your ${name} handle (@yourbusiness) or the link to your ${name} page.` };
}

/** Whether an already stored value is in its normal form (used when reading saved JSON). */
export function isNormalised(c: Contact): boolean {
  if (isPhoneType(c.type)) {
    const p = parsePhoneNumberFromString(c.value);
    return !!p && p.isValid() && p.number === c.value;
  }
  const again = normaliseContact(c.type, c.value, null);
  return again.ok && again.value === c.value;
}

/** Link for a stored contact: tel:, https://wa.me/, mailto:, or the profile URL. */
export function contactHref(c: Contact): string {
  switch (c.type) {
    case "phone":
      return telLink(c.value);
    case "whatsapp":
    case "whatsapp_call":
      return whatsAppLink(c.value);
    case "email":
      return `mailto:${c.value}`;
    case "website":
      return c.value;
    case "instagram":
      return `https://www.instagram.com/${c.value}`;
    case "tiktok":
      return `https://www.tiktok.com/@${c.value}`;
    case "facebook":
      return `https://www.facebook.com/${c.value}`;
  }
}

/** "+250 791 954 277", "@shop.kigali", "yourbusiness.com". */
export function contactDisplay(c: Contact): string {
  if (isPhoneType(c.type)) return formatPhone(c.value);
  if (c.type === "instagram" || c.type === "tiktok") return `@${c.value}`;
  if (c.type === "facebook") return `facebook.com/${c.value}`;
  if (c.type === "website") return c.value.replace(/^https?:\/\//, "");
  return c.value;
}

/** https://wa.me/250791954277 (digits of the E.164 number only). */
export function whatsAppLink(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

export function telLink(e164: string): string {
  return `tel:+${e164.replace(/\D/g, "")}`;
}

/** The primary contact, else the first. */
export function primaryContact(contacts: readonly Contact[]): Contact | undefined {
  return contacts.find((c) => c.primary) ?? contacts[0];
}

/**
 * Chat widget buttons: WhatsApp and Call. Each uses the primary contact when it can do that, else the first contact
 * that can. Undefined when there is no such number.
 */
export function quickActions(contacts: readonly Contact[]): { whatsapp?: string; call?: string } {
  const ordered = [...contacts].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  const wa = ordered.find((c) => canWhatsApp(c.type));
  const call = ordered.find((c) => canCall(c.type));
  return { whatsapp: wa ? whatsAppLink(wa.value) : undefined, call: call ? telLink(call.value) : undefined };
}

/** "WhatsApp +250 791 954 277 (main contact); Email hello@x.com". */
export function summarizeContacts(contacts: readonly Contact[]): string {
  return contacts
    .map((c) => {
      const label = c.type === "whatsapp_call" ? "WhatsApp and phone calls" : CONTACT_LABELS[c.type];
      const link = c.type === "instagram" || c.type === "tiktok" || c.type === "facebook" ? ` (${contactHref(c)})` : "";
      return `${label} ${contactDisplay(c)}${link}${c.primary ? " (main contact)" : ""}`;
    })
    .join("; ");
}

// ---- old free-text contact ----

/** ISO code -> sign-up country name ("RW" -> "Rwanda"), for the phone country picker. */
export function countryNameForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.keys(COUNTRY_CODES).find((name) => COUNTRY_CODES[name] === code) ?? null;
}

/** The country a stored E.164 number belongs to. */
export function phoneCountryCode(e164: string): CountryCode | null {
  return parsePhoneNumberFromString(e164)?.country ?? null;
}

/**
 * Best-effort contacts from old free text ("Call or WhatsApp +250 788 000 000, hello@x.com"). `rest` is whatever
 * meaningful text is left ("ask for Grace"), so the editor can keep it as a note; it is the whole text when nothing
 * was recognised.
 */
export function parseLegacyContact(text: string | null | undefined, country: CountryCode | null): { contacts: Contact[]; rest: string } {
  const src = (text ?? "").trim();
  if (!src) return { contacts: [], rest: "" };
  const out: Contact[] = [];
  let rest = src;
  const mentionsWhatsApp = /whats\s?app|\bwa\b/i.test(src);
  const mentionsCall = /\bcall|phone|\btel\b|telephone|appel/i.test(src);
  const type: ContactType = mentionsWhatsApp && mentionsCall ? "whatsapp_call" : mentionsWhatsApp ? "whatsapp" : "phone";
  for (const match of src.matchAll(/\+?\d[\d\s().-]{6,}\d/g)) {
    const e164 = toE164(match[0], country);
    if (!e164) continue;
    rest = rest.replace(match[0], " ");
    if (!out.some((c) => c.value === e164)) out.push({ type, value: e164 });
  }
  for (const match of src.matchAll(/[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}/gi)) {
    const email = match[0].toLowerCase();
    rest = rest.replace(match[0], " ");
    if (!out.some((c) => c.value === email)) out.push({ type: "email", value: email });
  }
  if (!out.length) return { contacts: [], rest: src };
  out[0].primary = true;
  const filler = /\b(call|calls|calling|or|and|us|on|at|via|by|whats\s?app|wa|phone|tel|telephone|email|e-mail|mail|contact|number|anytime|text|sms)\b/gi;
  const left = rest.replace(filler, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return { contacts: out, rest: left.length >= 4 ? src : "" };
}
