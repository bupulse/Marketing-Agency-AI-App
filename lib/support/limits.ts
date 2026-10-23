import type { RateLimitRule } from "@/lib/rate-limit";

// Limits of the support chat API (docs/SUPPORT_CHAT.md section 9). Visitors are anonymous, so every visitor route is
// limited per visitor and per address; agents are limited per agent. Rwandan mobile networks put many people behind
// one address, so the address limits are generous and the per-visitor ones do the real work.
export const SUPPORT_LIMITS = {
  visitIp: { limit: 300, windowSeconds: 10 * 60 }, // POST /visit per address (one per page load)
  visitVisitor: { limit: 60, windowSeconds: 10 * 60 }, // POST /visit per visitorKey
  prechat: { limit: 6, windowSeconds: 10 * 60 }, // form submits per visitor
  send: { limit: 20, windowSeconds: 10 * 60 }, // visitor messages per visitor
  sendIp: { limit: 120, windowSeconds: 10 * 60 }, // visitor messages per address
  poll: { limit: 150, windowSeconds: 10 * 60 }, // GET messages per visitor (the 5 s fallback while the socket is down)
  typing: { limit: 90, windowSeconds: 60 }, // typing pings per conversation (the widget sends at most one a second)
  upload: { limit: 20, windowSeconds: 60 * 60 }, // upload slots per visitor
  rating: { limit: 10, windowSeconds: 60 * 60 },
  aiPerIpDay: { limit: 60, windowSeconds: 24 * 60 * 60 }, // AI replies per address per day
  aiAll: { limit: 40, windowSeconds: 60 }, // AI replies per minute across everyone (Gemini free tier)
  agent: { limit: 600, windowSeconds: 60 }, // agent API calls per agent
  agentAi: { limit: 60, windowSeconds: 10 * 60 }, // assist, rewrite and translate per agent
  invite: { limit: 30, windowSeconds: 60 * 60 }, // agent-started chats per agent
} satisfies Record<string, RateLimitRule>;

/** Turnstile is asked again every this many visitor messages, and for messages faster than BOT_SPEED_MS. */
export const CHALLENGE_EVERY = 10;
export const BOT_SPEED_MS = 1200;
/** Messages the AI sees of a conversation. */
export const HISTORY_FOR_AI = 12;
/** Messages a conversation view carries; older ones come with ?after= paging. */
export const VIEW_MESSAGES = 60;
/** A visit with no heartbeat for this long is over (the heartbeat RPC says "expired" after the same time). */
export const VISIT_IDLE_MS = 20 * 60 * 1000;
/** "Online" in the live-visitors list. */
export const LIVE_WINDOW_MS = 90 * 1000;
/** On the site but no page change or chat for this long: the "idle" group. */
export const IDLE_AFTER_MS = 5 * 60 * 1000;
/** A visitor who chatted this recently gets no greeting bubble. */
export const GREETING_QUIET_MS = 7 * 24 * 60 * 60 * 1000;
/** An open conversation older than this is not resumed by POST /visit. */
export const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Hand-over with no human reply for this long emails the agents on duty (once per hand-over). */
export const ALERT_AFTER_MS = 2 * 60 * 1000;
/** The AI-resolution judge looks at a chat this long after its last message (Zendesk's messaging default). */
export const JUDGE_AFTER_MS = 2 * 60 * 60 * 1000;
/** An AI-only chat with nothing new for this long is closed by the sweep. */
export const AI_CHAT_IDLE_CLOSE_MS = 24 * 60 * 60 * 1000;
/** Retention (docs/SUPPORT_CHAT.md section 7): IPs and page hits are kept 30 days; attachments 90 days. */
export const IP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const PAGE_HIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ATTACHMENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** An upload slot nobody finished is deleted after this long. */
export const UPLOAD_SLOT_MS = 60 * 60 * 1000;
/** A visitor's draft (typing sneak peek) older than this is not shown. */
export const DRAFT_FRESH_MS = 15 * 1000;
