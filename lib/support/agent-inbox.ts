import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { scheduleJob } from "@/lib/jobs/due";
import { generateAssist, rewriteText } from "./ai";
import { historyFor } from "./answer";
import type { agentMessageBody, assignBody, Assist, ConversationDetail, ConversationListItem, DepartmentKey, MessageView, Surface, VisitView } from "./contract";
import { JOB_REPLY_EMAIL } from "./emails";
import { accountFacts, factsContext } from "./facts";
import { searchGuide } from "./guide";
import { SupportError, limit } from "./http";
import { ALERT_AFTER_MS, SUPPORT_LIMITS } from "./limits";
import { anonymousName } from "./live";
import { broadcast } from "./realtime";
import { priorityOf } from "./rules";
import { pageSources } from "./sources";
import { firstReplyTimes } from "./stats";
import { newId, sha256Hex, topicSecret } from "./tokens";
import { messageSelect, originalOf, shortName, toMessageViews } from "./views";
import type { AgentSession } from "./agent-auth";

// The agent's side of the chats (contract.ts "Agent routes"). Agents see the AI's chats, the waiting ones and their
// own; a chat assigned to another agent is a supervisor's (they read it live, reassign it). Replying to a chat the AI
// holds takes it over: the AI goes quiet. Internal notes never reach the visitor.

const listSelect = {
  id: true, number: true, status: true, lastMessageAt: true, waitingSince: true, tags: true, urgency: true, leadScore: true, language: true, assigneeId: true,
  department: { select: { key: true } },
  assignee: { select: { name: true } },
  visitor: { select: { id: true, name: true, email: true, businessName: true } },
  messages: { orderBy: { createdAt: "desc" }, take: 1, select: { author: true, kind: true, body: true, seenByAgentAt: true } },
} satisfies Prisma.SupportConversationSelect;

type ListRow = Prisma.SupportConversationGetPayload<{ select: typeof listSelect }>;

function toListItem(c: ListRow): ConversationListItem {
  const last = c.messages[0];
  return {
    id: c.id,
    number: c.number,
    status: c.status,
    visitorName: c.visitor.name ?? c.visitor.businessName ?? anonymousName(c.visitor.id),
    businessName: c.visitor.businessName,
    preview: (last ? `${last.kind === "NOTE" ? "Note: " : ""}${last.body}` : "").slice(0, 140),
    lastMessageAt: c.lastMessageAt.toISOString(),
    waitingSince: c.waitingSince?.toISOString() ?? null,
    department: (c.department?.key as DepartmentKey | undefined) ?? null,
    assigneeName: c.assignee ? shortName(c.assignee.name) : null,
    tags: c.tags,
    urgency: c.urgency,
    leadScore: c.leadScore,
    language: c.language,
    unread: !!last && last.author === "VISITOR" && !last.seenByAgentAt,
  };
}

/** May this agent read the chat: supervisors all; agents the unassigned ones and their own. */
export function canSee(agent: Pick<AgentSession, "id" | "role">, c: { assigneeId: string | null }): boolean {
  return agent.role === "SUPERVISOR" || !c.assigneeId || c.assigneeId === agent.id;
}

async function loadFor(agent: AgentSession, id: string) {
  const c = await prisma.supportConversation.findUnique({ where: { id }, select: { id: true, status: true, aiActive: true, assigneeId: true, handoverAt: true, createdAt: true, firstHumanReplyAt: true, language: true, visitorId: true } });
  if (!c) throw new SupportError(404, "not_found", "This chat was not found.");
  if (!canSee(agent, c)) throw new SupportError(403, "not_yours", "This chat belongs to another agent. Ask a supervisor to reassign it.");
  return c;
}

export type ListView = "mine" | "waiting" | "ai" | "all";

