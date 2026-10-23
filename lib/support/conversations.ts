import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { scheduleJob } from "@/lib/jobs/due";
import { needsChallenge, turnstileEnabled, verifyTurnstile, warnTurnstileOff } from "@/lib/widget/turnstile";
import { answerVisitor, JOB_JUDGE } from "./answer";
import type { ConversationView, MessageView, ratingBody, SendMessageResponse, sendMessageBody } from "./contract";
import { handOver, handoverText } from "./handover";
import { SupportError, limit } from "./http";
import { BOT_SPEED_MS, CHALLENGE_EVERY, SUPPORT_LIMITS, VIEW_MESSAGES } from "./limits";
import { broadcast } from "./realtime";
import { getSupportSettings, teamHours } from "./settings";
import { sha256Hex, newId, topicSecret } from "./tokens";
import { scheduleTranscript } from "./emails";
import { noteLeadQuestion } from "./prechat";
import { agentOf, conversationSelect, messageSelect, toConversationView, toMessageViews } from "./views";
import type { VisitorSession } from "./visits";

// The visitor's side of a chat (contract.ts "Visitor routes"). A visitor only ever reaches their own conversations:
// the visit token names the visitor, and a conversation id of anyone else answers 404, the same as one that does not
// exist. Sends are idempotent: the same clientMsgId twice stores one message and gets one AI answer.

export type RequestCtx = { ip: string | null; ipHash: string };

/** The visitor's own conversation, or 404. A signed-in person also reaches their chats from another browser. */
export async function ownConversation(session: VisitorSession, id: string) {
  const c = await prisma.supportConversation.findUnique({ where: { id }, select: { ...conversationSelect, visitorId: true, lastVisitorMessageAt: true, visitor: { select: { userId: true } } } });
  const mine = c && (c.visitorId === session.visitorId || (!!session.visitor.userId && c.visitor.userId === session.visitor.userId));
  if (!mine) throw new SupportError(404, "not_found", "This chat was not found.");
  return c;
}

async function view(conversationId: string): Promise<ConversationView> {
  const c = await prisma.supportConversation.findUniqueOrThrow({ where: { id: conversationId }, select: conversationSelect });
  const messages = await prisma.supportMessage.findMany({ where: { conversationId, kind: { not: "NOTE" } }, orderBy: { createdAt: "desc" }, take: VIEW_MESSAGES, select: messageSelect });
  return toConversationView(c, messages.reverse());
}

/** Turnstile (when its keys are set): a new chat, every 10th message and messages faster than a person types. */
async function challenge(token: string | undefined, prev: { messageCount: number; lastMessageAt: Date } | null, ip: string | null) {
  warnTurnstileOff();
  if (!turnstileEnabled() || !needsChallenge(prev, new Date(), CHALLENGE_EVERY, BOT_SPEED_MS)) return;
  if (!token) throw new SupportError(403, "challenge_required", "Please confirm you are not a robot.");
  if (!(await verifyTurnstile(token, ip))) throw new SupportError(403, "challenge_failed", "The robot check did not pass. Please try again.");
}

function requireForm(session: VisitorSession) {
  const publicPage = session.surface === "public" || session.surface === "bio";
  if (publicPage && !session.visitor.userId && !(session.visitor.name && session.visitor.email)) {
    throw new SupportError(403, "form_required", "Please tell us your name and email first, so we can reply if you leave.");
  }
}

/** The attachment a message carries: this conversation's, uploaded, not used by another message. */
async function usableAttachment(conversationId: string, attachmentId: string) {
  const a = await prisma.supportAttachment.findUnique({ where: { id: attachmentId }, select: { id: true, conversationId: true, uploadedAt: true, mime: true, fileName: true, message: { select: { id: true } } } });
  if (!a || a.conversationId !== conversationId) throw new SupportError(404, "attachment_not_found", "That file was not found. Please attach it again.");
  if (!a.uploadedAt) throw new SupportError(409, "attachment_not_ready", "That file has not finished uploading yet.");
  if (a.message) throw new SupportError(409, "attachment_used", "That file was already sent.");
  return a;
}

const attachmentBody = (a: { mime: string; fileName: string | null }) => (a.mime.startsWith("audio/") ? "Voice note" : a.mime.startsWith("image/") ? (a.fileName ?? "Photo") : (a.fileName ?? "File"));

