// Holiday and event calendar. A small offline table with movable-date rules instead of a library:
// the popular holiday packages ship megabytes of data, which does not fit a Cloudflare Worker well.
//
// - Fixed dates and "nth weekday of a month" rules are exact.
// - Easter and everything counted from it use the Gregorian computus.
// - Islamic dates come from the Umm al-Qura calendar in Intl. Real observance depends on the moon
//   sighting and can differ by a day, so they are marked `approximate`.
// - Diwali and Holi follow a lunisolar calendar; their dates are listed for 2026-2035.
//
// Religious days are flagged so the owner can skip them. Remembrance days are `sensitive`: the
// planner keeps them quiet (no promotional post that day) instead of posting about them.
import { addDaysISO, weekdayOfISO } from "./timezone";

export interface Holiday {
  /** Stable key, e.g. "easter" or "rw-liberation-day". */
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  name: string;
  scope: "global" | "national";
  religious: boolean;
  /** A day of mourning or remembrance: no promotional posting. */
  sensitive?: boolean;
  /** Dates that depend on a moon sighting or a lunisolar calendar. */
  approximate?: boolean;
  /** A day customers shop or celebrate around, suited to an offer or a themed post. */
  commercial?: boolean;
}

type Rule = (year: number) => string[];

const pad = (n: number) => String(n).padStart(2, "0");
const fixed =
  (month: number, day: number): Rule =>
  (year) => [`${year}-${pad(month)}-${pad(day)}`];

/** nth (1-based) weekday (0 = Monday ... 6 = Sunday) of a month; n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = `${year}-${pad(month)}-01`;
    const offset = (weekday - weekdayOfISO(first) + 7) % 7;
    return addDaysISO(first, offset + (n - 1) * 7);
  }
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return addDaysISO(last, -((weekdayOfISO(last) - weekday + 7) % 7));
}
const nth =
  (month: number, weekday: number, n: number): Rule =>
  (year) => [nthWeekday(year, month, weekday, n)];

const MON = 0;
const THU = 3;
const FRI = 4;
const SUN = 6;

/** Easter Sunday (Gregorian computus). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}
const fromEaster =
  (days: number): Rule =>
  (year) => [addDaysISO(easterSunday(year), days)];

const hijriFormat = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
  timeZone: "UTC",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
const hijriCache = new Map<string, string[]>();

/** Gregorian dates in `year` on which the Hijri calendar shows `month`/`day` (it can fall twice in a year). */
function hijri(month: number, day: number): Rule {
  return (year) => {
    const key = `${year}-${month}-${day}`;
    const hit = hijriCache.get(key);
    if (hit) return hit;
    const found: string[] = [];
    const start = Date.UTC(year, 0, 1);
    const days = (Date.UTC(year + 1, 0, 1) - start) / 86400000;
    for (let i = 0; i < days; i++) {
      const date = new Date(start + i * 86400000);
      const parts = hijriFormat.formatToParts(date);
      const m = Number(parts.find((p) => p.type === "month")?.value);
      const d = Number(parts.find((p) => p.type === "day")?.value);
      if (m === month && d === day) found.push(date.toISOString().slice(0, 10));
    }
    hijriCache.set(key, found);
    return found;
  };
}

// Lunisolar festivals, by Gregorian year.
const DIWALI: Record<number, string> = {
  2026: "2026-11-08", 2027: "2027-10-29", 2028: "2028-10-17", 2029: "2029-11-05", 2030: "2030-10-26",
  2031: "2031-11-14", 2032: "2032-11-02", 2033: "2033-10-22", 2034: "2034-11-10", 2035: "2035-10-30",
};
const HOLI: Record<number, string> = {
  2026: "2026-03-04", 2027: "2027-03-22", 2028: "2028-03-11", 2029: "2029-03-01", 2030: "2030-03-20",
  2031: "2031-03-09", 2032: "2032-03-25", 2033: "2033-03-14", 2034: "2034-03-04", 2035: "2035-03-22",
};
const table =
  (dates: Record<number, string>): Rule =>
  (year) => (dates[year] ? [dates[year]] : []);

interface Def {
  id: string;
  name: string;
  rule: Rule;
  religious?: boolean;
  sensitive?: boolean;
  approximate?: boolean;
  commercial?: boolean;
}

