// The pre-launch waiting list (owner's decisions of 27 Nov 2026, docs/WAITLIST.md): while it is on, bupulse.com shows a
// Christmas banner with a countdown to the launch day, every visitor (any country) gets "Get a free quote" / "Reserve
// your spot" instead of the free trial, new accounts cannot be created, and everyone who sends the form gets a thank-you
// email. The owner switches it on and off and sets the launch day in Admin -> Settings -> Waiting list and free trial;
// reaching the day does NOT switch it off (sign-ups never open by surprise). Pure, so the server, the banner and the
// tests share the dates.

/** The launch day until the owner sets another one. */
export const DEFAULT_LAUNCH_DATE = "2026-12-15";

/** Rwanda is UTC+2 all year (no daylight saving), so the launch is 00:00 in Kigali. */
const KIGALI_OFFSET_MS = 2 * 3_600_000;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** What the public pages need: when the countdown ends and how to name the day. Null while the waiting list is off. */
export type WaitlistInfo = {
  /** 00:00 Africa/Kigali on the launch day, as an ISO instant. */
  launchAt: string;
  /** "15 December". */
  dateLabel: string;
  /** "15 Dec", for the narrow banner and button. */
  shortLabel: string;
};

/** True for a real calendar day written YYYY-MM-DD. */
export function isLaunchDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 00:00 Africa/Kigali on that day. */
export function launchInstant(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - KIGALI_OFFSET_MS);
}

/** The public pages' view of the setting, or null when the waiting list is off. */
export function waitlistInfo(on: boolean, ymd: string): WaitlistInfo | null {
  if (!on) return null;
  const day = isLaunchDate(ymd) ? ymd : DEFAULT_LAUNCH_DATE;
  const [, m, d] = day.split("-").map(Number);
  const month = MONTHS[m - 1];
  return { launchAt: launchInstant(day).toISOString(), dateLabel: `${d} ${month}`, shortLabel: `${d} ${month.slice(0, 3)}` };
}

export type Countdown = { days: number; hours: number; minutes: number; seconds: number; done: boolean };

/** Time left until `launchAt` (never negative; `done` once it is reached). */
export function countdown(launchAt: string | Date, now: number = Date.now()): Countdown {
  const left = Math.max(0, new Date(launchAt).getTime() - now);
  const s = Math.floor(left / 1000);
  return { days: Math.floor(s / 86_400), hours: Math.floor((s % 86_400) / 3_600), minutes: Math.floor((s % 3_600) / 60), seconds: s % 60, done: left === 0 };
}

const two = (n: number) => String(n).padStart(2, "0");

/** "18d 06h 12m", or with seconds "18d 06h 12m 40s". The days part is left out on the last day ("06h 12m 40s"). */
export function formatCountdown(c: Countdown, withSeconds = false): string {
  const parts = [...(c.days > 0 ? [`${c.days}d`] : []), `${two(c.hours)}h`, `${two(c.minutes)}m`];
  if (withSeconds || c.days === 0) parts.push(`${two(c.seconds)}s`);
  return parts.join(" ");
}
