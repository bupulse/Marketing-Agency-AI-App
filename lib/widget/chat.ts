import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { consumeUsage, refundUsage, UsageLimitError } from "@/lib/usage";
import { RateLimitError, rateLimit } from "@/lib/rate-limit";
import { createLeadFromChat } from "@/lib/leads/service";
import { generateChatReply } from "./ai";
import { loadProjectFacts, loadPublicWidget, type PublicWidget } from "./config";
import { cleanEmail, cleanPhone, hasContact, mergeDetected, shouldAskContact, type Detected } from "./detect";
import { BOT_SPEED_MS, CHALLENGE_EVERY, HISTORY_FOR_AI, MAX_MESSAGE_LENGTH, MAX_SESSION_MESSAGES, WIDGET_LIMITS } from "./limits";
import { checkOrigin } from "./origin";
import { resolveLanguage, supportedLanguage, widgetStrings } from "./strings";
import { needsChallenge, turnstileEnabled, verifyTurnstile, warnTurnstileOff } from "./turnstile";

export const chatBodySchema = z.object({
  key: z.string().min(8).max(64),
  visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  sessionId: z.string().min(1).max(64).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  page: z.string().max(500).optional(),
  origin: z.string().max(253).optional(),
  lang: z.string().max(20).regex(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,2}$/).optional(),
  turnstileToken: z.string().max(2048).optional(),
});

export const leadBodySchema = z.object({
  key: z.string().min(8).max(64),
  visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  sessionId: z.string().min(1).max(64),
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  interest: z.string().trim().max(200).optional(),
  page: z.string().max(500).optional(),
  origin: z.string().max(253).optional(),
  lang: z.string().max(20).regex(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,2}$/).optional(),
});

export interface RequestContext {
  ipHash: string;
  ip: string | null;
  originHeader: string | null;
  referer: string | null;
  ownHosts: string[];
}

export type ServiceResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ServiceResult => ({ status, body: { error, ...extra } });

async function limited(key: string, rule: (typeof WIDGET_LIMITS)[keyof typeof WIDGET_LIMITS]): Promise<ServiceResult | null> {
  try {
    await rateLimit(key, rule);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": String(error.retryAfterSeconds) } };
    }
    throw error;
  }
}

/** Shared by the chat and lead endpoints: ip limit, key, enabled, origin. */
async function admit(key: string, claimedHost: string | undefined, ctx: RequestContext): Promise<{ widget: PublicWidget } | ServiceResult> {
  const flood = await limited(`widget:ipall:${ctx.ipHash}`, WIDGET_LIMITS.ipFlood);
  if (flood) return flood;
  const widget = await loadPublicWidget(key);
  if (!widget || !widget.enabled) return fail(404, "unavailable");
  const blocked = await limited(`widget:ip:${widget.businessId}:${ctx.ipHash}`, WIDGET_LIMITS.ip);
  if (blocked) return blocked;
  const origin = checkOrigin({
    allowedDomains: widget.allowedDomains,
    claimedHost,
    originHeader: ctx.originHeader,
    referer: ctx.referer,
    ownHosts: ctx.ownHosts,
  });
  if (!origin.ok) return fail(403, "origin_not_allowed");
  return { widget };
}

async function saveLead(widget: PublicWidget, sessionId: string, details: Detected, extra: { message?: string; pageUrl?: string }) {
  try {
    await createLeadFromChat({ businessId: widget.businessId, sessionId, ...details, ...extra });
    return true;
  } catch (error) {
    await logError(error, { source: "widget.lead", businessId: widget.businessId });
    return false;
  }
}

/**
 * Takes the next message slot of a session in one statement (row lock + increment), refusing past the
 * session cap. Returns the new count and the previous lastMessageAt, or null at the cap.
 */
async function claimMessage(sessionId: string, now: Date): Promise<{ count: number; previous: Date } | null> {
  const rows = await prisma.$queryRaw<{ count: number; previous: Date }[]>`
    UPDATE "ChatSession" s SET "messageCount" = s."messageCount" + 1, "lastMessageAt" = ${now}
    FROM (SELECT id, "lastMessageAt" AS previous FROM "ChatSession" WHERE id = ${sessionId} FOR UPDATE) o
    WHERE s.id = o.id AND s."messageCount" < ${MAX_SESSION_MESSAGES}
    RETURNING s."messageCount" AS count, o.previous AS previous`;
  const row = rows[0];
  return row ? { count: Number(row.count), previous: new Date(row.previous) } : null;
}

