// Phone numbers: the country chosen on the form decides the dial code, the as-you-type grouping and the validation.
// Pure (no server imports) so the sign-up form, the server actions and the admin pages share one behaviour. Uses the
// full metadata so isValid() agrees on the client and the server (the "min" metadata only checks plausible lengths).
import {
  AsYouType,
  getCountryCallingCode,
  getExampleNumber,
  isSupportedCountry,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from "libphonenumber-js/max";
import examples from "libphonenumber-js/mobile/examples";
import { countryCodeForName } from "@/lib/region-format";

/** ISO country code of a sign-up country name, when libphonenumber knows it. */
export function phoneCountry(countryName: string | null | undefined): CountryCode | null {
  const code = countryCodeForName(countryName);
  return code && isSupportedCountry(code) ? (code as CountryCode) : null;
}

/** "+250" for RW. Empty when the country is unknown. */
export function dialCode(country: CountryCode | null | undefined): string {
  if (!country || !isSupportedCountry(country)) return "";
  return `+${getCountryCallingCode(country)}`;
}

const trunkZero = new Map<CountryCode, boolean>();

/**
 * Whether a leading 0 is the country's trunk prefix, dropped after the dial code (Rwanda, Kenya, UK: yes; Italy,
 * Portugal, Côte d'Ivoire: no). Asked of libphonenumber: the country's example number written with a 0 in front
 * still reads as the same number only when 0 is the trunk prefix.
 */
function zeroIsTrunk(country: CountryCode): boolean {
  let known = trunkZero.get(country);
  if (known === undefined) {
    const example = getExampleNumber(country, examples);
    const withZero = example ? parsePhoneNumberFromString(`0${example.nationalNumber}`, country) : undefined;
    known = !!example && !!withZero?.isValid() && withZero.nationalNumber === example.nationalNumber;
    trunkZero.set(country, known);
  }
  return known;
}

/**
 * The digits after the dial code, without what people add by habit: the trunk 0 ("+250 0788...") and the dial code
 * a second time ("+250 250788...", which is what typing or pasting "250788..." after the +250 the field shows gives).
 * A 0 that is not a trunk prefix goes only when that makes the number valid (Portugal), so Italy's "+39 06..." stays.
 * A complete number is shown as libphonenumber stores it, which also drops other trunk prefixes ("+1 1 201...").
 * The repeated dial code goes only when the number with it is not valid and either is too long or valid without it.
 */
function nationalPart(rest: string, country: CountryCode, code: string): string {
  const withoutZero = (digits: string) => {
    const bare = digits.replace(/^0+/, "");
    if (bare === digits || zeroIsTrunk(country)) return bare;
    return !isValidPhoneNumber(`+${code}${digits}`) && isValidPhoneNumber(`+${code}${bare}`) ? bare : digits;
  };
  const valid = (digits: string) => {
    const parsed = parsePhoneNumberFromString(`+${code}${digits}`);
    return parsed?.isValid() ? parsed.nationalNumber : null;
  };
  const national = withoutZero(rest);
  const asTyped = valid(national);
  if (asTyped) return asTyped;
  if (!national.startsWith(code)) return national;
  const again = withoutZero(national.slice(code.length));
  return valid(again) ?? (validatePhoneNumberLength(`+${code}${national}`) === "TOO_LONG" ? again : national);
}

/**
 * The typed text as an international number. "+250...", "00250..." and a national number ("0791..." or "791...") all
 * give "+250791..." for Rwanda; so does any of them typed or pasted after the "+250 " the field already shows. A
 * number with its own "+" pasted after it replaces the dial code ("+250 +254..." is "+254..."). Anything that is not
 * a digit or a + is dropped.
 */
export function toInternational(input: string, country: CountryCode | null | undefined): string {
  let raw = input.replace(/[^\d+]/g, "");
  if (!raw) return "";
  raw = raw.slice(Math.max(0, raw.lastIndexOf("+")));
  const code = country ? getCountryCallingCode(country) : null;
  if (raw.startsWith("+")) {
    const digits = raw.slice(1);
    return country && code && digits.startsWith(code) ? `+${code}${nationalPart(digits.slice(code.length), country, code)}` : `+${digits}`;
  }
  if (raw.startsWith("00")) return toInternational(`+${raw.slice(2)}`, country);
  if (!country || !code) return raw;
  // Someone who typed the dial code without the plus ("250791...") meant the same number: nationalPart drops it.
  return `+${code}${nationalPart(raw, country, code)}`;
}

/** The text to show while typing: "+250 791 954 277". Pasting with or without +250 or a leading 0 gives the same result. */
export function formatAsYouType(input: string, country: CountryCode | null | undefined): string {
  const intl = toInternational(input, country);
  if (!intl) return "";
  if (intl === "+") return "+";
  const formatter = new AsYouType();
  return formatter.input(intl);
}

/** The parsed number when it is valid for the country, else null. */
export function parsePhone(input: string, country: CountryCode | null | undefined) {
  const intl = toInternational(input, country);
  if (!intl || intl === "+") return null;
  const parsed = parsePhoneNumberFromString(intl, country ?? undefined);
  if (!parsed || !parsed.isValid()) return null;
  // The number must belong to the chosen country; "+254..." on a Rwandan form is a typo, not a Kenyan customer.
  if (country && parsed.country && parsed.country !== country) return null;
  return parsed;
}

/** E.164 ("+250791954277") when valid for the country, else null. */
export function toE164(input: string, country: CountryCode | null | undefined): string | null {
  return parsePhone(input, country)?.number ?? null;
}

export function isValidPhone(input: string, country: CountryCode | null | undefined): boolean {
  return parsePhone(input, country) !== null;
}

/** A stored number for display: "+250 791 954 277". Unknown text comes back as it is. */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  const parsed = parsePhoneNumberFromString(stored);
  return parsed ? parsed.formatInternational() : stored;
}

/** A realistic example in the country's format, for placeholders and error messages. */
export function examplePhone(country: CountryCode | null | undefined): string {
  if (!country || !isSupportedCountry(country)) return "+250 791 954 277";
  const example = getExampleNumber(country, examples);
  return example ? example.formatInternational() : dialCode(country);
}

const ADJECTIVES: Record<string, string> = {
  RW: "Rwandan",
  KE: "Kenyan",
  UG: "Ugandan",
  TZ: "Tanzanian",
  BI: "Burundian",
  CD: "Congolese",
  SS: "South Sudanese",
  SO: "Somali",
  ET: "Ethiopian",
  NG: "Nigerian",
  GH: "Ghanaian",
  ZA: "South African",
  PT: "Portuguese",
  FR: "French",
  BE: "Belgian",
  DE: "German",
  GB: "UK",
  US: "US",
  CA: "Canadian",
  IN: "Indian",
  CN: "Chinese",
  AE: "UAE",
};

/** "Enter a valid Rwandan number, e.g. +250 791 954 277". */
export function phoneErrorMessage(countryName: string | null | undefined): string {
  const country = phoneCountry(countryName);
  if (!country) return "Enter a valid phone number, e.g. +250 791 954 277.";
  const who = ADJECTIVES[country] ?? `${countryName?.trim()}`;
  const adjective = ADJECTIVES[country] ? `${who} number` : `number for ${who}`;
  return `Enter a valid ${adjective}, e.g. ${examplePhone(country)}.`;
}
