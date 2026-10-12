// Phone numbers: the country chosen on the form decides the dial code, the as-you-type grouping and the validation.
// Pure (no server imports) so the sign-up form, the server actions and the admin pages share one behaviour. Uses the
// full metadata so isValid() agrees on the client and the server (the "min" metadata only checks plausible lengths).
import {
  AsYouType,
  getCountryCallingCode,
  getExampleNumber,
  isSupportedCountry,
  parsePhoneNumberFromString,
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

/**
 * The typed text as an international number: "+250...", "00250..." stay as they are; a national number ("0791..." or
 * "791...") gets the country's dial code. Anything that is not a digit or a leading + is dropped.
 */
export function toInternational(input: string, country: CountryCode | null | undefined): string {
  const raw = input.replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/\D/g, "")}`;
  if (raw.startsWith("00")) return `+${raw.slice(2)}`;
  const code = country ? getCountryCallingCode(country) : null;
  if (!code) return raw;
  const national = raw.replace(/^0+/, "");
  // Someone who typed the dial code without the plus ("250791...") meant the same number.
  return national.startsWith(code) && national.length > code.length + 3 ? `+${national}` : `+${code}${national}`;
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