const EASTER_DAYS: Def[] = [
  { id: "good-friday", name: "Good Friday", rule: fromEaster(-2), religious: true },
  { id: "easter", name: "Easter", rule: fromEaster(0), religious: true, commercial: true },
  { id: "easter-monday", name: "Easter Monday", rule: fromEaster(1), religious: true },
];
const EID: Def[] = [
  { id: "eid-al-fitr", name: "Eid al-Fitr", rule: hijri(10, 1), religious: true, approximate: true, commercial: true },
  { id: "eid-al-adha", name: "Eid al-Adha", rule: hijri(12, 10), religious: true, approximate: true, commercial: true },
];
const CHRISTMAS: Def[] = [
  { id: "christmas", name: "Christmas Day", rule: fixed(12, 25), religious: true, commercial: true },
];
const BOXING: Def = { id: "boxing-day", name: "Boxing Day", rule: fixed(12, 26) };
const NEW_YEAR: Def = { id: "new-year", name: "New Year's Day", rule: fixed(1, 1), commercial: true };
const LABOUR: Def = { id: "labour-day", name: "Labour Day", rule: fixed(5, 1) };

/** Days celebrated almost everywhere. Mother's and Father's Day are per country, see below. */
const GLOBAL: Def[] = [
  NEW_YEAR,
  { id: "valentines", name: "Valentine's Day", rule: fixed(2, 14), commercial: true },
  { id: "womens-day", name: "International Women's Day", rule: fixed(3, 8), commercial: true },
  { id: "earth-day", name: "Earth Day", rule: fixed(4, 22) },
  { id: "labour-day", name: "International Workers' Day", rule: fixed(5, 1) },
  { id: "environment-day", name: "World Environment Day", rule: fixed(6, 5) },
  { id: "teachers-day", name: "World Teachers' Day", rule: fixed(10, 5) },
  { id: "black-friday", name: "Black Friday", rule: (y) => [addDaysISO(nthWeekday(y, 11, THU, 4), 1)], commercial: true },
  { id: "cyber-monday", name: "Cyber Monday", rule: (y) => [addDaysISO(nthWeekday(y, 11, THU, 4), 4)], commercial: true },
  { id: "new-years-eve", name: "New Year's Eve", rule: fixed(12, 31), commercial: true },
  ...CHRISTMAS,
  { id: "easter", name: "Easter", rule: fromEaster(0), religious: true, commercial: true },
];

type Observance = "second-sunday-may" | "mothering-sunday" | "last-sunday-may" | "first-sunday-may" | "march-21";
const MOTHERS: Record<string, Observance> = {
  GB: "mothering-sunday",
  FR: "last-sunday-may",
  ES: "first-sunday-may",
  AE: "march-21",
};
const FATHERS: Record<string, string> = { ES: "march-19", DE: "ascension" };

function mothersDay(code: string, year: number): string {
  switch (MOTHERS[code] ?? "second-sunday-may") {
    case "mothering-sunday":
      return addDaysISO(easterSunday(year), -21);
    case "last-sunday-may":
      return nthWeekday(year, 5, SUN, -1);
    case "first-sunday-may":
      return nthWeekday(year, 5, SUN, 1);
    case "march-21":
      return `${year}-03-21`;
    default:
      return nthWeekday(year, 5, SUN, 2);
  }
}

function fathersDay(code: string, year: number): string {
  switch (FATHERS[code]) {
    case "march-19":
      return `${year}-03-19`;
    case "ascension":
      return addDaysISO(easterSunday(year), 39);
    default:
      return nthWeekday(year, 6, SUN, 3);
  }
}

const memorial = (id: string, name: string, month: number, day: number): Def => ({ id, name, rule: fixed(month, day), sensitive: true });