/** Stores one visitor message (idempotent), then lets the AI answer it. */
async function addVisitorMessage(conversationId: string, body: z.infer<typeof sendMessageBody>, ctx: RequestCtx): Promise<void> {
  const existing = await prisma.supportMessage.findUnique({ where: { conversationId_clientMsgId: { conversationId, clientMsgId: body.clientMsgId } }, select: { id: true } });
  if (existing) return; // a retry: the first send already got its answer
  const attachment = body.attachmentId ? await usableAttachment(conversationId, body.attachmentId) : null;
  const now = new Date();
  let messageId: string;
  try {
    const m = await prisma.supportMessage.create({
      data: {
        conversationId,
        author: "VISITOR",
        kind: attachment ? (attachment.mime.startsWith("audio/") ? "VOICE" : "FILE") : "TEXT",
        body: body.text?.trim() || (attachment ? attachmentBody(attachment) : ""),
        clientMsgId: body.clientMsgId,
        attachmentId: attachment?.id ?? null,
        createdAt: now,
      },
      select: { id: true },
    });
    messageId = m.id;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return; // the same send arrived twice at once
    throw error;
  }
  const c = await prisma.supportConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now, lastVisitorMessageAt: now, visitorDraft: null, visitorDraftAt: null },
    select: { status: true, aiActive: true },
  });
  // A message into a closed chat opens it again, with the AI when nobody had taken it over.
  if (c.status === "CLOSED") await prisma.supportConversation.update({ where: { id: conversationId }, data: { status: c.aiActive ? "AI" : "OPEN", closedAt: null, closedBy: null } });
  await broadcast({ type: "message.created", conversationId, messageId }, { inbox: true, conversation: conversationId });
  await answerVisitor(conversationId, ctx, now);
}

/** POST /conversations: the first message. Reuses the visitor's open chat, so two tabs never make two. */
export async function startConversation(session: VisitorSession, body: z.infer<typeof sendMessageBody>, ctx: RequestCtx): Promise<SendMessageResponse> {
  if (body.attachmentId) throw new SupportError(400, "invalid_request", "Write a message first; files can be added once the chat has started.");
  requireForm(session);
  await limit(`support:send:${session.visitorId}`, SUPPORT_LIMITS.send);
  await limit(`support:send:ip:${ctx.ipHash}`, SUPPORT_LIMITS.sendIp);
  const retried = await prisma.supportMessage.findFirst({ where: { clientMsgId: body.clientMsgId, conversation: { visitorId: session.visitorId } }, select: { conversationId: true } });
  if (retried) return { conversation: await view(retried.conversationId) };
  const open = await prisma.supportConversation.findFirst({ where: { visitorId: session.visitorId, status: { not: "CLOSED" } }, orderBy: { lastMessageAt: "desc" }, select: { id: true } });
  if (open) return sendMessage(session, open.id, body, ctx);
  await challenge(body.turnstileToken, null, ctx.ip);
  const id = newId();
  await prisma.supportConversation.create({
    data: { id, visitorId: session.visitorId, visitId: session.visitId, surface: session.surface, topicTokenHash: await sha256Hex(await topicSecret(id)) },
  });
  await prisma.supportEvent.create({ data: { name: "conversation_started", conversationId: id } });
  await noteLeadQuestion(session.visitor.leadId, body.text ?? "");
  await addVisitorMessage(id, body, ctx);
  return { conversation: await view(id) };
}

/** POST /conversations/:id/messages. */
export async function sendMessage(session: VisitorSession, id: string, body: z.infer<typeof sendMessageBody>, ctx: RequestCtx): Promise<SendMessageResponse> {
  const c = await ownConversation(session, id);
  await limit(`support:send:${session.visitorId}`, SUPPORT_LIMITS.send);
  await limit(`support:send:ip:${ctx.ipHash}`, SUPPORT_LIMITS.sendIp);
  const count = await prisma.supportMessage.count({ where: { conversationId: id, author: "VISITOR" } });
  await challenge(body.turnstileToken, { messageCount: count, lastMessageAt: c.lastVisitorMessageAt ?? new Date(0) }, ctx.ip);
  await addVisitorMessage(id, body, ctx);
  return { conversation: await view(id) };
}