/** Gives a claimed slot back when the request is turned away before anything was saved. */
async function releaseMessage(sessionId: string, previous: Date) {
  await prisma.chatSession
    .updateMany({ where: { id: sessionId, messageCount: { gt: 0 } }, data: { messageCount: { decrement: 1 }, lastMessageAt: previous } })
    .catch(() => {});
}

/** One visitor message in, one assistant reply out. */
export async function handleChat(raw: unknown, ctx: RequestContext): Promise<ServiceResult> {
  const parsed = chatBodySchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid_request");
  const body = parsed.data;

  const admitted = await admit(body.key, body.origin, ctx);
  if (!("widget" in admitted)) return admitted;
  const { widget } = admitted;
  let text = widgetStrings(resolveLanguage({ hint: body.lang, contentLanguage: widget.contentLanguage }));

  const blocked = await limited(`widget:visitor:${widget.businessId}:${body.visitorId}`, WIDGET_LIMITS.visitor);
  if (blocked) return { ...blocked, body: { error: "rate_limited", message: text.busy } };
  warnTurnstileOff();

  const existing = body.sessionId
    ? await prisma.chatSession.findFirst({ where: { id: body.sessionId, businessId: widget.businessId, visitorId: body.visitorId } })
    : null;
  if (body.sessionId && !existing) return fail(404, "session_not_found");
  // Fallback texts follow the visitor's language (what the AI saw them write, else their browser).
  const languageName = resolveLanguage({ sessionLanguage: existing?.language, hint: body.lang, contentLanguage: widget.contentLanguage });
  text = widgetStrings(languageName);

  const now = new Date();
  const pageUrl = body.page?.slice(0, 500);
  const origin = (body.origin ?? "").slice(0, 253) || null;
  const capReply = async (id: string): Promise<ServiceResult> => ({
    status: 200,
    body: { sessionId: id, reply: text.limited, askContact: !(await prisma.lead.findUnique({ where: { sessionId: id } })), limited: true },
  });

  // One check for "this is a bot": needs Turnstile, and is skipped when the keys are not set.
  const challenge = async (prev: { messageCount: number; lastMessageAt: Date } | null): Promise<ServiceResult | null> => {
    if (!turnstileEnabled() || !needsChallenge(prev, now, CHALLENGE_EVERY, BOT_SPEED_MS)) return null;
    if (!body.turnstileToken) return fail(403, "challenge_required");
    if (!(await verifyTurnstile(body.turnstileToken, ctx.ip))) return fail(403, "challenge_failed");
    return null;
  };
  // Counts only requests that passed the session and bot checks, so token-less spam cannot lock out real visitors.
  const businessBusy = async (): Promise<ServiceResult | null> => {
    const over = await limited(`widget:biz:${widget.businessId}`, WIDGET_LIMITS.business);
    return over ? { ...over, body: { error: "rate_limited", message: text.busy } } : null;
  };

  let session: { id: string; language: string | null; pageUrl: string | null };
  let visitorMessages: number;
  if (existing) {
    // Atomic claim of the next message slot: parallel requests cannot all read the same count.
    const claimed = await claimMessage(existing.id, now);
    if (!claimed) return capReply(existing.id);
    const rollback = () => releaseMessage(existing.id, claimed.previous);
    const failed = (await challenge({ messageCount: claimed.count - 1, lastMessageAt: claimed.previous })) ?? (await businessBusy());
    if (failed) {
      await rollback();
      return failed;
    }
    session = existing;
    visitorMessages = claimed.count;
  } else {
    const failed = (await challenge(null)) ?? (await businessBusy());
    if (failed) return failed;
    const created = await prisma.chatSession.create({
      data: { businessId: widget.businessId, visitorId: body.visitorId, origin, pageUrl: pageUrl ?? null, language: supportedLanguage(body.lang), messageCount: 1, lastMessageAt: now },
    });
    session = created;
    visitorMessages = 1;
  }
  await prisma.chatMessage.create({ data: { sessionId: session.id, role: "visitor", content: body.message } });

  const existingLead = await prisma.lead.findUnique({ where: { sessionId: session.id }, select: { id: true } });
  let leadCaptured = Boolean(existingLead);

  let reply = text.limited;
  let aiWantsContact = false;
  let unanswered = false;
  let aiDetected: Detected | undefined;
  let language: string | undefined;

  // The AI reply costs one chat credit of the business owner; without one the widget only collects details.
  let reservation: { periodStart: Date } | null = null;
  // Each visitor address gets a daily allowance of AI replies per business; beyond it only details are collected.
  const dailyCapped = await limited(`widget:aiday:${widget.businessId}:${ctx.ipHash}`, WIDGET_LIMITS.aiPerIpDay);
  if (dailyCapped) {
    unanswered = true;
  } else {
    try {
      reservation = await consumeUsage(widget.userId, "chat");
    } catch (error) {
      if (!(error instanceof UsageLimitError)) throw error;
      unanswered = true;
    }
  }

  if (reservation) {
    try {
      const [rows, projects] = await Promise.all([
        prisma.chatMessage.findMany({
          where: { sessionId: session.id, role: { in: ["visitor", "assistant"] } },
          orderBy: { createdAt: "desc" },
          take: HISTORY_FOR_AI,
          select: { role: true, content: true },
        }),
        loadProjectFacts(widget.businessId),
      ]);
      const history = rows.reverse().map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("visitor" as const), content: m.content }));
      const result = await generateChatReply({ facts: { ...widget.facts, projects }, history, leadCaptured, userId: widget.userId, businessId: widget.businessId });
      reply = result.reply;
      aiWantsContact = result.wantsContact;
      aiDetected = result.detected;
      language = result.language;
    } catch (error) {
      await refundUsage(widget.userId, "chat", reservation.periodStart).catch(() => {});
      await logError(error, { source: "widget.ai", level: "warn", businessId: widget.businessId });
      unanswered = true;
      reply = text.limited;
    }
  }

  const details = mergeDetected(body.message, aiDetected);
  if (hasContact(details)) {
    const firstMessages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: "visitor" },
      orderBy: { createdAt: "asc" },
      take: 3,
      select: { content: true },
    });
    const saved = await saveLead(widget, session.id, details, { message: firstMessages.map((m) => m.content).join(" / ").slice(0, 500), pageUrl: session.pageUrl ?? pageUrl });
    if (saved) {
      leadCaptured = true;
      // The AI could not confirm (no credit or an error): confirm in the business's language.
      if (unanswered) reply = text.thanks;
    }
  }

  await prisma.chatMessage.create({ data: { sessionId: session.id, role: "assistant", content: reply } });
  if (language && !session.language) await prisma.chatSession.update({ where: { id: session.id }, data: { language: language.slice(0, 40) } });

  return {
    status: 200,
    body: {
      sessionId: session.id,
      reply,
      askContact: shouldAskContact({ aiWantsContact, visitorMessages, message: body.message, leadCaptured, unanswered: unanswered && !leadCaptured }),
      leadCaptured,
      limited: unanswered,
      interest: details.interest,
    },
  };
}

