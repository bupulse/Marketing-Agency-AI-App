import "server-only";
import { prisma } from "@/lib/db";
import type { ChannelKind, Prisma } from "@/lib/generated/prisma/client";
import { sendToConversation } from "./send";
import { MAX_TEXT } from "./text";

// The shared inbox (app/dashboard/inbox): conversations from every channel, answered by the team. Every function is
// scoped by businessId, so an id from another company never matches. docs/INBOX.md.

export const PAGE_SIZE = 40;
/** Channels whose platform only allows replies within 24 hours of the person's last message. */
const META_WINDOW_CHANNELS: ChannelKind[] = ["INSTAGRAM", "FACEBOOK", "WHATSAPP"];
/** A teammate's reply keeps automations and the AI quiet in that conversation for this long (unless resumed). */
export const AGENT_PAUSE_HOURS = 12;

export class InboxError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "InboxError";
  }
}

export { CHANNEL_LABELS, INBOX_VIEWS, type InboxView } from "./labels";
import type { InboxView } from "./labels";
export type InboxFilters = { view: InboxView; channel?: ChannelKind | null; q?: string | null };

function whereFor(businessId: string, filters: InboxFilters, actorId: string): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = { businessId };
  if (filters.view === "closed") where.status = "CLOSED";
  else if (filters.view !== "all") where.status = "OPEN";
  if (filters.view === "mine") where.assigneeId = actorId;
  if (filters.view === "unassigned") where.assigneeId = null;
  if (filters.channel) where.channel = filters.channel;
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { contact: { name: { contains: q, mode: "insensitive" } } },
      { contact: { email: { contains: q, mode: "insensitive" } } },
      { contact: { phone: { contains: q } } },
      { preview: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listConversations(businessId: string, filters: InboxFilters, actorId: string, limit = PAGE_SIZE) {
  const rows = await prisma.conversation.findMany({
    where: whereFor(businessId, filters, actorId),
    orderBy: { lastMessageAt: "desc" },
    take: limit + 1,
    select: {
      id: true,
      channel: true,
      status: true,
      unread: true,
      preview: true,
      lastMessageAt: true,
      botPausedUntil: true,
      assigneeId: true,
      assignee: { select: { name: true, email: true } },
      contact: { select: { id: true, name: true, avatarUrl: true, identities: { select: { handle: true, displayName: true }, take: 1 } } },
    },
  });
  return {
    items: rows.slice(0, limit).map((r) => ({
      id: r.id,
      channel: r.channel,
      status: r.status,
      unread: r.unread,
      preview: r.preview ?? "",
      lastMessageAt: r.lastMessageAt.toISOString(),
      botPaused: !!r.botPausedUntil && r.botPausedUntil > new Date(),
      assignee: r.assigneeId ? { id: r.assigneeId, name: r.assignee?.name || r.assignee?.email || "Teammate" } : null,
      contact: { id: r.contact.id, name: displayName(r.contact.name, r.contact.identities[0]), avatarUrl: r.contact.avatarUrl },
    })),
    hasMore: rows.length > limit,
  };
}

export type InboxItem = Awaited<ReturnType<typeof listConversations>>["items"][number];

/** The name to show: the contact's name, else their @handle or channel name, else "Visitor". */
export function displayName(name: string | null | undefined, identity?: { handle: string | null; displayName: string | null } | null): string {
  return name?.trim() || identity?.displayName?.trim() || (identity?.handle ? `@${identity.handle.replace(/^@/, "")}` : "") || "Visitor";
}

export async function viewCounts(businessId: string, actorId: string): Promise<Record<InboxView, number>> {
  const [open, mine, unassigned, unread] = await Promise.all([
    prisma.conversation.count({ where: { businessId, status: "OPEN" } }),
    prisma.conversation.count({ where: { businessId, status: "OPEN", assigneeId: actorId } }),
    prisma.conversation.count({ where: { businessId, status: "OPEN", assigneeId: null } }),
    prisma.conversation.count({ where: { businessId, status: "OPEN", unread: { gt: 0 } } }),
  ]);
  return { open, mine, unassigned, closed: 0, all: unread };
}

/** Open conversations with unread messages: the badge on the sidebar's Inbox. */
export async function unreadCount(businessId: string): Promise<number> {
  return prisma.conversation.count({ where: { businessId, status: "OPEN", unread: { gt: 0 } } });
}

export async function getThread(businessId: string, conversationId: string) {
  const c = await prisma.conversation.findFirst({
    where: { id: conversationId, businessId },
    select: {
      id: true,
      channel: true,
      status: true,
      botPausedUntil: true,
      lastInboundAt: true,
      assigneeId: true,
      connection: { select: { displayName: true } },
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatarUrl: true,
          language: true,
          identities: { select: { channel: true, handle: true, displayName: true } },
          tags: { select: { tag: { select: { name: true } } } },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, direction: true, author: true, kind: true, text: true, payload: true, status: true, error: true, createdAt: true, agentId: true },
      },
    },
  });
  if (!c) return null;
  const identity = c.contact.identities.find((i) => i.channel === c.channel) ?? c.contact.identities[0];
  return {
    id: c.id,
    channel: c.channel,
    status: c.status,
    account: c.connection?.displayName ?? null,
    botPausedUntil: c.botPausedUntil && c.botPausedUntil > new Date() ? c.botPausedUntil.toISOString() : null,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    /** False on Meta channels more than 24 hours after the person's last message: replies are refused then. */
    replyWindowOpen: !META_WINDOW_CHANNELS.includes(c.channel) || (!!c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() <= 24 * 3_600_000),
    assigneeId: c.assigneeId,
    contact: {
      id: c.contact.id,
      name: displayName(c.contact.name, identity),
      email: c.contact.email,
      phone: c.contact.phone,
      handle: identity?.handle ?? null,
      language: c.contact.language,
      tags: c.contact.tags.map((t) => t.tag.name),
    },
    messages: c.messages.reverse().map((m) => ({
      id: m.id,
      direction: m.direction,
      author: m.author,
      kind: m.kind,
      text: m.text,
      buttons: buttonsOf(m.payload),
      status: m.status,
      error: m.error,
      at: m.createdAt.toISOString(),
    })),
  };
}
export type Thread = NonNullable<Awaited<ReturnType<typeof getThread>>>;