/** Cursor: the last item's "<ISO time>|<id>". */
function cursorOf(item: { lastMessageAt: Date | string; id: string }) {
  return `${typeof item.lastMessageAt === "string" ? item.lastMessageAt : item.lastMessageAt.toISOString()}|${item.id}`;
}

export async function listConversations(agent: AgentSession, input: { view: ListView; q?: string | null; after?: string | null; limit?: number }): Promise<{ items: ConversationListItem[]; next: string | null }> {
  const take = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const visible: Prisma.SupportConversationWhereInput = agent.role === "SUPERVISOR" ? {} : { OR: [{ assigneeId: null }, { assigneeId: agent.id }] };
  const view: Prisma.SupportConversationWhereInput =
    input.view === "mine" ? { assigneeId: agent.id, status: { not: "CLOSED" } }
    : input.view === "waiting" ? { status: { in: ["WAITING", "PENDING"] } }
    : input.view === "ai" ? { status: "AI" }
    : {};
  const q = input.q?.trim().slice(0, 100);
  const search: Prisma.SupportConversationWhereInput = q
    ? { OR: [...(/^#?\d+$/.test(q) ? [{ number: Number(q.replace("#", "")) }] : []), { visitor: { name: { contains: q, mode: "insensitive" } } }, { visitor: { email: { contains: q, mode: "insensitive" } } }, { visitor: { businessName: { contains: q, mode: "insensitive" } } }] }
    : {};
  const [at, id] = (input.after ?? "").split("|");
  const cursor: Prisma.SupportConversationWhereInput = at && id && !Number.isNaN(Date.parse(at)) ? { OR: [{ lastMessageAt: { lt: new Date(at) } }, { lastMessageAt: new Date(at), id: { lt: id } }] } : {};
  const rows = await prisma.supportConversation.findMany({ where: { AND: [visible, view, search, cursor] }, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], take: take + 1, select: listSelect });
  const page = rows.slice(0, take);
  // Within a page, tagged chats (upset, urgent, hot leads) come first; the waiting view keeps the oldest wait first.
  const items = page.map(toListItem).sort((a, b) => (input.view === "waiting" ? (a.waitingSince ?? "").localeCompare(b.waitingSince ?? "") : priorityOf(b) - priorityOf(a)));
  return { items, next: rows.length > take ? cursorOf(page[page.length - 1]) : null };
}

function visitView(v: { country: string | null; city: string | null; ip: string | null; device: string | null; os: string | null; browser: string | null; referrer: string | null; surface: string; currentPath: string | null; startedAt: Date; lastSeenAt: Date; pages: { path: string; title: string | null; at: Date }[] }, visitCount: number): VisitView {
  return { ...v, surface: v.surface as Surface, pages: v.pages.map((p) => ({ path: p.path, title: p.title, at: p.at.toISOString() })), startedAt: v.startedAt.toISOString(), lastSeenAt: v.lastSeenAt.toISOString(), visitCount };
}

/** GET /agent/conversations/:id. Marks the visitor's messages as seen by an agent. */
export async function conversationDetail(agent: AgentSession, id: string): Promise<ConversationDetail> {
  await loadFor(agent, id);
  const c = await prisma.supportConversation.findUniqueOrThrow({
    where: { id },
    select: {
      ...listSelect,
      aiActive: true, handoverReason: true, summary: true,
      visitor: { select: { id: true, name: true, email: true, phone: true, businessName: true, userId: true, businessId: true, visitCount: true } },
      visit: { select: { country: true, city: true, ip: true, device: true, os: true, browser: true, referrer: true, surface: true, currentPath: true, startedAt: true, lastSeenAt: true, pages: { orderBy: { at: "asc" }, take: 50, select: { path: true, title: true, at: true } } } },
    },
  });
  const [rows, past, account] = await Promise.all([
    prisma.supportMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: 200, select: messageSelect }),
    prisma.supportConversation.findMany({ where: { visitorId: c.visitor.id, id: { not: id } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, number: true, summary: true, status: true, rating: true, aiResolved: true, handoverAt: true, createdAt: true, messages: { where: { author: "VISITOR" }, orderBy: { createdAt: "asc" }, take: 1, select: { body: true } } } }),
    c.visitor.businessId ? accountFacts(c.visitor.businessId).catch(() => null) : null,
  ]);
  const messages = rows.reverse();
  const unseen = messages.filter((m) => m.author === "VISITOR" && !m.seenByAgentAt).map((m) => m.id);
  if (unseen.length) await prisma.supportMessage.updateMany({ where: { id: { in: unseen } }, data: { seenByAgentAt: new Date() } });
  const views = await toMessageViews(messages);
  return {
    ...toListItem({ ...c, messages: c.messages.map((m) => ({ ...m, seenByAgentAt: m.seenByAgentAt ?? (unseen.length ? new Date() : null) })) }),
    aiActive: c.aiActive,
    handoverReason: (c.handoverReason as ConversationDetail["handoverReason"]) ?? null,
    summary: c.summary,
    visitor: { id: c.visitor.id, name: c.visitor.name, email: c.visitor.email, phone: c.visitor.phone, signedIn: !!c.visitor.userId },
    account,
    visit: c.visit ? visitView(c.visit, c.visitor.visitCount) : null,
    past: past.map((p) => ({
      id: p.id,
      number: p.number,
      title: (p.summary ?? p.messages[0]?.body ?? `Chat #${p.number}`).slice(0, 120),
      outcome: p.status !== "CLOSED" ? "open" : p.rating === 1 ? "rated good" : p.rating === -1 ? "rated not good" : p.aiResolved ? "solved by the AI" : p.handoverAt ? "handled by the team" : "closed",
      at: p.createdAt.toISOString(),
    })),
    messages: views.map((v, i) => ({ ...v, seenByVisitorAt: messages[i].seenByVisitorAt?.toISOString() ?? null, original: originalOf(messages[i]) })),
  };
}

