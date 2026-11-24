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

export type ListArgs = { box: string | "all"; folder: Folder; q?: string; tag?: string; page?: number; only?: string; fwd?: string; label?: string };

/** The filter chips above the list (design "Main"): All, Unread, Important, Has attachment. */
export const ONLY = ["unread", "important", "attachment"] as const;

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
  if (a.label) w.labelIds = { has: a.label };
  if (a.only === "unread") w.unread = true;
  else if (a.only === "important") w.important = true;
  else if (a.only === "attachment") w.hasAttachment = true;
  // "Forwarded to you": mail an admin forwards from someone else's address (MailForwarder, copied in the app).
  if (a.fwd) { w.copyKind = "forward"; w.copiedFrom = a.fwd; }
  const q = (a.q ?? "").trim();
  if (q) {
    const terms = parseSearch(q);
    const and: Prisma.MailThreadWhereInput[] = [];
    // to: an exact address matches the recipients; a bare word ("to:grace") searches like plain text.
    if (terms.to?.includes("@")) and.push({ messages: { some: { to: { array_contains: [{ address: terms.to.toLowerCase() }] } } } });
    else if (terms.to) terms.text = [terms.text, terms.to].filter(Boolean).join(" ");
    if (terms.subject) and.push({ subject: { contains: terms.subject, mode: "insensitive" } });
    if (terms.after) and.push({ lastMessageAt: { gte: terms.after } });
    if (terms.before) and.push({ lastMessageAt: { lt: terms.before } });
    if (terms.from) and.push({ messages: { some: { OR: [{ fromAddress: { contains: terms.from, mode: "insensitive" } }, { fromName: { contains: terms.from, mode: "insensitive" } }] } } });
    if (terms.hasAttachment) and.push({ hasAttachment: true });
    if (terms.unread) and.push({ unread: true });
    if (terms.text) and.push({ OR: [{ subject: { contains: terms.text, mode: "insensitive" } }, { messages: { some: { OR: [{ text: { contains: terms.text, mode: "insensitive" } }, { fromName: { contains: terms.text, mode: "insensitive" } }, { fromAddress: { contains: terms.text, mode: "insensitive" } }, { attachments: { some: { filename: { contains: terms.text, mode: "insensitive" } } } }] } } }] });
    if (and.length) w.AND = and;
  }
  return w;
}

/** "from:irembo has:attachment invoice" -> parts. Plain words search subject, text, names and file names. */
export type SearchTerms = { from?: string; to?: string; subject?: string; after?: Date; before?: Date; hasAttachment?: boolean; unread?: boolean; text?: string };

