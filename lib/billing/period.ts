// Usage limits are monthly on every plan. A yearly subscription has a 12-month billing
// period, so usage runs in monthly windows counted from the period start.

/** Adds whole months, clamping to the last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Start of the monthly usage window that contains `now`, counted from `anchor`. */
export function usageWindowStart(anchor: Date, now: Date = new Date()): Date {
  if (now <= anchor) return anchor;
  const months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  let start = addMonths(anchor, Math.max(0, months));
  if (start > now) start = addMonths(anchor, months - 1);
  return start;
}

/** When the current usage window ends (the next reset). */
export function usageWindowEnd(anchor: Date, now: Date = new Date()): Date {
  const start = usageWindowStart(anchor, now);
  const months =
    (start.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (start.getUTCMonth() - anchor.getUTCMonth());
  return addMonths(anchor, months + 1);
}
