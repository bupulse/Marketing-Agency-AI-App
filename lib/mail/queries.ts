import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Addr } from "./addresses";
import type { MailMe } from "./session";

// Reading B Mail for one person. Every query is limited to the mailboxes that person sees (me.mailboxIds).

export const FOLDERS = ["inbox", "starred", "sent", "drafts", "archive", "spam", "trash", "all"] as const;
export type Folder = (typeof FOLDERS)[number];
export const PAGE_SIZE = 50;

export type MailboxNav = { id: string; name: string; address: string | null; kind: string; visibility: string; departmentId: string | null; unread: number; color: string | null };

export async function mailboxesFor(me: MailMe): Promise<MailboxNav[]> {
  if (!me.mailboxIds.length) return [];
  const [boxes, unread, departments] = await Promise.all([
    prisma.mailbox.findMany({ where: { id: { in: me.mailboxIds } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, address: true, kind: true, visibility: true, departmentId: true, memberId: true } }),
    prisma.mailThread.groupBy({ by: ["mailboxId"], where: { mailboxId: { in: me.mailboxIds }, folder: "inbox", unread: true }, _count: { _all: true } }),
    prisma.mailDepartment.findMany({ select: { id: true, color: true } }),
  ]);
  const count = new Map(unread.map((u) => [u.mailboxId, u._count._all]));
  const color = new Map(departments.map((d) => [d.id, d.color]));
  return boxes.map((b) => ({ id: b.id, name: b.name, address: b.address, kind: b.kind, visibility: b.visibility, departmentId: b.departmentId, unread: count.get(b.id) ?? 0, color: b.departmentId ? color.get(b.departmentId) ?? null : null }));
}

export type ListArgs = { box: string | "all"; folder: Folder; q?: string; tag?: string; page?: number };

function where(me: MailMe, a: ListArgs): Prisma.MailThreadWhereInput {
  const boxes = a.box === "all" ? me.mailboxIds : me.mailboxIds.filter((id) => id === a.box);
  const w: Prisma.MailThreadWhereInput = { mailboxId: { in: boxes } };
  switch (a.folder) {
    case "inbox": w.folder = "inbox"; break;
    case "starred": w.starred = true; w.folder = { not: "trash" }; break;
    case "sent": w.hasSent = true; w.folder = { notIn: ["trash", "spam"] }; break;
    case "drafts": w.hasDraft = true; break;
    case "archive": w.folder = "archive"; break;
    case "spam": w.folder = "spam"; break;
    case "trash": w.folder = "trash"; break;
    case "all": w.folder = { notIn: ["trash", "spam"] }; break;
  }
  if (a.tag) w.tags = { has: a.tag };
  const q = (a.q ?? "").trim();
  if (q) {
    const terms = parseSearch(q);
    const and: Prisma.MailThreadWhereInput[] = [];
    if (terms.from) and.push({ messages: { some: { OR: [{ fromAddress: { contains: terms.from, mode: "insensitive" } }, { fromName: { contains: terms.from, mode: "insensitive" } }] } } });
    if (terms.hasAttachment) and.push({ hasAttachment: true });
    if (terms.unread) and.push({ unread: true });
    if (terms.text) and.push({ OR: [{ subject: { contains: terms.text, mode: "insensitive" } }, { messages: { some: { OR: [{ text: { contains: terms.text, mode: "insensitive" } }, { fromName: { contains: terms.text, mode: "insensitive" } }, { fromAddress: { contains: terms.text, mode: "insensitive" } }, { attachments: { some: { filename: { contains: terms.text, mode: "insensitive" } } } }] } } }] });
    if (and.length) w.AND = and;
  }
  return w;
}

/** "from:irembo has:attachment invoice" -> parts. Plain words search subject, text, names and file names. */
export function parseSearch(q: string): { from?: string; hasAttachment?: boolean; unread?: boolean; text?: string } {
  const out: { from?: string; hasAttachment?: boolean; unread?: boolean; text?: string } = {};
  const rest: string[] = [];
  for (const part of q.split(/\s+/).filter(Boolean)) {
    const m = /^(from|has|is):(.+)$/i.exec(part);
    if (m && m[1].toLowerCase() === "from") out.from = m[2];
    else if (m && m[1].toLowerCase() === "has" && /^attach/i.test(m[2])) out.hasAttachment = true;
    else if (m && m[1].toLowerCase() === "is" && /^unread$/i.test(m[2])) out.unread = true;
    else rest.push(part);
  }
  if (rest.length) out.text = rest.join(" ").slice(0, 200);
  return out;
}

export type ThreadRow = {
  id: string; mailboxId: string; subject: string; snippet: string; participants: Addr[]; unread: boolean; starred: boolean; important: boolean;
  hasAttachment: boolean; tags: string[]; messageCount: number; lastMessageAt: Date; copiedFrom: string | null; copyKind: string | null; folder: string; lastFrom: Addr | null;
};

export async function listThreads(me: MailMe, a: ListArgs): Promise<{ rows: ThreadRow[]; total: number }> {
  const w = where(me, a);
  const page = Math.max(1, a.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.mailThread.findMany({
      where: w, orderBy: { lastMessageAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: { id: true, mailboxId: true, subject: true, snippet: true, participants: true, unread: true, starred: true, important: true, hasAttachment: true, tags: true, messageCount: true, lastMessageAt: true, copiedFrom: true, copyKind: true, folder: true,
        messages: { where: { status: { not: "draft" } }, orderBy: { date: "desc" }, take: 1, select: { fromAddress: true, fromName: true, direction: true } } },
    }),
    prisma.mailThread.count({ where: w }),
  ]);
  return {
    total,
    rows: rows.map(({ messages, participants, ...r }) => ({ ...r, participants: (participants as Addr[] | null) ?? [], lastFrom: messages[0] ? { name: messages[0].direction === "out" ? "me" : messages[0].fromName, address: messages[0].fromAddress } : null })),
  };
}

export async function getThread(me: MailMe, id: string) {
  const thread = await prisma.mailThread.findFirst({
    where: { id, mailboxId: { in: me.mailboxIds } },
    include: {
      mailbox: { select: { id: true, name: true, address: true } },
      messages: { orderBy: { date: "asc" }, include: { attachments: { select: { id: true, filename: true, contentType: true, size: true, inline: true, contentId: true } } } },
    },
  });
  if (!thread) return null;
  if (thread.unread) await prisma.mailThread.update({ where: { id }, data: { unread: false } });
  // wasUnread: the page refreshes once so the unread counts in the menu drop.
  return { ...thread, wasUnread: thread.unread };
}

export type ThreadAction = "read" | "unread" | "star" | "unstar" | "archive" | "inbox" | "trash" | "spam" | "notspam" | "important" | "unimportant";

/** Applies an action to threads the person sees. Returns how many changed. */
export async function actOnThreads(me: MailMe, ids: string[], action: ThreadAction): Promise<number> {
  const data: Prisma.MailThreadUpdateManyMutationInput =
    action === "read" ? { unread: false } :
    action === "unread" ? { unread: true } :
    action === "star" ? { starred: true } :
    action === "unstar" ? { starred: false } :
    action === "archive" ? { folder: "archive" } :
    action === "inbox" || action === "notspam" ? { folder: "inbox", trashedAt: null } :
    action === "trash" ? { folder: "trash", trashedAt: new Date() } :
    action === "spam" ? { folder: "spam" } :
    action === "important" ? { important: true } : { important: false };
  const r = await prisma.mailThread.updateMany({ where: { id: { in: ids.slice(0, 200) }, mailboxId: { in: me.mailboxIds } }, data });
  return r.count;
}
