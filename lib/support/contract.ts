// The support chat's API contract (docs/SUPPORT_CHAT.md "Build"): request bodies, response shapes and real-time events
// for /api/support/v1. The visitor widget, the support app (and later its desktop and phone apps) and the server all
// build against this file. Breaking changes go to /api/support/v2. No server-only imports: the browser bundles use it.
import { z } from "zod";

export const SUPPORT_API = "/api/support/v1";

export const SURFACES = ["public", "dashboard", "creator", "bio"] as const;
export type Surface = (typeof SURFACES)[number];

export const DEPARTMENT_KEYS = ["sales", "technical", "billing", "creators"] as const;
export type DepartmentKey = (typeof DEPARTMENT_KEYS)[number];

export type ConversationStatus = "AI" | "WAITING" | "OPEN" | "PENDING" | "CLOSED";
export type Author = "VISITOR" | "AI" | "AGENT" | "SYSTEM";
export type MessageKind = "TEXT" | "NOTE" | "EVENT" | "FILE" | "VOICE";
export type HandoverReason = "asked" | "not_confident" | "upset" | "topic" | "outside_hours" | "agent";

/** Upload limits shared by the widget (checks before sending) and the server (checks again). */
export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  imageMime: ["image/jpeg", "image/png", "image/webp"],
  fileMime: ["application/pdf"],
  voiceMime: ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"],
  maxVoiceSec: 120,
} as const;

export const MESSAGE_MAX = 2000;

// ---------- Errors: every non-2xx answer is { error: { code, message } } ----------
export type ApiError = { error: { code: string; message: string } };

// ---------- Shared shapes ----------
export type Hours = { open: boolean; opensAt: string | null; closesAt: string | null; timezone: "Africa/Kigali"; label: string };

export type MessageView = {
  id: string;
  author: Author;
  kind: MessageKind;
  body: string;
  /** Agent first name for AGENT messages ("Jean M."); null otherwise. */
  agentName: string | null;
  /** Guide sections an AI answer came from, for the "from the guide" line. */
  sources: { title: string; href: string | null }[] | null;
  /** Action buttons the AI attached, e.g. { label: "Open Channels", href: "/dashboard/connections" }. */
  actions: { label: string; href: string }[] | null;
  attachment: { id: string; mime: string; fileName: string | null; bytes: number; url: string | null; durationSec: number | null; transcript: string | null } | null;
  createdAt: string;
  clientMsgId: string | null;
};

export type ConversationView = {
  id: string;
  number: number;
  status: ConversationStatus;
  aiActive: boolean;
  agent: { name: string; department: string | null } | null;
  /** Private real-time topic for this visitor (only returned to the visitor who owns the conversation). */
  topic: string;
  rating: number | null;
  messages: MessageView[];
};

// ---------- Visitor (widget) endpoints. Header: X-Support-Visit: <visitToken> after POST /visit ----------
export const visitBody = z.object({
  visitorKey: z.string().min(16).max(64),
  surface: z.enum(SURFACES),
  path: z.string().max(500),
  title: z.string().max(300).optional(),
  referrer: z.string().max(500).optional(),
  /** Screen width, to tell phones from desktops when the user agent is unclear. */
  screenW: z.number().int().positive().max(10000).optional(),
  /** The browser asks not to be tracked (Global Privacy Control): no IP, city or page list is stored, and no greeting. */
  optOut: z.boolean().optional(),
});
// POST /visit with the X-Support-Visit header it got before continues that visit (another page of it) and answers the
// same token; a new token comes back when that visit is over (20 minutes without a heartbeat). Send it on every page.
export type VisitResponse = {
  visitToken: string;
  /** Known person: signed-in user (from the session cookie) or a visitor who filled the form before. */
  me: { name: string | null; email: string | null; signedIn: boolean; businessName: string | null; needsForm: boolean };
  hours: Hours;
  /** The greeting for this page, or null when none should show (already chatted, phone, bio page, opted out). */
  greeting: { text: string; delaySec: number; quickReplies: string[] } | null;
  /** An open conversation to resume. */
  conversation: ConversationView | null;
  /** Supabase Realtime connection details for the public visitor topic (no secrets beyond the anon key). */
  realtime: { url: string; anonKey: string } | null;
};

/**
 * Heartbeats go straight to Supabase: rpc("support_heartbeat", { p_token, p_path, p_title }), every 30–60 s while visible.
 * Answers HeartbeatResult: `unread` counts agent messages not seen yet (an agent started a chat or replied while the panel
 * was closed: open it); `error: "expired"` or `"unknown"` means POST /visit again.
 */
