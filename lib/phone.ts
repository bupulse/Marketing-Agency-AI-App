// Phone numbers: the country chosen on the form decides the dial code, the as-you-type grouping and the validation.
// Pure (no server imports) so the sign-up form, the server actions and the admin pages share one behaviour. Uses the
// full metadata so isValid() agrees on the client and the server (the "min" metadata only checks plausible lengths).
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  isSupportedCountry,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from "libphonenumber-js/max";
import metadata from "libphonenumber-js/max/metadata";
import examples from "libphonenumber-js/mobile/examples";
import { COUNTRY_CODES, countryCodeForName } from "@/lib/region-format";

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
  return phoneErrorFor(country, countryName?.trim());
}

/** The same message for an ISO code, e.g. the country picked on the phone field itself. */
export function phoneErrorFor(country: CountryCode, name: string = phoneCountryName(country)): string {
  const adjective = ADJECTIVES[country] ? `${ADJECTIVES[country]} number` : `number for ${name}`;
  return `Enter a valid ${adjective}, e.g. ${examplePhone(country)}.`;
}

// ---- the country picker of the phone field (components/ui/phone-input.tsx) -------------------------------------

/** The picker's country when the page knows nothing better: most visitors and clients are in Rwanda. */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "RW";

/** Rwanda and its neighbours lead the list; everyone else follows from A to Z. */
export const NEARBY_PHONE_COUNTRIES: CountryCode[] = ["RW", "KE", "UG", "TZ", "BI", "CD"];

/** An ISO code the picker can show ("RW"), from any casing; null for anything else. */
export function pickerCountry(code: string | null | undefined): CountryCode | null {
  const upper = String(code ?? "").trim().toUpperCase();
  return upper && isSupportedCountry(upper) ? (upper as CountryCode) : null;
}

/** "🇷🇼" for RW: the two regional-indicator letters every phone and Mac draws as the flag (Windows shows "RW"). */
export function flagEmoji(country: string): string {
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// "Congo - Kinshasa" is how the browsers name it; people here say DR Congo.
const NAME_OVERRIDES: Partial<Record<CountryCode, string>> = { CD: "DR Congo", CG: "Congo" };
const SIGN_UP_NAMES = new Map(Object.entries(COUNTRY_CODES).map(([name, code]) => [code, name]));

/** "Rwanda": the English region name (the browser's or Node's list), "RW" when neither knows it. */
export function phoneCountryName(country: CountryCode): string {
  const override = NAME_OVERRIDES[country];
  if (override) return override;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? SIGN_UP_NAMES.get(country) ?? country;
  } catch {
    return SIGN_UP_NAMES.get(country) ?? country;
  }
}

export type PhoneCountryOption = { code: CountryCode; name: string; dial: string; flag: string };
let options: PhoneCountryOption[] | null = null;

/** Every country libphonenumber knows: Rwanda and its neighbours first, then the rest from A to Z. Built once. */
export function phoneCountryOptions(): PhoneCountryOption[] {
  if (options) return options;
  const option = (code: CountryCode) => ({ code, name: phoneCountryName(code), dial: dialCode(code), flag: flagEmoji(code) });
  const rest = getCountries()
    .filter((code) => !NEARBY_PHONE_COUNTRIES.includes(code))
    .map(option)
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  options = [...NEARBY_PHONE_COUNTRIES.map(option), ...rest];
  return options;
}

/**
 * The country of a number written with its "+": the exact one once the number is complete ("+1 416..." is Canada),
 * the picked country while it shares the dial code (Canada stays Canada while "+1" is typed), else the dial code's
 * main country (+1 is the US, +44 the UK). Null while the dial code itself is still being typed ("+25").
 */
function countryOfInternational(intl: string, current: CountryCode | null): CountryCode | null {
  const formatter = new AsYouType();
  formatter.input(intl);
  const code = formatter.getCallingCode();
  if (!code) return null;
  const parsed = parsePhoneNumberFromString(intl);
  if (parsed?.isValid() && parsed.country) return parsed.country;
  if (current && getCountryCallingCode(current) === code) return current;
  const main = metadata.country_calling_codes[code]?.find((c) => isSupportedCountry(c));
  return main ? (main as CountryCode) : null;
}

/** What the phone field shows: the picked country and the number after its dial code, grouped ("788 000 000"). */
export type PhoneParts = { country: CountryCode; national: string };

/** "788 000 000" from "+250788000000": libphonenumber's international grouping without the dial code. */
function groupedNational(intl: string, country: CountryCode): string {
  const prefix = dialCode(country);
  if (!intl.startsWith(prefix)) return "";
  return new AsYouType().input(intl).slice(prefix.length).trimStart();
}

/**
 * The phone field after the number box changed. "0788 000 000" and "788000000" in Rwanda are "788 000 000"; a number
 * typed or pasted with its own "+" or "00" ("+254 712...", "00254 712...") moves the picker to its country, unless
 * the country is locked (MoMo is Rwandan only): then "+250" is dropped and any other dial code is kept as typed digits,
 * which the form's own check then refuses. While a "+" dial code is still being typed ("+25") it stays as typed.
 */
export function typePhone(input: string, country: CountryCode, locked = false): PhoneParts {
  const raw = input.replace(/[^\d+]/g, "");
  if (!raw.replace(/\+/g, "")) return { country, national: raw.includes("+") && !locked ? "+" : "" };
  const international = raw.includes("+") || raw.startsWith("00");
  if (locked) {
    const digits = raw.replace(/\D/g, "");
    const code = getCountryCallingCode(country);
    const own = international && digits.replace(/^00/, "").startsWith(code);
    return { country, national: groupedNational(toInternational(own ? input : digits, country), country) };
  }
  if (!international) return { country, national: groupedNational(toInternational(raw, country), country) };
  const intl = toInternational(raw, country);
  const found = countryOfInternational(intl, country);
  if (!found) return { country, national: intl };
  return { country: found, national: groupedNational(toInternational(intl, found), found) };
}

/** The field's value for the server: "+250 788 000 000", or empty without digits. A half-typed "+25" stays as it is. */
export function joinPhone({ country, national }: PhoneParts): string {
  if (!/\d/.test(national)) return "";
  if (national.startsWith("+")) return national;
  return `${dialCode(country)} ${national}`;
}

/** The example number without its dial code ("791 954 277"), for the number box's placeholder. */
export function exampleNational(country: CountryCode): string {
  const example = getExampleNumber(country, examples);
  return example ? groupedNational(example.number, country) : "";
}
