// How much one company's daily posts may use today (docs/CONTENT.md "Daily posts"). Pure, so the cron and the tests
// agree. The month's allowances (text, AI images, videos) are spread over the days left in the usage period, and
// daily posts take at most DAILY_SHARE of what is left, so the owner keeps room for what they make by hand and a
// company never uses up its month in the first week. The company's AI allowance (USD) is spread the same way over the
// days left in its Kigali month, and the platform's monthly AI budget is never pushed past PLATFORM_CEILING. A day
// that would pass any of them is made smaller (AI photos first, then videos, then posts) or skipped, with the reason.
import type { Network } from "@/lib/social/types";

/** The part of what is left this period that daily posts may spread over the days left. */
export const DAILY_SHARE = 0.8;
/** Daily posts stop for everyone once the platform's AI spend reaches this share of the monthly budget. */
export const PLATFORM_CEILING = 0.9;
/** What one written post costs us, about (the pack's share of one call plus its art director call), rounded up. */
export const TEXT_POST_USD = 0.02;
/** What one voiced video costs us, about (600 voiceover characters at the list price), when the plan has voiceover. */
export const VOICE_VIDEO_USD = 0.18;

export type SkipReason = "allowance" | "ai_allowance" | "budget" | "full" | "nothing";

export const SKIP_LABEL: Record<SkipReason, string> = {
  allowance: "plan allowance spread over the month",
  ai_allowance: "company AI allowance",
  budget: "platform AI budget",
  full: "every app already had its posts",
  nothing: "nothing to make",
};

/** The owner-facing note for a skipped day. */
export const SKIP_NOTE: Record<SkipReason, string> = {
  allowance: "Your plan's AI texts for this month are spread over the days left, and none is left for today. Daily posts start again tomorrow or when your plan renews.",
  ai_allowance: "Your monthly AI allowance is spread over the days left, and today's share is used. Daily posts start again tomorrow or next month.",
  budget: "Daily posts are paused for a short while. They start again soon.",
  full: "Every app already has its posts for today.",
  nothing: "There was nothing to make posts about yet.",
};

/** Whole days from now to the end (at least 1: today counts). */
export function daysLeft(now: Date, end: Date | null | undefined): number {
  if (!end) return 30;
  return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

/** Today's share of what is left: an even spread over the days left, whole units, never below 0. */
export function todayShare(left: number, days: number, share = DAILY_SHARE): number {
  return Math.max(0, Math.floor((Math.max(0, left) * share) / Math.max(1, days)));
}

export type DayBudgetInput = {
  /** Posts each app still has room for today (the owner's posts per app, less what the company already has). */
  room: Partial<Record<Network, number>>;
  textLeft: number;
  imagesLeft: number;
  /** Videos left this month, and the most the plan allows right now (today's cap). */
  videosLeftMonth: number;
  videosLeftNow: number;
  /** Whole days left in the usage period (the trial's end for a trial). */
  periodDays: number;
  /** The owner chose AI photos and the plan has them with credits left. */
  wantsAi: boolean;
  /** Videos BuPulse makes are spoken (the voiceover costs AI money). */
  voice: boolean;
  /** The company's AI allowance left this Kigali month, in USD, and the days left in that month. */
  companyUsdLeft: number;
  monthDays: number;
  /** The platform's monthly AI budget and what it spent so far, in USD. */
  platformCapUsd: number;
  platformSpentUsd: number;
  imageUsd: number;
};

export type DayBudget =
  | { ok: true; maxPosts: number; maxAiImages: number; maxVideos: number; estimateUsd: number; smaller: SkipReason | null }
  | { ok: false; reason: SkipReason };

/** Today's posts, AI photos and videos, or why there are none. */
export function dayBudget(input: DayBudgetInput): DayBudget {
  const wanted = Object.values(input.room).reduce((n: number, r) => n + Math.max(0, r ?? 0), 0);
  if (wanted === 0) return { ok: false, reason: "full" };
  let smaller: SkipReason | null = null;
  const textToday = todayShare(input.textLeft, input.periodDays);
  if (textToday === 0) return { ok: false, reason: "allowance" };
  let posts = Math.min(wanted, textToday);
  if (posts < wanted) smaller = "allowance";
  let images = input.wantsAi ? Math.min(posts, todayShare(input.imagesLeft, input.periodDays)) : 0;
  let videos = Math.min(posts, Math.max(0, input.videosLeftNow), todayShare(input.videosLeftMonth, input.periodDays));
  const cost = () => posts * TEXT_POST_USD + images * input.imageUsd + (input.voice ? videos * VOICE_VIDEO_USD : 0);

  // The platform's budget: daily posts never take it past its ceiling (the rest stays for what people do by hand).
  const platformRoom = input.platformCapUsd * PLATFORM_CEILING - input.platformSpentUsd;
  // The company's AI allowance, spread over its month like the plan's allowances.
  const companyToday = (Math.max(0, input.companyUsdLeft) * DAILY_SHARE) / Math.max(1, input.monthDays);
  for (const [limit, reason] of [
    [platformRoom, "budget"],
    [companyToday, "ai_allowance"],
  ] as const) {
    if (cost() <= limit) continue;
    smaller = reason;
    images = 0;
    if (cost() > limit) videos = 0;
    if (cost() > limit) posts = Math.max(0, Math.floor(limit / TEXT_POST_USD + 1e-9));
    videos = Math.min(videos, posts);
    if (posts === 0) return { ok: false, reason };
  }
  return { ok: true, maxPosts: posts, maxAiImages: images, maxVideos: videos, estimateUsd: Math.round(cost() * 1000) / 1000, smaller };
}

/** The admin's line for today: "Today (2026-10-20): 12 companies got daily posts (31 posts); 3 skipped: 2 plan allowance..., 1 platform AI budget." */
export function dailyTodayLine(t: { day: string; paused: boolean; companies: number; posts: number; skipped: Partial<Record<SkipReason, number>>; failed: number; running: number }): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const skippedTotal = Object.values(t.skipped).reduce((n: number, v) => n + (v ?? 0), 0);
  const why = (Object.entries(t.skipped) as [SkipReason, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${SKIP_LABEL[r]}`).join(", ");
  const parts = [
    `Today (${t.day}, Kigali): ${plural(t.companies, "company", "companies")} got daily posts (${plural(t.posts, "post", "posts")})`,
    skippedTotal ? `${skippedTotal} skipped (${why})` : "none skipped",
    ...(t.failed ? [`${t.failed} failed, tried again later`] : []),
    ...(t.running ? [`${t.running} being made`] : []),
  ];
  return `${parts.join("; ")}.${t.paused ? " Paused: nothing new is made until you switch it on." : ""}`;
}