export const HEARTBEAT_RPC = "support_heartbeat";
export type HeartbeatResult = { ok: true; unread?: number; throttled?: boolean } | { ok: false; error: "invalid" | "unknown" | "expired" };

export const prechatBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  business: z.string().trim().min(1).max(160),
  whatsapp: z.string().trim().max(30).optional(),
  turnstileToken: z.string().max(4000).optional(),
});

export const sendMessageBody = z.object({
  text: z.string().trim().max(MESSAGE_MAX).optional(),
  attachmentId: z.string().max(40).optional(),
  clientMsgId: z.string().min(8).max(64),
  turnstileToken: z.string().max(4000).optional(),
}).refine((b) => !!b.text || !!b.attachmentId, { message: "Write a message or attach a file." });
/** POST /conversations (first message) and POST /conversations/:id/messages both answer this. */
export type SendMessageResponse = { conversation: ConversationView };

export const typingBody = z.object({ draft: z.string().max(500).optional() });

export const uploadBody = z.object({ mime: z.string().max(100), bytes: z.number().int().positive(), fileName: z.string().max(200).optional(), durationSec: z.number().int().min(0).max(600).optional() });
export type UploadResponse = { attachmentId: string; uploadUrl: string; token: string };

export const ratingBody = z.object({ score: z.union([z.literal(1), z.literal(-1)]), comment: z.string().trim().max(1000).optional(), sendTranscript: z.boolean().optional() });

// Visitor routes:
//   POST /visit                               → VisitResponse
//   POST /prechat                             → { me }
//   POST /conversations                       → SendMessageResponse  (body: sendMessageBody)
//   GET  /conversations/:id/messages?after=<message id>  → { messages: MessageView[], status, aiActive, agent }  (newest 60 without after)
//   POST /conversations/:id/messages          → SendMessageResponse
//   POST /conversations/:id/typing            → 204  (body: typingBody, throttled 1/s; draft only after the chat is open)
//   POST /conversations/:id/human             → SendMessageResponse  (asks for a person)
//   POST /conversations/:id/uploads           → UploadResponse; then PUT the file to uploadUrl; then POST …/uploads/:aid/done → { attachmentId }
//   POST /conversations/:id/rating            → 204
//   POST /conversations/:id/end               → 204

// ---------- Agent (support app) endpoints. Header: Authorization: Bearer <Supabase access token, aal2> ----------
export type AgentMe = { id: string; name: string; email: string; role: "AGENT" | "SUPERVISOR"; availability: "online" | "away" | "offline"; departments: DepartmentKey[] };

export type ConversationListItem = {
  id: string;
  number: number;
  status: ConversationStatus;
  visitorName: string;
  businessName: string | null;
  preview: string;
  lastMessageAt: string;
  waitingSince: string | null;
  department: DepartmentKey | null;
  assigneeName: string | null;
  tags: string[];
  urgency: string | null;
  leadScore: number | null;
  language: string | null;
  unread: boolean;
};

export type AccountFacts = {
  businessName: string | null;
  plan: string | null;
  planStatus: string | null; // trial | active | past_due | pending_payment | none
  trialDaysLeft: number | null;
  businessInfoPercent: number | null;
  channels: { platform: string; ok: boolean }[];
  failedPostsThisWeek: number | null;
  adminHref: string | null;
};

export type VisitView = {
  country: string | null;
  city: string | null;
  ip: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  referrer: string | null;
  surface: Surface;
  currentPath: string | null;
  pages: { path: string; title: string | null; at: string }[];
  startedAt: string;
  lastSeenAt: string;
  visitCount: number;
};

export type ConversationDetail = ConversationListItem & {
  aiActive: boolean;
  handoverReason: HandoverReason | null;
  summary: string | null;
  visitor: { id: string; name: string | null; email: string | null; phone: string | null; signedIn: boolean };
  account: AccountFacts | null;
  visit: VisitView | null;
  past: { id: string; number: number; title: string; outcome: string; at: string }[];
  /** `original`: what the agent wrote before it was translated into the visitor's language (agentMessageBody.translateTo). */
  messages: (MessageView & { seenByVisitorAt: string | null; original: string | null })[];
};

export type LiveVisitor = {
  visitId: string;
  visitorId: string;
  name: string; // "Aline Uwase", "Sample Hardware Ltd" or "Visitor 4821"
  kind: "visitor" | "client" | "creator";
  group: "waiting" | "chatting" | "browsing" | "idle";
  conversationId: string | null;
  typing: string | null; // sneak peek, only after they opened the chat
  country: string | null;
  city: string | null;
  currentPath: string | null;
  pageCount: number;
  secondsOnSite: number;
  visitCount: number;
  referrer: string | null;
  device: string | null;
  browser: string | null;
  leadScore: number | null;
};

