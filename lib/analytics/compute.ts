/** Pure maths for the client Analytics page: no database, no clock, easy to test. */

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeDays = 30;

export function parseRange(value: string | string[] | undefined): RangeDays {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : DEFAULT_RANGE;
}

/** One published post with its newest metrics snapshot (null when none has arrived yet). */
export type PostRow = {
  id: string;
  network: string;
  format: string;
  publishedAt: Date;
  reminderOnly: boolean;
  mediaPaths: string[];
  permalink: string | null;
  text: string;
  metrics: { views: number | null; reach: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null } | null;
};

export type Totals = { posts: number; measured: number; reach: number; engagement: number; rate: number | null };

/** Reach falls back to views, because some networks only report one of them. */
export function reachOf(p: PostRow): number | null {
  if (!p.metrics) return null;
  return p.metrics.reach ?? p.metrics.views ?? null;
}

export function engagementOf(p: PostRow): number {
  const m = p.metrics;
  return m ? (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0) : 0;
}

/** Engagement divided by reach, or null when there is nothing to divide by. */
export function rate(engagement: number, reach: number): number | null {
  return reach > 0 ? engagement / reach : null;
}

/** Percentage change versus the previous period. Null when there is no previous number to compare with. */
export function changePct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function totalsOf(posts: PostRow[]): Totals {
  let reach = 0;
  let engagement = 0;
  let measured = 0;
  let rateReach = 0;
  let rateEng = 0;
  for (const p of posts) {
    const r = reachOf(p);
    if (!p.metrics) continue;
    measured++;
    engagement += engagementOf(p);
    if (r !== null) {
      reach += r;
      rateReach += r;
      rateEng += engagementOf(p);
    }
  }
  return { posts: posts.length, measured, reach, engagement, rate: rate(rateEng, rateReach) };
}

export function byNetwork(posts: PostRow[], networks: readonly string[]) {
  return networks
    .map((network) => ({ network, ...totalsOf(posts.filter((p) => p.network === network)) }))
    .filter((n) => n.posts > 0);
}

/** Top posts by engagement rate. Posts without reach cannot be ranked; ties go to higher engagement. */
export function bestPosts(posts: PostRow[], limit = 5) {
  return posts
    .flatMap((p) => {
      const r = reachOf(p);
      const rt = r !== null ? rate(engagementOf(p), r) : null;
      return rt === null ? [] : [{ post: p, reach: r as number, engagement: engagementOf(p), rate: rt }];
    })
    .sort((a, b) => b.rate - a.rate || b.engagement - a.engagement)
    .slice(0, limit);
}

/** Calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function dateKey(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type TrendPoint = { label: string; start: string; reach: number; engagement: number; posts: number };

/** Adds whole calendar days to a YYYY-MM-DD key. Pure date arithmetic, so a DST change cannot skip or repeat a day. */
export function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** The last `days` local dates ending today (inclusive), oldest first. */
export function periodKeys(now: Date, days: number, timeZone: string): string[] {
  const today = dateKey(now, timeZone);
  return Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)));
}

/** The instant a local calendar day starts in a time zone (used to bound database queries). */
export function startOfLocalDay(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (t: number) => {
    try {
      const p = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(t));
      const v = (type: string) => Number(p.find((x) => x.type === type)?.value);
      return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - Math.floor(t / 1000) * 1000;
    } catch {
      return 0;
    }
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

/** Splits posts into the chosen period and the one before it, by local calendar date (so cards and chart agree). */
export function splitPeriods(posts: PostRow[], days: number, now: Date, timeZone: string) {
  const first = periodKeys(now, days, timeZone)[0];
  const prevFirst = addDays(first, -days);
  const current: PostRow[] = [];
  const previous: PostRow[] = [];
  for (const p of posts) {
    const k = dateKey(p.publishedAt, timeZone);
    if (k >= first) current.push(p);
    else if (k >= prevFirst) previous.push(p);
  }
  return { current, previous, first, prevFirst };
}

/**
 * Reach and engagement of the posts published in each bucket (a day, or a week for long ranges), oldest first.
 * Buckets cover exactly the local dates in `periodKeys`, so every post counted in the cards is in the chart.
 */
export function trend(posts: PostRow[], days: number, bucketDays: number, now: Date, timeZone: string): TrendPoint[] {
  const keys = periodKeys(now, days, timeZone);
  const count = Math.ceil(days / bucketDays);
  const points: TrendPoint[] = Array.from({ length: count }, (_, i) => ({ label: keys[i * bucketDays], start: keys[i * bucketDays], reach: 0, engagement: 0, posts: 0 }));
  const index = new Map(keys.map((k, i) => [k, Math.floor(i / bucketDays)]));
  for (const p of posts) {
    const i = index.get(dateKey(p.publishedAt, timeZone));
    if (i === undefined) continue;
    points[i].posts++;
    points[i].reach += reachOf(p) ?? 0;
    points[i].engagement += engagementOf(p);
  }
  return points;
}

export function pagePath(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "/";
  } catch {
    return url.startsWith("/") ? url.split(/[?#]/)[0] || "/" : null;
  }
}

/** Lead counts per page path. Takes (address, count) pairs, so the database can do the counting. */
export function topPages(groups: { url: string | null; count: number }[], limit = 5): { path: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const g of groups) {
    const path = pagePath(g.url);
    if (path) counts.set(path, (counts.get(path) ?? 0) + g.count);
  }
  return [...counts].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)).slice(0, limit);
}

