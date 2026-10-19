import type { RateLimitRule } from "@/lib/rate-limit";

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_SESSION_MESSAGES = 40;
/** Turnstile is asked again every this many visitor messages in one session. */
export const CHALLENGE_EVERY = 10;
/** Messages faster than this (ms) after the previous one look automated and ask for Turnstile again. */
export const BOT_SPEED_MS = 1200;
export const HISTORY_FOR_AI = 10;

export const WIDGET_LIMITS = {
  visitor: { limit: 20, windowSeconds: 10 * 60 }, // 20 messages / 10 min
  business: { limit: 40, windowSeconds: 60 }, // 40 messages / minute across all visitors
  ip: { limit: 60, windowSeconds: 10 * 60 }, // per business and address: shared mobile networks have many real visitors
  ipFlood: { limit: 600, windowSeconds: 10 * 60 }, // per address across all businesses
  aiPerIpDay: { limit: 30, windowSeconds: 24 * 60 * 60 }, // AI replies per business and visitor address per day
  lead: { limit: 6, windowSeconds: 10 * 60 }, // contact card submits per visitor
  poll: { limit: 90, windowSeconds: 10 * 60 }, // "any new replies?" checks per visitor (the bubble asks every 8 s while open)
} satisfies Record<string, RateLimitRule>;