export const availabilityBody = z.object({ availability: z.enum(["online", "away", "offline"]) });
/** POST /agent/devices: a Web Push subscription (PushSubscription.toJSON()), or later a desktop or phone app's token. */
export const deviceBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  label: z.string().max(80).optional(),
  kind: z.enum(["webpush", "tauri", "fcm", "apns"]).default("webpush"),
});

export const agentMessageBody = z.object({
  text: z.string().trim().min(1).max(MESSAGE_MAX),
  kind: z.enum(["TEXT", "NOTE"]).default("TEXT"),
  clientMsgId: z.string().min(8).max(64),
  /** Send in the visitor's language (the original stays visible to agents). */
  translateTo: z.string().length(2).optional(),
});
export const assignBody = z.object({ agentId: z.string().max(40).optional(), department: z.enum(DEPARTMENT_KEYS).optional(), note: z.string().max(500).optional() });
export const rewriteBody = z.object({ text: z.string().trim().min(1).max(MESSAGE_MAX), style: z.enum(["friendlier", "formal", "shorter", "translate"]), lang: z.string().length(2).optional() });
export const inviteVisitorBody = z.object({ text: z.string().trim().min(1).max(MESSAGE_MAX) });
export type Assist = { summary: string; suggestions: string[]; sources: { title: string; href: string | null }[] };
export type Stats = {
  from: string;
  to: string;
  chats: number;
  aiSolvedPercent: number | null;
  handoverPercent: number | null;
  firstHumanReplySec: number | null; // median, team hours
  ratedGoodPercent: number | null;
  newLeads: number;
  agents: { id: string; name: string; availability: string; openChats: number; maxChats: number; ratedGoodPercent: number | null }[];
};

// Agent routes:
//   GET   /agent/me                                     → AgentMe
//   PATCH /agent/me                                     → AgentMe   (body: availabilityBody)
//   POST  /agent/devices → 201 { id } (body: deviceBody), DELETE /agent/devices/:id → 204  (web push subscriptions)
//   GET   /agent/conversations?view=mine|waiting|ai|all&q=&after=  → { items: ConversationListItem[], next: string | null }
//   GET   /agent/conversations/:id                      → ConversationDetail
//   POST  /agent/conversations/:id/messages             → { message: MessageView }   (body: agentMessageBody)
//   POST  /agent/conversations/:id/takeover             → ConversationDetail
//   POST  /agent/conversations/:id/release              → ConversationDetail  (give back to the AI)
//   POST  /agent/conversations/:id/assign               → ConversationDetail  (body: assignBody)
//   POST  /agent/conversations/:id/close | /reopen      → ConversationDetail
//   POST  /agent/conversations/:id/typing               → 204
//   GET   /agent/conversations/:id/assist               → Assist  (cached per last message)
//   POST  /agent/assist/rewrite                         → { text }  (body: rewriteBody)
//   GET   /agent/visitors/live                          → { items: LiveVisitor[], counts: Record<LiveVisitor["group"], number> }
//   POST  /agent/visitors/:visitorId/invite             → { conversationId }  (body: inviteVisitorBody)
//   GET   /agent/stats?from=&to=                        → Stats  (supervisors)
//   GET   /agent/realtime                               → { url, anonKey, topics: string[] }

// ---------- Real time (Supabase Realtime Broadcast). Payloads are small; clients fetch details over REST. ----------
/** Public visitor topic: `sv:<secret>`; the secret is 128 random bits, only its hash is stored. */
export const visitorTopic = (secret: string) => `sv:${secret}`;
/** Private staff topics (RLS: an active SupportAgent with an aal2 session). */
export const STAFF_TOPICS = { inbox: "staff:inbox", visitors: "staff:visitors", presence: "staff:presence" } as const;
export const agentTopic = (agentId: string) => `agent:${agentId}`;
export const conversationTopic = (conversationId: string) => `conv:${conversationId}`;

export type RealtimeEvent =
  | { type: "message.created"; conversationId: string; messageId: string }
  | { type: "conversation.updated"; conversationId: string; fields: string[] }
  | { type: "typing"; conversationId: string; who: "visitor" | "agent" | "ai"; draft?: string }
  | { type: "handover"; conversationId: string; reason: HandoverReason }
  | { type: "visitor.changed"; visitId: string }
  | { type: "agent.force_logout"; agentId: string };
export const REALTIME_EVENT = "support";