/** GET /conversations/:id/messages?after=<message id>. Marks what the visitor now sees as seen. */
export async function visitorMessages(session: VisitorSession, id: string, after: string | null): Promise<{ messages: MessageView[]; status: ConversationView["status"]; aiActive: boolean; agent: ConversationView["agent"] }> {
  const c = await ownConversation(session, id);
  await limit(`support:poll:${session.visitorId}`, SUPPORT_LIMITS.poll);
  const from = after ? await prisma.supportMessage.findFirst({ where: { id: after, conversationId: id }, select: { createdAt: true } }) : null;
  const rows = await prisma.supportMessage.findMany({
    where: { conversationId: id, kind: { not: "NOTE" }, ...(from ? { createdAt: { gt: from.createdAt } } : {}) },
    orderBy: { createdAt: from ? "asc" : "desc" },
    take: VIEW_MESSAGES,
    select: messageSelect,
  });
  const messages = from ? rows : rows.reverse();
  const unseen = messages.filter((m) => m.author !== "VISITOR" && !m.seenByVisitorAt).map((m) => m.id);
  if (unseen.length) await prisma.supportMessage.updateMany({ where: { id: { in: unseen } }, data: { seenByVisitorAt: new Date() } });
  return { messages: await toMessageViews(messages), status: c.status, aiActive: c.aiActive, agent: agentOf(c) };
}

/** POST /conversations/:id/typing: a ping for the agents, with the draft (sneak peek) since the chat is open. */
export async function visitorTyping(session: VisitorSession, id: string, draft: string | undefined) {
  await ownConversation(session, id);
  await limit(`support:typing:${id}`, SUPPORT_LIMITS.typing);
  const text = draft?.slice(0, 500) || null;
  await prisma.supportConversation.update({ where: { id }, data: { visitorDraft: text, visitorDraftAt: text ? new Date() : null } });
  await broadcast({ type: "typing", conversationId: id, who: "visitor", ...(text ? { draft: text } : {}) }, { conversation: id });
}

/** POST /conversations/:id/human: the visitor pressed "Talk to a person". */
export async function askForHuman(session: VisitorSession, id: string): Promise<SendMessageResponse> {
  const c = await ownConversation(session, id);
  await limit(`support:send:${session.visitorId}`, SUPPORT_LIMITS.send);
  if (c.status === "AI") {
    const settings = await getSupportSettings();
    const language = (await prisma.supportConversation.findUnique({ where: { id }, select: { language: true } }))?.language ?? null;
    const m = await prisma.supportMessage.create({ data: { conversationId: id, author: "SYSTEM", kind: "TEXT", body: handoverText(language, teamHours(settings)), lang: language }, select: { id: true } });
    await broadcast({ type: "message.created", conversationId: id, messageId: m.id }, { inbox: true, conversation: id });
    await handOver(id, "asked");
  }
  return { conversation: await view(id) };
}

/** POST /conversations/:id/rating: thumbs up or down, an optional comment, and the transcript by email if asked. */
export async function rateConversation(session: VisitorSession, id: string, body: z.infer<typeof ratingBody>) {
  await ownConversation(session, id);
  await limit(`support:rating:${session.visitorId}`, SUPPORT_LIMITS.rating);
  await prisma.supportConversation.update({ where: { id }, data: { rating: body.score, ratingComment: body.comment?.trim() || null } });
  await prisma.supportEvent.create({ data: { name: "rated", conversationId: id, value: body.score } });
  if (body.score === -1) await prisma.supportConversation.updateMany({ where: { id, aiResolved: null, handoverAt: null }, data: { aiResolved: false } });
  await broadcast({ type: "conversation.updated", conversationId: id, fields: ["rating"] }, { inbox: true, conversation: id });
  if (body.sendTranscript) await scheduleTranscript(id);
}

/** POST /conversations/:id/end: the visitor closed the chat. */
export async function endConversation(session: VisitorSession, id: string) {
  const c = await ownConversation(session, id);
  if (c.status === "CLOSED") return;
  const now = new Date();
  await prisma.supportConversation.update({ where: { id }, data: { status: "CLOSED", closedAt: now, closedBy: "visitor", waitingSince: null, visitorDraft: null } });
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { conversationId: id, author: "SYSTEM", kind: "EVENT", body: "The visitor ended the chat." } }),
    prisma.supportEvent.create({ data: { name: "closed", conversationId: id, at: now } }),
  ]);
  await scheduleJob({ kind: JOB_JUDGE, runAt: now, payload: { conversationId: id }, dedupeKey: `${JOB_JUDGE}:${id}` });
  await broadcast({ type: "conversation.updated", conversationId: id, fields: ["status"] }, { inbox: true, conversation: id });
}