/** The visitor filled in the contact card. */
export async function handleLead(raw: unknown, ctx: RequestContext): Promise<ServiceResult> {
  const parsed = leadBodySchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid_request");
  const body = parsed.data;

  const admitted = await admit(body.key, body.origin, ctx);
  if (!("widget" in admitted)) return admitted;
  const { widget } = admitted;
  let text = widgetStrings(resolveLanguage({ hint: body.lang, contentLanguage: widget.contentLanguage }));

  const blocked = await limited(`widget:lead:${widget.businessId}:${body.visitorId}`, WIDGET_LIMITS.lead);
  if (blocked) return { ...blocked, body: { error: "rate_limited", message: text.busy } };

  const email = body.email ? cleanEmail(body.email) : undefined;
  const phone = body.phone ? cleanPhone(body.phone) : undefined;
  if ((body.email && !email) || (body.phone && !phone) || (!email && !phone)) return fail(422, "contact_required", { message: text.need });

  const session = await prisma.chatSession.findFirst({ where: { id: body.sessionId, businessId: widget.businessId, visitorId: body.visitorId } });
  if (!session) return fail(404, "session_not_found");
  text = widgetStrings(resolveLanguage({ sessionLanguage: session.language, hint: body.lang, contentLanguage: widget.contentLanguage }));

  const first = await prisma.chatMessage.findMany({ where: { sessionId: session.id, role: "visitor" }, orderBy: { createdAt: "asc" }, take: 3, select: { content: true } });
  const saved = await saveLead(
    widget,
    session.id,
    { name: body.name || undefined, email, phone, interest: body.interest || undefined },
    { message: first.map((m) => m.content).join(" / ").slice(0, 500), pageUrl: session.pageUrl ?? body.page?.slice(0, 500) },
  );
  if (!saved) return fail(500, "lead_failed", { message: text.error });
  await prisma.chatMessage.create({ data: { sessionId: session.id, role: "system", content: "Visitor shared contact details." } });
  return { status: 200, body: { ok: true, message: text.thanks } };
}