/** A divider line in the chat, shown to the visitor as it is: keep it short and visitor-ready. */
async function event(conversationId: string, body: string) {
  return prisma.supportMessage.create({ data: { conversationId, author: "SYSTEM", kind: "EVENT", body }, select: { id: true } });
}

async function changed(conversationId: string, fields: string[], messageId?: string) {
  if (messageId) await broadcast({ type: "message.created", conversationId, messageId }, { inbox: true, conversation: conversationId, visitor: conversationId });
  await broadcast({ type: "conversation.updated", conversationId, fields }, { inbox: true, conversation: conversationId, visitor: conversationId });
}

/** The agent takes the chat: the AI goes quiet, the chat is theirs and open. No-op when it already is. */
async function take(agent: AgentSession, c: Awaited<ReturnType<typeof loadFor>>, now: Date) {
  if (c.status === "OPEN" && !c.aiActive && c.assigneeId === agent.id) return null;
  if (c.assigneeId && c.assigneeId !== agent.id && agent.role !== "SUPERVISOR") throw new SupportError(403, "not_yours", "This chat belongs to another agent.");
  await prisma.supportConversation.update({ where: { id: c.id }, data: { status: "OPEN", aiActive: false, assigneeId: agent.id, closedAt: null, closedBy: null, ...(c.handoverAt ? {} : { handoverAt: now, handoverReason: "agent" }) } });
  return event(c.id, c.aiActive ? `${shortName(agent.name)} joined · the AI stepped back` : `${shortName(agent.name)} joined the chat`);
}