/** National days, keyed by ISO country code. */
const NATIONAL: Record<string, Def[]> = {
  RW: [
    NEW_YEAR,
    { id: "rw-heroes-day", name: "National Heroes' Day", rule: fixed(2, 1) },
    memorial("rw-kwibuka", "Kwibuka, Genocide against the Tutsi remembrance", 4, 7),
    LABOUR,
    { id: "rw-independence", name: "Independence Day", rule: fixed(7, 1) },
    { id: "rw-liberation", name: "Liberation Day", rule: fixed(7, 4) },
    { id: "rw-umuganura", name: "Umuganura (Harvest Day)", rule: nth(8, FRI, 1) },
    { id: "assumption", name: "Assumption Day", rule: fixed(8, 15), religious: true },
    { id: "all-saints", name: "All Saints' Day", rule: fixed(11, 1), religious: true },
    ...EASTER_DAYS.filter((d) => d.id !== "easter-monday"),
    ...CHRISTMAS,
    BOXING,
    ...EID.filter((d) => d.id === "eid-al-fitr" || d.id === "eid-al-adha"),
  ],
  KE: [
    NEW_YEAR,
    LABOUR,
    { id: "ke-madaraka", name: "Madaraka Day", rule: fixed(6, 1) },
    { id: "ke-huduma", name: "Utamaduni Day", rule: fixed(10, 10) },
    { id: "ke-mashujaa", name: "Mashujaa Day", rule: fixed(10, 20) },
    { id: "ke-jamhuri", name: "Jamhuri Day", rule: fixed(12, 12), commercial: true },
    ...EASTER_DAYS,
    ...CHRISTMAS,
    BOXING,
    ...EID,
  ],
  UG: [
    NEW_YEAR,
    { id: "ug-liberation", name: "NRM Liberation Day", rule: fixed(1, 26) },
    LABOUR,
    { id: "ug-martyrs", name: "Martyrs' Day", rule: fixed(6, 3), religious: true },
    { id: "ug-heroes", name: "National Heroes' Day", rule: fixed(6, 9) },
    { id: "ug-independence", name: "Independence Day", rule: fixed(10, 9) },
    ...EASTER_DAYS,
    ...CHRISTMAS,
    BOXING,
    ...EID,
  ],
  TZ: [
    NEW_YEAR,
    { id: "tz-zanzibar", name: "Zanzibar Revolution Day", rule: fixed(1, 12) },
    { id: "tz-union", name: "Union Day", rule: fixed(4, 26) },
    LABOUR,
    { id: "tz-saba-saba", name: "Saba Saba (Trade Day)", rule: fixed(7, 7) },
    { id: "tz-nane-nane", name: "Nane Nane (Farmers' Day)", rule: fixed(8, 8) },
    { id: "tz-nyerere", name: "Nyerere Day", rule: fixed(10, 14) },
    { id: "tz-independence", name: "Independence Day", rule: fixed(12, 9) },
    ...EASTER_DAYS,
    ...CHRISTMAS,
    BOXING,
    ...EID,
  ],
  NG: [
    NEW_YEAR,
    LABOUR,
    { id: "ng-democracy", name: "Democracy Day", rule: fixed(6, 12) },
    { id: "ng-independence", name: "Independence Day", rule: fixed(10, 1), commercial: true },
    ...EASTER_DAYS.filter((d) => d.id !== "easter"),
    ...CHRISTMAS,
    BOXING,
    ...EID,
    { id: "mawlid", name: "Mawlid (Prophet's birthday)", rule: hijri(3, 12), religious: true, approximate: true },
  ],
  ZA: [
    NEW_YEAR,
    { id: "za-human-rights", name: "Human Rights Day", rule: fixed(3, 21) },
    { id: "good-friday", name: "Good Friday", rule: fromEaster(-2), religious: true },
    { id: "za-family-day", name: "Family Day", rule: fromEaster(1) },
    { id: "za-freedom", name: "Freedom Day", rule: fixed(4, 27) },
    { id: "za-workers", name: "Workers' Day", rule: fixed(5, 1) },
    { id: "za-youth", name: "Youth Day", rule: fixed(6, 16) },
    { id: "za-womens", name: "National Women's Day", rule: fixed(8, 9), commercial: true },
    { id: "za-heritage", name: "Heritage Day", rule: fixed(9, 24) },
    { id: "za-reconciliation", name: "Day of Reconciliation", rule: fixed(12, 16) },
    { id: "boxing-day", name: "Day of Goodwill", rule: fixed(12, 26) },
  ],
  US: [
    NEW_YEAR,
    { id: "us-mlk", name: "Martin Luther King Jr. Day", rule: nth(1, MON, 3) },
    { id: "us-presidents", name: "Presidents' Day", rule: nth(2, MON, 3), commercial: true },
    { id: "us-memorial", name: "Memorial Day", rule: nth(5, MON, -1), commercial: true },
    { id: "us-juneteenth", name: "Juneteenth", rule: fixed(6, 19) },
    { id: "us-independence", name: "Independence Day", rule: fixed(7, 4), commercial: true },
    { id: "us-labor", name: "Labor Day", rule: nth(9, MON, 1), commercial: true },
    { id: "us-halloween", name: "Halloween", rule: fixed(10, 31), commercial: true },
    { id: "us-veterans", name: "Veterans Day", rule: fixed(11, 11) },
    { id: "us-thanksgiving", name: "Thanksgiving", rule: nth(11, THU, 4), commercial: true },
  ],
  GB: [
    NEW_YEAR,
    { id: "good-friday", name: "Good Friday", rule: fromEaster(-2), religious: true },
    { id: "easter-monday", name: "Easter Monday", rule: fromEaster(1), religious: true },
    { id: "uk-may-bank", name: "Early May bank holiday", rule: nth(5, MON, 1) },
    { id: "uk-spring-bank", name: "Spring bank holiday", rule: nth(5, MON, -1) },
    { id: "uk-summer-bank", name: "Summer bank holiday", rule: nth(8, MON, -1) },
    { id: "uk-halloween", name: "Halloween", rule: fixed(10, 31), commercial: true },
    { id: "uk-bonfire", name: "Bonfire Night", rule: fixed(11, 5) },
    { id: "uk-remembrance", name: "Remembrance Sunday", rule: nth(11, SUN, 2) },
    BOXING,
  ],
  FR: [
    NEW_YEAR,
    { id: "easter-monday", name: "Easter Monday", rule: fromEaster(1), religious: true },
    { id: "fr-labour", name: "Fête du Travail", rule: fixed(5, 1) },
    { id: "fr-victory", name: "Victoire 1945", rule: fixed(5, 8) },
    { id: "ascension", name: "Ascension Day", rule: fromEaster(39), religious: true },
    { id: "whit-monday", name: "Whit Monday", rule: fromEaster(50), religious: true },
    { id: "fr-bastille", name: "Fête nationale (Bastille Day)", rule: fixed(7, 14), commercial: true },
    { id: "assumption", name: "Assumption Day", rule: fixed(8, 15), religious: true },
    { id: "all-saints", name: "All Saints' Day", rule: fixed(11, 1), religious: true },
    { id: "fr-armistice", name: "Armistice Day", rule: fixed(11, 11) },
  ],
  ES: [
    NEW_YEAR,
    { id: "es-epiphany", name: "Epiphany (Día de Reyes)", rule: fixed(1, 6), religious: true, commercial: true },
    { id: "good-friday", name: "Good Friday", rule: fromEaster(-2), religious: true },
    { id: "es-labour", name: "Día del Trabajo", rule: fixed(5, 1) },
    { id: "assumption", name: "Assumption Day", rule: fixed(8, 15), religious: true },
    { id: "es-national", name: "Fiesta Nacional de España", rule: fixed(10, 12) },
    { id: "all-saints", name: "All Saints' Day", rule: fixed(11, 1), religious: true },
    { id: "es-constitution", name: "Día de la Constitución", rule: fixed(12, 6) },
    { id: "immaculate", name: "Immaculate Conception", rule: fixed(12, 8), religious: true },
  ],
  DE: [
    NEW_YEAR,
    { id: "good-friday", name: "Good Friday", rule: fromEaster(-2), religious: true },
    { id: "easter-monday", name: "Easter Monday", rule: fromEaster(1), religious: true },
    { id: "de-labour", name: "Tag der Arbeit", rule: fixed(5, 1) },
    { id: "ascension", name: "Ascension Day", rule: fromEaster(39), religious: true },
    { id: "whit-monday", name: "Whit Monday", rule: fromEaster(50), religious: true },
    { id: "de-unity", name: "Tag der Deutschen Einheit", rule: fixed(10, 3) },
    { id: "de-st-martin", name: "St. Martin's Day", rule: fixed(11, 11), religious: true },
    BOXING,
  ],
  IN: [
    { id: "in-republic", name: "Republic Day", rule: fixed(1, 26), commercial: true },
    { id: "holi", name: "Holi", rule: table(HOLI), religious: true, approximate: true, commercial: true },
    { id: "good-friday", name: "Good Friday", rule: fromEaster(-2), religious: true },
    ...EID,
    { id: "in-teachers", name: "Teachers' Day", rule: fixed(9, 5) },
    { id: "in-independence", name: "Independence Day", rule: fixed(8, 15), commercial: true },
    { id: "in-gandhi", name: "Gandhi Jayanti", rule: fixed(10, 2) },
    { id: "diwali", name: "Diwali", rule: table(DIWALI), religious: true, approximate: true, commercial: true },
    { id: "in-childrens", name: "Children's Day", rule: fixed(11, 14) },
  ],
  AE: [
    NEW_YEAR,
    { id: "ramadan", name: "Start of Ramadan", rule: hijri(9, 1), religious: true, approximate: true, commercial: true },
    ...EID,
    { id: "islamic-new-year", name: "Islamic New Year", rule: hijri(1, 1), religious: true, approximate: true },
    { id: "mawlid", name: "Mawlid (Prophet's birthday)", rule: hijri(3, 12), religious: true, approximate: true },
    { id: "ae-flag", name: "Flag Day", rule: fixed(11, 3) },
    memorial("ae-commemoration", "Commemoration Day", 12, 1),
    { id: "ae-national", name: "UAE National Day", rule: fixed(12, 2), commercial: true },
  ],
};