/* ---- "What worked" tips ---- */

/** Smallest samples before a tip is shown. Below these the data is noise, so nothing is said. */
export const TIP_MIN = {
  /** Measured posts in each group being compared. */
  group: 3,
  /** Measured posts overall for time-of-week tips. */
  overall: 8,
  /** Leads overall, and leads from the top page. */
  leads: 5,
  leadsTopPage: 3,
  /** The winner must beat the comparison by at least this factor. */
  lift: 1.3,
  leadShare: 0.4,
} as const;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FORMAT_NAME: Record<string, string> = { POST: "single posts", CAROUSEL: "carousels", ARTICLE: "articles", SCRIPT: "scripts", THREAD: "threads" };

type Group = { key: string; posts: number; reach: number; engagement: number };

function groupBy(posts: PostRow[], keyOf: (p: PostRow) => string | null): Group[] {
  const map = new Map<string, Group>();
  for (const p of posts) {
    const r = reachOf(p);
    const key = keyOf(p);
    if (r === null || r <= 0 || key === null) continue;
    const g = map.get(key) ?? { key, posts: 0, reach: 0, engagement: 0 };
    g.posts++;
    g.reach += r;
    g.engagement += engagementOf(p);
    map.set(key, g);
  }
  return [...map.values()];
}

const groupRate = (g: Group) => g.engagement / g.reach;

function weekdayHour(d: Date, timeZone: string): { weekday: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(d);
    const wd = parts.find((x) => x.type === "weekday")?.value ?? "Sun";
    const hour = Number(parts.find((x) => x.type === "hour")?.value ?? 0);
    return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour };
  } catch {
    return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
  }
}

function daypart(hour: number): string {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

const times = (x: number) => `${x >= 10 ? Math.round(x) : Math.round(x * 10) / 10}×`;

export type Tip = { id: string; text: string };

/**
 * Plain-language insights from the numbers. A tip only appears when every group it compares has at least
 * TIP_MIN samples and the difference is clear; nothing is estimated or made up.
 */
export function computeTips(posts: PostRow[], leadPages: { path: string; count: number }[], leadTotal: number, timeZone: string, limit = 3): Tip[] {
  const tips: Tip[] = [];
  const measured = groupBy(posts, () => "all");
  const overall = measured[0];
  const overallRate = overall ? groupRate(overall) : 0;

  // Format: carousels versus the rest, or whichever format leads.
  const formats = groupBy(posts, (p) => p.format).filter((g) => g.posts >= TIP_MIN.group);
  if (formats.length >= 2) {
    const sorted = [...formats].sort((a, b) => groupRate(b) - groupRate(a));
    const [best, ...rest] = sorted;
    const runnerUp = rest[0];
    if (groupRate(runnerUp) > 0 && groupRate(best) / groupRate(runnerUp) >= TIP_MIN.lift) {
      tips.push({
        id: "format",
        text: `Your ${FORMAT_NAME[best.key] ?? best.key.toLowerCase()} got ${times(groupRate(best) / groupRate(runnerUp))} the engagement of your ${FORMAT_NAME[runnerUp.key] ?? runnerUp.key.toLowerCase()} (${best.posts} and ${runnerUp.posts} posts).`,
      });
    }
  }

  // Network.
  const networks = groupBy(posts, (p) => p.network).filter((g) => g.posts >= TIP_MIN.group);
  if (networks.length >= 2) {
    const sorted = [...networks].sort((a, b) => groupRate(b) - groupRate(a));
    const lead = sorted[0];
    const next = sorted[1];
    if (groupRate(next) > 0 && groupRate(lead) / groupRate(next) >= TIP_MIN.lift) {
      tips.push({ id: "network", text: `People engage most on ${NETWORK_LABEL[lead.key] ?? lead.key}: ${times(groupRate(lead) / groupRate(next))} the rate of ${NETWORK_LABEL[next.key] ?? next.key}.` });
    }
  }

  // Best day and time of day.
  if (overall && overall.posts >= TIP_MIN.overall && overallRate > 0) {
    for (const [id, keyOf, describe] of [
      ["weekday", (p: PostRow) => String(weekdayHour(p.publishedAt, timeZone).weekday), (k: string) => `${WEEKDAYS[Number(k)]} posts`],
      ["daypart", (p: PostRow) => daypart(weekdayHour(p.publishedAt, timeZone).hour), (k: string) => `${k.charAt(0).toUpperCase()}${k.slice(1)} posts`],
    ] as const) {
      const groups = groupBy(posts, keyOf).filter((g) => g.posts >= TIP_MIN.group);
      if (groups.length < 2) continue;
      const best = groups.reduce((a, b) => (groupRate(b) > groupRate(a) ? b : a));
      if (groupRate(best) / overallRate >= TIP_MIN.lift) {
        tips.push({ id, text: `${describe(best.key)} did best: ${times(groupRate(best) / overallRate)} your average engagement (${best.posts} posts).` });
      }
    }
  }

  // Where leads came from.
  const top = leadPages[0];
  if (top && leadTotal >= TIP_MIN.leads && top.count >= TIP_MIN.leadsTopPage && top.count / leadTotal >= TIP_MIN.leadShare) {
    tips.push({ id: "leads", text: `Most leads came from ${top.path} (${top.count} of ${leadTotal}).` });
  }

  return tips.slice(0, limit);
}

const NETWORK_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", twitter: "X" };
