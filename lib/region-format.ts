// Regions as pure data and arithmetic (no server imports, so the pricing cards and tests can use it). The live
// regions and prices come from the database through lib/region.ts and lib/region-prices.ts; the seeds here are
// what the migration 20261010100100_regions_and_demos created and the fallback when the database cannot be read.

export type PaymentMethod = "momo" | "card";
export const PAYMENT_METHODS: PaymentMethod[] = ["momo", "card"];

export type RegionInfo = {
  key: string;
  name: string;
  /** ISO 4217. */
  currency: string;
  /** ISO 3166-1 alpha-2 codes; empty for the region that takes everything else. */
  countries: string[];
  paymentMethods: PaymentMethod[];
  active: boolean;
  sortOrder: number;
};

export const DEFAULT_REGION_KEY = "GLOBAL";
export const RWANDA_REGION_KEY = "RW";
export const EAC_COUNTRY_CODES = ["KE", "UG", "TZ", "BI", "SS", "CD", "SO"];

export const REGION_SEEDS: RegionInfo[] = [
  { key: "RW", name: "Rwanda", currency: "RWF", countries: ["RW"], paymentMethods: ["momo", "card"], active: true, sortOrder: 0 },
  { key: "EAC", name: "East Africa", currency: "USD", countries: EAC_COUNTRY_CODES, paymentMethods: ["card"], active: true, sortOrder: 10 },
  { key: "GLOBAL", name: "Everywhere else", currency: "USD", countries: [], paymentMethods: ["card"], active: true, sortOrder: 20 },
];

/** Defaults of the admin settings the card prices are computed from (Admin -> Settings). */
export const DEFAULT_USD_TO_RWF = 1450;
export const DEFAULT_CARD_MARGIN_PERCENT = 12;

