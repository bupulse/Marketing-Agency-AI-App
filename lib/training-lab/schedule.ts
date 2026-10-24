// Posting habits from the Training Lab ("schedule" examples, docs/TRAINING_LAB.md): which hours and weekdays work on a
// network, in the owner's words or numbers. parseScheduleNotes reads one example's notes (strictly typed or loosely
// written), labHoursByNetwork merges several, the best rated first. The planner uses these only to order the posting
// times the owner allowed (lib/autopilot/learning.ts). Posts per week is read here for the Team page only; the owner's
// settings decide how often to post. Pure; the database read is schedule-reader.ts.
import { countryCode } from "@/lib/autopilot/calendar";
import { NETWORKS, type Network } from "@/lib/social/types";

/** The shape of a schedule example's notes. Hours are local (0 to 23), weekdays 0 = Monday. No network: all of them. */
export type ScheduleNotes = { network?: Network; country?: string; hours?: number[]; weekdays?: number[]; postsPerWeek?: number; formats?: string[] };

export type ScheduleExample = { id?: string; rating: number | null; notes: unknown; createdAt?: Date };
export type LabSchedule = { hours: Map<Network, number[]>; weekdays: Map<Network, number[]>; postsPerWeek: Map<Network, number>; exampleIds: string[] };

const DAY_NAMES: Record<string, number> = { mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, wednesday: 2, thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4, sat: 5, saturday: 5, sun: 6, sunday: 6 };
const NETWORK_ALIASES: Record<string, Network> = { x: "twitter" };
/** "Rwanda", "rw" and "RW" are one country. */
const sameCountry = (a: string, b: string) => (countryCode(a) ?? a.trim().toLowerCase()) === (countryCode(b) ?? b.trim().toLowerCase());
const uniq = <T>(list: T[]) => [...new Set(list)];

function parseNetwork(v: unknown): Network | null | undefined {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return undefined;
  if (typeof v !== "string") return null;
  const n = v.trim().toLowerCase();
  if (n === "all" || n === "any") return undefined;
  return (NETWORKS as readonly string[]).includes(n) ? (n as Network) : (NETWORK_ALIASES[n] ?? null);
}

/** "7", "12:30", "19h", "7pm": the hour of the day, or null. */
function hourOf(token: string): number | null {
  const m = token.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(h|am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[2] !== undefined && Number(m[2]) > 59) return null;
  if (m[3] === "am" || m[3] === "pm") {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  }
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
}

const tokens = (s: string) => s.split(/[,;/]+|\s+and\s+|\s+/).map((t) => t.trim()).filter(Boolean);

/** Hours from numbers or from text like "7, 12:30, 19h"; undefined unless every part is a real hour. */
function parseHours(v: unknown): number[] | undefined {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? tokens(v) : typeof v === "number" ? [v] : null;
  if (!parts?.length) return undefined;
  const hours = parts.map((p) => (typeof p === "number" ? (Number.isInteger(p) && p >= 0 && p <= 23 ? p : null) : typeof p === "string" ? hourOf(p.trim()) : null));
  return hours.every((h) => h !== null) ? uniq(hours as number[]) : undefined;
}

/** Weekdays from numbers (0 = Monday) or names ("Tue, Thursday"). */
function parseWeekdays(v: unknown): number[] | undefined {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? tokens(v) : typeof v === "number" ? [v] : null;
  if (!parts?.length) return undefined;
  const days = parts.map((p) => (typeof p === "number" ? (Number.isInteger(p) && p >= 0 && p <= 6 ? p : null) : typeof p === "string" ? (DAY_NAMES[p.trim().toLowerCase().replace(/\.$/, "")] ?? null) : null));
  return days.every((d) => d !== null) ? uniq(days as number[]) : undefined;
}

/** One schedule example's notes, or null when they say nothing usable. Bad parts are dropped, never guessed. */
export function parseScheduleNotes(notes: unknown): ScheduleNotes | null {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return null;
  const o = notes as Record<string, unknown>;
  const network = parseNetwork(o.network);
  if (network === null) return null;
  const out: ScheduleNotes = {};
  if (network) out.network = network;
  if (typeof o.country === "string" && o.country.trim()) out.country = o.country.trim().slice(0, 60);
  const hours = parseHours(o.hours);
  if (hours) out.hours = hours;
  const weekdays = parseWeekdays(o.weekdays);
  if (weekdays) out.weekdays = weekdays;
  const per = typeof o.postsPerWeek === "string" ? Number(o.postsPerWeek) : o.postsPerWeek;
  if (typeof per === "number" && Number.isInteger(per) && per >= 1 && per <= 21) out.postsPerWeek = per;
  const formats = Array.isArray(o.formats) ? o.formats : typeof o.formats === "string" ? o.formats.split(/[,;]+/) : [];
  const clean = formats.filter((f): f is string => typeof f === "string").map((f) => f.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 8);
  if (clean.length) out.formats = uniq(clean);
  return out.hours || out.weekdays || out.postsPerWeek || out.formats ? out : null;
}

/** Best rated first (unrated counts as 3), then the newest. */
const order = (a: ScheduleExample, b: ScheduleExample) => (b.rating ?? 3) - (a.rating ?? 3) || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);

/**
 * The Lab's hours and weekdays per network, merged from several examples, higher rated first. An example with no
 * network counts for every network; an example rated 1 or 2 stars is left out. `country` keeps examples for that
 * country or for none (no country given: all of them).
 */
export function labHoursByNetwork(examples: readonly ScheduleExample[], opts: { country?: string | null } = {}): LabSchedule {
  const out: LabSchedule = { hours: new Map(), weekdays: new Map(), postsPerWeek: new Map(), exampleIds: [] };
  const country = opts.country?.trim();
  for (const e of [...examples].sort(order)) {
    if (e.rating !== null && e.rating <= 2) continue;
    const n = parseScheduleNotes(e.notes);
    if (!n) continue;
    if (country && n.country && !sameCountry(n.country, country)) continue;
    for (const network of n.network ? [n.network] : NETWORKS) {
      if (n.hours) out.hours.set(network, uniq([...(out.hours.get(network) ?? []), ...n.hours]));
      if (n.weekdays) out.weekdays.set(network, uniq([...(out.weekdays.get(network) ?? []), ...n.weekdays]));
      if (n.postsPerWeek && !out.postsPerWeek.has(network)) out.postsPerWeek.set(network, n.postsPerWeek);
    }
    if (e.id) out.exampleIds.push(e.id);
  }
  return out;
}