/** "from:irembo has:attachment invoice" -> parts (also to:, subject:, after:2026-11-01, before:2026-11-20, is:unread). */
export function parseSearch(q: string): SearchTerms {
  const out: SearchTerms = {};
  const rest: string[] = [];
  const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00+02:00`)) ? new Date(`${v}T00:00:00+02:00`) : undefined);
  for (const part of q.match(/(\w+:"[^"]*"|\S+)/g) ?? []) {
    const m = /^(from|to|subject|after|before|has|is):"?([^"]+)"?$/i.exec(part);
    const key = m?.[1].toLowerCase();
    if (m && key === "from") out.from = m[2];
    else if (m && key === "to") out.to = m[2];
    else if (m && key === "subject") out.subject = m[2];
    else if (m && key === "after" && day(m[2])) out.after = day(m[2]);
    else if (m && key === "before" && day(m[2])) out.before = new Date(day(m[2])!.getTime() + 86_400_000);
    else if (m && m[1].toLowerCase() === "has" && /^attach/i.test(m[2])) out.hasAttachment = true;
    else if (m && m[1].toLowerCase() === "is" && /^unread$/i.test(m[2])) out.unread = true;
    else rest.push(part);
  }
  if (rest.length) out.text = rest.join(" ").slice(0, 200);
  return out;
}

export type ThreadRow = {
  id: string; mailboxId: string; subject: string; snippet: string; participants: Addr[]; unread: boolean; starred: boolean; important: boolean;
  hasAttachment: boolean; tags: string[]; labelIds: string[]; messageCount: number; lastMessageAt: Date; copiedFrom: string | null; copyKind: string | null; folder: string; lastFrom: Addr | null;
};

export async function listThreads(me: MailMe, a: ListArgs): Promise<{ rows: ThreadRow[]; total: number }> {
  const w = where(me, a);
  const page = Math.max(1, a.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.mailThread.findMany({
      where: w, orderBy: { lastMessageAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: { id: true, mailboxId: true, subject: true, snippet: true, participants: true, unread: true, starred: true, important: true, hasAttachment: true, tags: true, labelIds: true, messageCount: true, lastMessageAt: true, copiedFrom: true, copyKind: true, folder: true,
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

/** The menu's extra numbers: "Forwarded to you" folders, Drafts count, and storage used in the person's own mailbox. */
export async function navExtras(me: MailMe): Promise<{ forwarded: { address: string; unread: number; total: number }[]; drafts: number; usedBytes: number }> {
  if (!me.mailboxIds.length) return { forwarded: [], drafts: 0, usedBytes: 0 };
  const own = await prisma.mailbox.findFirst({ where: { id: { in: me.mailboxIds }, kind: "personal", address: me.email }, select: { id: true } });
  const [fwd, fwdUnread, drafts, used] = await Promise.all([
    prisma.mailThread.groupBy({ by: ["copiedFrom"], where: { mailboxId: { in: me.mailboxIds }, copyKind: "forward", copiedFrom: { not: null }, folder: { notIn: ["trash", "spam"] } }, _count: { _all: true } }),
    prisma.mailThread.groupBy({ by: ["copiedFrom"], where: { mailboxId: { in: me.mailboxIds }, copyKind: "forward", folder: "inbox", unread: true }, _count: { _all: true } }),
    prisma.mailThread.count({ where: { mailboxId: { in: me.mailboxIds }, hasDraft: true } }),
    own ? prisma.mailMessage.aggregate({ where: { thread: { mailboxId: own.id } }, _sum: { sizeBytes: true } }) : null,
  ]);
  const unread = new Map(fwdUnread.map((u) => [u.copiedFrom, u._count._all]));
  return {
    forwarded: fwd.filter((f) => f.copiedFrom).map((f) => ({ address: f.copiedFrom!, unread: unread.get(f.copiedFrom) ?? 0, total: f._count._all })).sort((a, b) => a.address.localeCompare(b.address)),
    drafts,
    usedBytes: Number(used?._sum.sizeBytes ?? 0),
  };
}

/** Previous / next conversation in the same list as the one open ("1 of 312"), newest first like the list. */
export async function neighbours(me: MailMe, a: ListArgs, current: { id: string; lastMessageAt: Date }): Promise<{ index: number; total: number; newer: string | null; older: string | null }> {
  const w = where(me, a);
  const [newer, older, before, total] = await Promise.all([
    prisma.mailThread.findFirst({ where: { AND: [w, { OR: [{ lastMessageAt: { gt: current.lastMessageAt } }, { lastMessageAt: current.lastMessageAt, id: { gt: current.id } }] }] }, orderBy: [{ lastMessageAt: "asc" }, { id: "asc" }], select: { id: true } }),
    prisma.mailThread.findFirst({ where: { AND: [w, { OR: [{ lastMessageAt: { lt: current.lastMessageAt } }, { lastMessageAt: current.lastMessageAt, id: { lt: current.id } }] }] }, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], select: { id: true } }),
    prisma.mailThread.count({ where: { AND: [w, { OR: [{ lastMessageAt: { gt: current.lastMessageAt } }, { lastMessageAt: current.lastMessageAt, id: { gt: current.id } }] }] } }),
    prisma.mailThread.count({ where: w }),
  ]);
  return { index: before + 1, total, newer: newer?.id ?? null, older: older?.id ?? null };
}
