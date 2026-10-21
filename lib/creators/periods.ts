// A campaign's 30-day pay periods (docs/CREATOR_CAMPAIGNS.md, "Pay periods"). Pure. Days are calendar days in the
// company's timezone; a period runs from the start of its first day to the start of the day after its last, so the
// last period of a campaign whose length is not a multiple of 30 days is shorter.

import { addDaysYmd, ymdInZone, zonedToUtc } from "@/lib/demo/slots";

export const PERIOD_DAYS = 30;
/** A campaign runs for one day at least and a year at most. */
export const MAX_CAMPAIGN_DAYS = 366;

export type PeriodSpan = { index: number; startsOn: string; endsOn: string; startsAt: Date; endsAt: Date };

/** Days from `from` to `to`, both "YYYY-MM-DD", counting both ends. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The periods of a campaign from its first to its last day (inclusive). */
export function periodsFor(startsOn: string, endsOn: string, timeZone: string): PeriodSpan[] {
  const days = daysInclusive(startsOn, endsOn);
  if (!(days >= 1 && days <= MAX_CAMPAIGN_DAYS)) return [];
  const out: PeriodSpan[] = [];
  for (let first = 0, index = 1; first < days; first += PERIOD_DAYS, index++) {
    const start = addDaysYmd(startsOn, first);
    const last = addDaysYmd(startsOn, Math.min(first + PERIOD_DAYS, days) - 1);
    out.push({ index, startsOn: start, endsOn: last, startsAt: zonedToUtc(start, 0, timeZone), endsAt: zonedToUtc(addDaysYmd(last, 1), 0, timeZone) });
  }
  return out;
}

/** The company-timezone day ("YYYY-MM-DD") an instant falls on. */
export const dayIn = (at: Date, timeZone: string) => ymdInZone(at, timeZone);

/** A Prisma @db.Date value as "YYYY-MM-DD". */
export const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
