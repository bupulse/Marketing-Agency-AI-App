// A post's numbers as stored (CreatorPost, CreatorPostSnapshot), and when to read it next (docs/CREATOR_CAMPAIGNS.md,
// "Reading views"). Pure.

import type { NetworkPost } from "./types";

export type Numbers = { views: number; impressions: number; likes: number; comments: number; shares: number };

const HOUR = 60 * 60 * 1000;
/** Posts up to 7 days old are read every 6 hours, older ones once a day (owner decision). */
export const FRESH_MS = 7 * 24 * HOUR;
export const FRESH_EVERY_MS = 6 * HOUR;
export const OLD_EVERY_MS = 24 * HOUR;

const whole = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * The numbers to store from a reading. A number the network did not give keeps the last one (`previous`), so a
 * reading without, say, shares never looks like the shares went to 0. Views never go down: a network that answers
 * lower for a while (a recount) does not take views back from an open period.
 */
export function numbersOf(post: NetworkPost, previous?: Numbers): Numbers {
  const keep = (value: number | null, old: number | undefined) => (value === null ? (old ?? 0) : whole(value));
  const views = keep(post.views, previous?.views);
  return {
    views: previous ? Math.max(views, previous.views) : views,
    impressions: keep(post.reach, previous?.impressions),
    likes: keep(post.likes, previous?.likes),
    comments: keep(post.comments, previous?.comments),
    shares: keep(post.shares, previous?.shares),
  };
}

export const sameNumbers = (a: Numbers, b: Numbers) => a.views === b.views && a.impressions === b.impressions && a.likes === b.likes && a.comments === b.comments && a.shares === b.shares;

export function nextReadAt(postedAt: Date | null, now: Date): Date {
  const fresh = !postedAt || now.getTime() - postedAt.getTime() <= FRESH_MS;
  return new Date(now.getTime() + (fresh ? FRESH_EVERY_MS : OLD_EVERY_MS));
}