/** POST /agent/conversations/:id/messages. A TEXT reply takes the chat over; a NOTE stays internal. */
export async function agentMessage(agent: AgentSession, id: string, body: z.infer<typeof agentMessageBody>): Promise<{ message: MessageView }> {
  const c = await loadFor(agent, id);
  const existing = await prisma.supportMessage.findUnique({ where: { conversationId_clientMsgId: { conversationId: id, clientMsgId: body.clientMsgId } }, select: messageSelect });
  if (existing) return { message: (await toMessageViews([existing]))[0] };
  const now = new Date();
  if (body.kind === "TEXT") {
    const joined = await take(agent, c, now);
    if (joined) await changed(id, ["status", "assignee", "aiActive"], joined.id);
  }
  let text = body.text;
  let translations: Prisma.InputJsonValue | undefined;
  if (body.kind === "TEXT" && body.translateTo && body.translateTo !== (c.language ?? "en") && body.translateTo !== "en") {
    await limit(`support:agentai:${agent.id}`, SUPPORT_LIMITS.agentAi);
    try {
      text = await rewriteText({ text: body.text, style: "translate", lang: body.translateTo });
      translations = { original: body.text, [body.translateTo]: text };
    } catch (error) {
      await logError(error, { source: "support.translate", level: "warn" });
      throw new SupportError(503, "translate_failed", "The translation did not work just now. Send it in English, or try again.");
    }
  }
  let created;
  try {
    created = await prisma.supportMessage.create({
      data: { conversationId: id, author: "AGENT", agentId: agent.id, kind: body.kind, body: text, lang: body.kind === "TEXT" ? (body.translateTo ?? null) : null, translations, clientMsgId: body.clientMsgId },
      select: messageSelect,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    created = await prisma.supportMessage.findUniqueOrThrow({ where: { conversationId_clientMsgId: { conversationId: id, clientMsgId: body.clientMsgId } }, select: messageSelect });
    return { message: (await toMessageViews([created]))[0] };
  }
  if (body.kind === "TEXT") {
    const first = !c.firstHumanReplyAt;
    await prisma.supportConversation.update({ where: { id }, data: { lastMessageAt: now, agentReplyCount: { increment: 1 }, waitingSince: null, ...(first ? { firstHumanReplyAt: now } : {}) } });
    if (first) {
      const t = await firstReplyTimes(c.handoverAt ?? c.createdAt, now);
      await prisma.supportEvent.create({ data: { name: "first_human_reply", conversationId: id, agentId: agent.id, value: t.value, valueInHours: t.valueInHours, at: now } });
    }
    // Emailed to the visitor if they have not seen it in the chat 2 minutes later (the "reply by email" promise).
    await scheduleJob({ kind: JOB_REPLY_EMAIL, runAt: new Date(now.getTime() + ALERT_AFTER_MS), payload: { conversationId: id }, dedupeKey: `${JOB_REPLY_EMAIL}:${id}` });
    await broadcast({ type: "message.created", conversationId: id, messageId: created.id }, { inbox: true, conversation: id, visitor: id });
  } else {
    await broadcast({ type: "message.created", conversationId: id, messageId: created.id }, { conversation: id });
  }
  return { message: (await toMessageViews([created]))[0] };
}

export async function takeover(agent: AgentSession, id: string) {
  const c = await loadFor(agent, id);
  const joined = await take(agent, c, new Date());
  if (joined) await changed(id, ["status", "assignee", "aiActive"], joined.id);
  return conversationDetail(agent, id);
}

/** Gives the chat back to the AI. */
export async function release(agent: AgentSession, id: string) {
  const c = await loadFor(agent, id);
  if (c.assigneeId && c.assigneeId !== agent.id && agent.role !== "SUPERVISOR") throw new SupportError(403, "not_yours", "This chat belongs to another agent.");
  if (c.status === "CLOSED") throw new SupportError(409, "closed", "This chat is closed. Reopen it first.");
  if (c.aiActive && c.status === "AI") return conversationDetail(agent, id);
  await prisma.supportConversation.update({ where: { id }, data: { status: "AI", aiActive: true, assigneeId: null, waitingSince: null } });
  const m = await event(id, "The BuPulse assistant is back");
  await changed(id, ["status", "assignee", "aiActive"], m.id);
  return conversationDetail(agent, id);
}

/** Reassign (supervisors, or an agent passing on their own chat) to an agent and/or a department. */
export async function assign(agent: AgentSession, id: string, body: z.infer<typeof assignBody>) {
  const c = await loadFor(agent, id);
  if (agent.role !== "SUPERVISOR" && c.assigneeId && c.assigneeId !== agent.id) throw new SupportError(403, "not_yours", "Only supervisors can reassign another agent's chat.");
  if (!body.agentId && !body.department) throw new SupportError(400, "invalid_request", "Choose an agent or a department.");
  const target = body.agentId ? await prisma.supportAgent.findUnique({ where: { id: body.agentId }, select: { id: true, name: true, status: true, lockedAt: true } }) : null;
  if (body.agentId && (!target || target.status !== "active" || target.lockedAt)) throw new SupportError(400, "agent_unavailable", "That agent cannot take chats right now.");
  const department = body.department ? await prisma.supportDepartment.findUnique({ where: { key: body.department }, select: { id: true, name: true } }) : null;
  await prisma.supportConversation.update({
    where: { id },
    data: { ...(target ? { assigneeId: target.id, aiActive: false, ...(c.status === "AI" ? { status: "WAITING", waitingSince: new Date(), handoverAt: c.handoverAt ?? new Date(), handoverReason: "agent" } : {}) } : {}), ...(department ? { departmentId: department.id } : {}) },
  });
  const what = [target ? `to ${shortName(target.name)}` : null, department ? `to ${department.name}` : null].filter(Boolean).join(" and ");
  const m = await prisma.supportMessage.create({ data: { conversationId: id, author: "SYSTEM", kind: "NOTE", agentId: agent.id, body: `${shortName(agent.name)} assigned the chat ${what}.${body.note ? ` ${body.note.trim()}` : ""}` }, select: { id: true } });
  await broadcast({ type: "message.created", conversationId: id, messageId: m.id }, { conversation: id });
  await broadcast({ type: "conversation.updated", conversationId: id, fields: ["assignee", "department"] }, { inbox: true, conversation: id, ...(target ? { agent: target.id } : {}) });
  return conversationDetail(agent, id);
}

export async function closeConversation(agent: AgentSession, id: string) {
  const c = await loadFor(agent, id);
  if (c.status !== "CLOSED") {
    const now = new Date();
    await prisma.supportConversation.update({ where: { id }, data: { status: "CLOSED", closedAt: now, closedBy: agent.id, waitingSince: null } });
    await prisma.supportEvent.create({ data: { name: "closed", conversationId: id, agentId: agent.id, at: now } });
    const m = await event(id, `${shortName(agent.name)} closed the chat`);
    await changed(id, ["status"], m.id);
  }
  return conversationDetail(agent, id);
}

export async function reopenConversation(agent: AgentSession, id: string) {
  const c = await loadFor(agent, id);
  if (c.status === "CLOSED") {
    await prisma.supportConversation.update({ where: { id }, data: { status: c.aiActive ? "AI" : "OPEN", assigneeId: c.aiActive ? null : (c.assigneeId ?? agent.id), closedAt: null, closedBy: null } });
    const m = await event(id, "Chat reopened");
    await changed(id, ["status"], m.id);
  }
  return conversationDetail(agent, id);
}

export async function agentTyping(agent: AgentSession, id: string) {
  await loadFor(agent, id);
  await limit(`support:typing:agent:${agent.id}`, SUPPORT_LIMITS.typing);
  await broadcast({ type: "typing", conversationId: id, who: "agent" }, { conversation: id, visitor: id });
}

/** GET /agent/conversations/:id/assist: summary, 3 replies and their guide sources, cached per last message. */
export async function assist(agent: AgentSession, id: string): Promise<Assist> {
  await loadFor(agent, id);
  const c = await prisma.supportConversation.findUniqueOrThrow({ where: { id }, select: { assist: true, assistMessageId: true, language: true, visitor: { select: { businessId: true } } } });
  const rows = await prisma.supportMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, author: true, kind: true, body: true, attachment: { select: { transcript: true } } } });
  const lastId = rows[0]?.id ?? null;
  if (c.assist && c.assistMessageId === lastId) return c.assist as unknown as Assist;
  await limit(`support:agentai:${agent.id}`, SUPPORT_LIMITS.agentAi);
  const transcript = historyFor(rows.reverse());
  const visitorText = transcript.filter((t) => t.from === "visitor").slice(-3).map((t) => t.text).join(" ");
  const [guide, facts] = await Promise.all([searchGuide(visitorText, 4), c.visitor.businessId ? accountFacts(c.visitor.businessId).catch(() => null) : null]);
  let raw;
  try {
    raw = await generateAssist({ transcript, guide, account: facts ? factsContext(facts) : null, language: c.language });
  } catch (error) {
    await logError(error, { source: "support.assist", level: "warn" });
    throw new SupportError(503, "assist_failed", "Suggestions are not available just now. Try again in a minute.");
  }
  const result: Assist = { summary: raw.summary, suggestions: raw.suggestions, sources: pageSources(raw.sources.map((n) => guide[n - 1])) };
  await prisma.supportConversation.update({ where: { id }, data: { assist: result as unknown as Prisma.InputJsonValue, assistMessageId: lastId, summary: raw.summary, summaryAt: new Date() } });
  return result;
}