function buttonsOf(payload: Prisma.JsonValue | null): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const b = (payload as { buttons?: unknown }).buttons;
  return Array.isArray(b) ? b.map((x) => (x && typeof x === "object" && "title" in x ? String((x as { title: unknown }).title) : "")).filter(Boolean) : [];
}

async function own(businessId: string, conversationId: string) {
  const c = await prisma.conversation.findFirst({ where: { id: conversationId, businessId }, select: { id: true, channel: true } });
  if (!c) throw new InboxError("not_found", "That conversation no longer exists.");
  return c;
}

export async function markRead(businessId: string, conversationId: string): Promise<void> {
  await prisma.conversation.updateMany({ where: { id: conversationId, businessId, unread: { gt: 0 } }, data: { unread: 0 } });
}

/** A teammate answers. Automations and the AI then stay quiet in this conversation for AGENT_PAUSE_HOURS. */
export async function replyAsAgent(businessId: string, conversationId: string, actorId: string, text: string) {
  await own(businessId, conversationId);
  const clean = text.trim().slice(0, MAX_TEXT);
  if (!clean) throw new InboxError("invalid", "Write a message first.");
  const result = await sendToConversation(conversationId, { text: clean }, { author: "AGENT", agentId: actorId });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { botPausedUntil: new Date(Date.now() + AGENT_PAUSE_HOURS * 3_600_000), unread: 0, status: "OPEN", assigneeId: undefined },
  });
  // The person writing becomes the assignee when nobody is.
  await prisma.conversation.updateMany({ where: { id: conversationId, assigneeId: null }, data: { assigneeId: actorId } });
  return result;
}

export async function addNote(businessId: string, conversationId: string, actorId: string, text: string): Promise<void> {
  await own(businessId, conversationId);
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new InboxError("invalid", "Write the note first.");
  await prisma.message.create({ data: { businessId, conversationId, direction: "OUTBOUND", author: "AGENT", agentId: actorId, kind: "NOTE", text: clean, status: "SENT" } });
}

/** Assigns to a teammate of the same company, or to nobody. */
export async function assign(businessId: string, conversationId: string, userId: string | null): Promise<void> {
  await own(businessId, conversationId);
  if (userId) {
    const member = await prisma.membership.findFirst({ where: { businessId, userId }, select: { userId: true } });
    if (!member) throw new InboxError("invalid", "That person is not in your team.");
  }
  await prisma.conversation.update({ where: { id: conversationId }, data: { assigneeId: userId } });
}

export async function setStatus(businessId: string, conversationId: string, status: "OPEN" | "CLOSED"): Promise<void> {
  await own(businessId, conversationId);
  await prisma.conversation.update({ where: { id: conversationId }, data: { status, ...(status === "CLOSED" ? { unread: 0 } : {}) } });
}

/** Pause automations for `hours`, or resume them now (hours = 0). */
export async function setBotPause(businessId: string, conversationId: string, hours: number): Promise<void> {
  await own(businessId, conversationId);
  await prisma.conversation.update({ where: { id: conversationId }, data: { botPausedUntil: hours > 0 ? new Date(Date.now() + hours * 3_600_000) : null } });
  if (hours > 0) {
    // A run waiting in this conversation would answer after the pause: stop it now.
    await prisma.automationRun.updateMany({ where: { conversationId, status: { in: ["RUNNING", "WAITING"] } }, data: { status: "STOPPED", finishedAt: new Date(), waitingFor: null, error: "A teammate took over." } });
  }
}

/** The team members who can be assigned (for the assign menu). */
export async function teamMembers(businessId: string) {
  const rows = await prisma.membership.findMany({ where: { businessId }, select: { userId: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.userId, name: r.user.name || r.user.email }));
}