/** Country names as stored in Business.country (lib/content/countries.ts) to ISO codes. */
const COUNTRY_CODES: Record<string, string> = {
  rwanda: "RW",
  kenya: "KE",
  uganda: "UG",
  tanzania: "TZ",
  nigeria: "NG",
  "south africa": "ZA",
  "united states": "US",
  "united kingdom": "GB",
  france: "FR",
  spain: "ES",
  germany: "DE",
  india: "IN",
  "united arab emirates": "AE",
};

export const SUPPORTED_COUNTRY_CODES = Object.keys(NATIONAL);

/** ISO code for a country name or code; null when it has no national calendar (global days still apply). */
export function countryCode(country: string | null | undefined): string | null {
  const key = country?.trim().toLowerCase();
  if (!key) return null;
  if (COUNTRY_CODES[key]) return COUNTRY_CODES[key];
  const upper = key.toUpperCase();
  return NATIONAL[upper] ? upper : null;
}

function expand(defs: Def[], scope: Holiday["scope"], year: number): Holiday[] {
  return defs.flatMap((d) =>
    d.rule(year).map((date) => ({
      id: d.id,
      date,
      name: d.name,
      scope,
      religious: !!d.religious,
      sensitive: d.sensitive,
      approximate: d.approximate,
      commercial: d.commercial,
    })),
  );
}

