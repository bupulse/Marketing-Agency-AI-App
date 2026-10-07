import { addDays, dayKey, parseDayKey, zonedTimeToUtc } from "./time";

/** Local posting times used by "Add to queue" when the business has not set its own (AutopilotSettings.postingTimes). */
export const DEFAULT_SLOT_TIMES = ["09:00", "18:00"];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Valid "HH:mm" entries, sorted and without duplicates; the defaults when none are usable. */
export function cleanSlotTimes(times: readonly string[] | null | undefined): string[] {
  const valid = [...new Set((times ?? []).filter((t) => TIME.test(t)))].sort();
  return valid.length > 0 ? valid : DEFAULT_SLOT_TIMES;
}

const minute = (d: Date) => Math.floor(d.getTime() / 60_000);

/**
 * The next `count` free queue slots after `now`: the business's posting times, in its time zone,
 * skipping any minute in `taken` (times where the chosen accounts already have a post).
 */
export function nextFreeSlots(args: {
  times: readonly string[];
  zone: string;
  now: Date;
  taken: readonly Date[];
  count?: number;
  /** Slots closer than this are skipped, so a post is never due the instant it is created. */
  leadMinutes?: number;
  horizonDays?: number;
}): Date[] {
  const { zone, now, count = 1, leadMinutes = 5, horizonDays = 120 } = args;
  const times = cleanSlotTimes(args.times);
  const used = new Set(args.taken.map(minute));
  const earliest = now.getTime() + leadMinutes * 60_000;
  const out: Date[] = [];
  let key = dayKey(now, zone);
  for (let i = 0; i <= horizonDays && out.length < count; i++, key = addDays(key, 1)) {
    const { year, month, day } = parseDayKey(key);
    for (const time of times) {
      const [h, m] = time.split(":").map(Number);
      const slot = zonedTimeToUtc(year, month, day, h, m, zone);
      if (slot.getTime() < earliest || used.has(minute(slot))) continue;
      used.add(minute(slot));
      out.push(slot);
      if (out.length >= count) break;
    }
  }
  return out;
}