/** ISO 3166-1 alpha-2 code of every sign-up country name (lib/content/countries.ts; tests check the two lists agree). */
export const COUNTRY_CODES: Record<string, string> = {
  Afghanistan: "AF", Albania: "AL", Algeria: "DZ", Andorra: "AD", Angola: "AO", "Antigua and Barbuda": "AG", Argentina: "AR", Armenia: "AM", Australia: "AU", Austria: "AT", Azerbaijan: "AZ",
  Bahamas: "BS", Bahrain: "BH", Bangladesh: "BD", Barbados: "BB", Belarus: "BY", Belgium: "BE", Belize: "BZ", Benin: "BJ", Bhutan: "BT", Bolivia: "BO", "Bosnia and Herzegovina": "BA", Botswana: "BW", Brazil: "BR", Brunei: "BN", Bulgaria: "BG", "Burkina Faso": "BF", Burundi: "BI",
  "Cabo Verde": "CV", Cambodia: "KH", Cameroon: "CM", Canada: "CA", "Central African Republic": "CF", Chad: "TD", Chile: "CL", China: "CN", Colombia: "CO", Comoros: "KM", "Congo (Republic)": "CG", "Congo (Democratic Republic)": "CD", "Costa Rica": "CR", "Côte d'Ivoire": "CI", Croatia: "HR", Cuba: "CU", Cyprus: "CY", Czechia: "CZ",
  Denmark: "DK", Djibouti: "DJ", Dominica: "DM", "Dominican Republic": "DO", Ecuador: "EC", Egypt: "EG", "El Salvador": "SV", "Equatorial Guinea": "GQ", Eritrea: "ER", Estonia: "EE", Eswatini: "SZ", Ethiopia: "ET",
  Fiji: "FJ", Finland: "FI", France: "FR", Gabon: "GA", Gambia: "GM", Georgia: "GE", Germany: "DE", Ghana: "GH", Greece: "GR", Grenada: "GD", Guatemala: "GT", Guinea: "GN", "Guinea-Bissau": "GW", Guyana: "GY",
  Haiti: "HT", Honduras: "HN", "Hong Kong": "HK", Hungary: "HU", Iceland: "IS", India: "IN", Indonesia: "ID", Iran: "IR", Iraq: "IQ", Ireland: "IE", Israel: "IL", Italy: "IT",
  Jamaica: "JM", Japan: "JP", Jordan: "JO", Kazakhstan: "KZ", Kenya: "KE", Kiribati: "KI", Kosovo: "XK", Kuwait: "KW", Kyrgyzstan: "KG", Laos: "LA", Latvia: "LV", Lebanon: "LB", Lesotho: "LS", Liberia: "LR", Libya: "LY", Liechtenstein: "LI", Lithuania: "LT", Luxembourg: "LU",
  Madagascar: "MG", Malawi: "MW", Malaysia: "MY", Maldives: "MV", Mali: "ML", Malta: "MT", "Marshall Islands": "MH", Mauritania: "MR", Mauritius: "MU", Mexico: "MX", Micronesia: "FM", Moldova: "MD", Monaco: "MC", Mongolia: "MN", Montenegro: "ME", Morocco: "MA", Mozambique: "MZ", Myanmar: "MM",
  Namibia: "NA", Nauru: "NR", Nepal: "NP", Netherlands: "NL", "New Zealand": "NZ", Nicaragua: "NI", Niger: "NE", Nigeria: "NG", "North Korea": "KP", "North Macedonia": "MK", Norway: "NO", Oman: "OM",
  Pakistan: "PK", Palau: "PW", Palestine: "PS", Panama: "PA", "Papua New Guinea": "PG", Paraguay: "PY", Peru: "PE", Philippines: "PH", Poland: "PL", Portugal: "PT", "Puerto Rico": "PR", Qatar: "QA", Romania: "RO", Russia: "RU", Rwanda: "RW",
  "Saint Kitts and Nevis": "KN", "Saint Lucia": "LC", "Saint Vincent and the Grenadines": "VC", Samoa: "WS", "San Marino": "SM", "São Tomé and Príncipe": "ST", "Saudi Arabia": "SA", Senegal: "SN", Serbia: "RS", Seychelles: "SC", "Sierra Leone": "SL", Singapore: "SG", Slovakia: "SK", Slovenia: "SI", "Solomon Islands": "SB", Somalia: "SO", "South Africa": "ZA", "South Korea": "KR", "South Sudan": "SS", Spain: "ES", "Sri Lanka": "LK", Sudan: "SD", Suriname: "SR", Sweden: "SE", Switzerland: "CH", Syria: "SY",
  Taiwan: "TW", Tajikistan: "TJ", Tanzania: "TZ", Thailand: "TH", "Timor-Leste": "TL", Togo: "TG", Tonga: "TO", "Trinidad and Tobago": "TT", Tunisia: "TN", "Türkiye": "TR", Turkmenistan: "TM", Tuvalu: "TV",
  Uganda: "UG", Ukraine: "UA", "United Arab Emirates": "AE", "United Kingdom": "GB", "United States": "US", Uruguay: "UY", Uzbekistan: "UZ", Vanuatu: "VU", "Vatican City": "VA", Venezuela: "VE", Vietnam: "VN", Yemen: "YE", Zambia: "ZM", Zimbabwe: "ZW",
};

/**
 * The time zone of a business from its sign-up country, for the countries with their own region (one zone each).
 * Other countries have several zones or none we would guess: they keep "UTC" until the browser sets the zone on the
 * first dashboard visit (components/publishing/auto-timezone.tsx).
 */
export const COUNTRY_TIMEZONES: Record<string, string> = {
  RW: "Africa/Kigali",
  KE: "Africa/Nairobi",
  UG: "Africa/Kampala",
  TZ: "Africa/Dar_es_Salaam",
  BI: "Africa/Bujumbura",
  SS: "Africa/Juba",
  CD: "Africa/Kinshasa",
  SO: "Africa/Mogadishu",
};

export function timezoneForCountryName(name: string | null | undefined): string | null {
  const code = countryCodeForName(name);
  return code ? (COUNTRY_TIMEZONES[code] ?? null) : null;
}

export function isRegionKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,15}$/.test(value);
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === "momo" || value === "card";
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return method === "momo" ? "Mobile Money" : "Card";
}