/** All holidays of a Gregorian year for a country (global days included), sorted by date. */
export function holidaysForYear(country: string | null | undefined, year: number): Holiday[] {
  const code = countryCode(country);
  const national = code ? expand(NATIONAL[code], "national", year) : [];
  // A national entry replaces the global one with the same id (e.g. Labour Day, Easter).
  const taken = new Set(national.map((h) => h.id));
  const global = expand(GLOBAL, "global", year).filter((h) => !taken.has(h.id));
  const family: Holiday[] = [
    { id: "mothers-day", date: mothersDay(code ?? "", year), name: "Mother's Day", scope: "global", religious: false, commercial: true },
    { id: "fathers-day", date: fathersDay(code ?? "", year), name: "Father's Day", scope: "global", religious: false, commercial: true },
  ];
  const seen = new Set<string>();
  return [...national, ...global, ...family]
    .filter((h) => {
      const key = `${h.id}|${h.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Holidays from `from` to `to` (inclusive "YYYY-MM-DD"). */
export function holidaysBetween(
  country: string | null | undefined,
  from: string,
  to: string,
  options: { skipReligious?: boolean } = {},
): Holiday[] {
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  return [...years]
    .flatMap((y) => holidaysForYear(country, y))
    .filter((h) => h.date >= from && h.date <= to && !(options.skipReligious && h.religious));
}