export async function rewrite(agent: AgentSession, input: { text: string; style: "friendlier" | "formal" | "shorter" | "translate"; lang?: string }) {
  await limit(`support:agentai:${agent.id}`, SUPPORT_LIMITS.agentAi);
  if (input.style === "translate" && !input.lang) throw new SupportError(400, "invalid_request", "Choose the language to translate into.");
  try {
    return { text: await rewriteText(input) };
  } catch (error) {
    await logError(error, { source: "support.rewrite", level: "warn" });
    throw new SupportError(503, "rewrite_failed", "That did not work just now. Try again in a minute.");
  }
}

/** POST /agent/visitors/:visitorId/invite: an agent starts a chat with someone browsing. Their next heartbeat opens it. */
export async function inviteVisitor(agent: AgentSession, visitorId: string, text: string): Promise<{ conversationId: string }> {
  await limit(`support:invite:${agent.id}`, SUPPORT_LIMITS.invite);
  const visitor = await prisma.supportVisitor.findUnique({ where: { id: visitorId }, select: { id: true, optedOut: true, visits: { orderBy: { lastSeenAt: "desc" }, take: 1, select: { id: true, surface: true } } } });
  if (!visitor || !visitor.visits[0]) throw new SupportError(404, "not_found", "This visitor was not found.");
  const open = await prisma.supportConversation.findFirst({ where: { visitorId, status: { not: "CLOSED" } }, select: { id: true } });
  if (open) throw new SupportError(409, "already_chatting", "This visitor already has an open chat. Open it instead.");
  const id = newId();
  const now = new Date();
  await prisma.supportConversation.create({
    data: { id, visitorId, visitId: visitor.visits[0].id, surface: visitor.visits[0].surface, status: "OPEN", aiActive: false, assigneeId: agent.id, handoverAt: now, handoverReason: "agent", firstHumanReplyAt: now, agentReplyCount: 1, topicTokenHash: await sha256Hex(await topicSecret(id)) },
  });
  const m = await prisma.supportMessage.create({ data: { conversationId: id, author: "AGENT", agentId: agent.id, kind: "TEXT", body: text }, select: { id: true } });
  await prisma.supportEvent.create({ data: { name: "conversation_started", conversationId: id, agentId: agent.id } });
  await broadcast({ type: "message.created", conversationId: id, messageId: m.id }, { inbox: true, conversation: id, visitorId });
  return { conversationId: id };
}