/** "Prices are in Rwandan francs. Pay by Mobile Money or Card ..." for a region's currency and payment methods. */
export function currencyNote(currency: string, methods: readonly string[]): string {
  const pay = methods.filter(isPaymentMethod).map(paymentMethodLabel);
  const how = pay.length > 1 ? `${pay.slice(0, -1).join(", ")} or ${pay[pay.length - 1]}` : (pay[0] ?? "card");
  if (currency === "RWF") return `Prices are in Rwandan francs. Pay by ${how} (card payments are charged in US dollars). Pay yearly and get two months free.`;
  if (currency === "USD") return `Prices are in US dollars, paid by ${how}. Pay yearly and save.`;
  return `Prices are in ${currency}, paid by ${how}. Pay yearly and save.`;
}

/** The region of an ISO country code: the active region that lists it, else the one with no countries (GLOBAL). */
export function regionKeyForCountryCode(code: string | null | undefined, regions: RegionInfo[] = REGION_SEEDS): string {
  const c = (code ?? "").toUpperCase();
  const active = regions.filter((r) => r.active);
  const hit = c ? active.find((r) => r.countries.includes(c)) : undefined;
  if (hit) return hit.key;
  const rest = active.find((r) => r.countries.length === 0);
  return rest?.key ?? DEFAULT_REGION_KEY;
}

export function countryCodeForName(name: string | null | undefined): string | null {
  return name ? (COUNTRY_CODES[name.trim()] ?? null) : null;
}

/** The region of a sign-up country name ("Rwanda" -> RW, "Kenya" -> EAC, "France" -> GLOBAL). */
export function regionKeyForCountryName(name: string | null | undefined, regions: RegionInfo[] = REGION_SEEDS): string {
  return regionKeyForCountryCode(countryCodeForName(name), regions);
}

/** Digits after the decimal point: 2 for USD, 0 for RWF. */
export function minorDigits(currency: string): number {
  if (currency.toUpperCase() === "RWF") return 0;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * An amount in the currency's smallest unit as people read it: 4900 USD -> "$49", 4950 -> "$49.50",
 * 15000 RWF -> "15,000 RWF". Francs have no decimals, so they never show any.
 */
export function formatMinor(minor: number, currency: string): string {
  const cur = currency.toUpperCase();
  const digits = minorDigits(cur);
  const amount = minor / 10 ** digits;
  if (cur === "RWF") return `${Math.round(amount).toLocaleString("en-US")} RWF`;
  if (cur === "USD") {
    const whole = Number.isInteger(amount);
    return `$${amount.toLocaleString("en-US", whole ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  try {
    return amount.toLocaleString("en-US", { style: "currency", currency: cur, minimumFractionDigits: Number.isInteger(amount) ? 0 : digits, maximumFractionDigits: digits });
  } catch {
    return `${amount.toLocaleString("en-US")} ${cur}`;
  }
}

/**
 * The card (Paddle, USD) price of a local price: the amount divided by the USD rate, plus the card margin (Paddle's
 * fee and rate changes), rounded UP to whole dollars. 15,000 RWF at 1,450 and 12% -> $11.59 -> $12 (1200 cents).
 * A USD price is its own card price.
 */
export function cardUsdCents(minor: number, currency: string, usdRate: number, marginPercent: number): number {
  if (currency.toUpperCase() === "USD") return minor;
  if (!(usdRate > 0)) throw new Error("The USD rate must be above zero.");
  const major = minor / 10 ** minorDigits(currency);
  const usd = (major / usdRate) * (1 + Math.max(0, marginPercent) / 100);
  // Round to cents first so 27.0000001 does not become $28 through floating point noise.
  return Math.ceil(Math.round(usd * 100) / 100) * 100;
}

/** The local amount a card price stands for, to show "≈ 17,400 RWF" next to "$12". */
export function localEquivalentMinor(usdCents: number, currency: string, usdRate: number): number {
  const major = (usdCents / 100) * usdRate;
  return Math.round(major * 10 ** minorDigits(currency));
}
