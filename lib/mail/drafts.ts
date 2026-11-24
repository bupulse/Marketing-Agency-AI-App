import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { parseAddressList, type Addr } from "./addresses";
import { longDate, replyOptions, type QuoteSource } from "./compose-rules";
import {
  attachmentProblem, forwardFilePlan, quotaProblem, readDraftMeta, safeContentType, safeFilename,
  type ComposeAttachment, type ComposeInit, type ComposeMode, type DraftMeta,
} from "./draft-rules";
import { textToHtml } from "./html";
import { makeSnippet } from "./parse";
import { sanitizeComposerHtml } from "./sanitize";
import { createUploadSlot, objectSize, pathSafe, removeObjects } from "./storage";
import { subjectKey } from "./threading";
import type { MailMe } from "./session";

// Drafts in B Mail (docs/mail-crm/GAPS.md C1, C3): the composer saves itself a moment after each change; a draft is a
// MailMessage with status "draft" whose `draft` column keeps the composer as it was. A new message's draft lives in its
// own thread (folder "drafts", so it stays out of the Inbox); a reply's draft sits in the conversation it answers.
// Files are uploaded straight to the private "mail" bucket at out/<draftId>/… and listed as MailAttachment rows on the
// draft; sending moves them to the sent message.

export type DraftInput = {
  draftId?: string | null;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  parentId?: string | null;
  mode?: ComposeMode;
};

export type SaveDraftResult = { ok: true; draftId: string; savedAt: string; attachments?: ComposeAttachment[] } | { ok: false; error: string; gone?: boolean };

const GONE = "This draft was sent or deleted.";
const addrs = (list: string[]): Addr[] => parseAddressList(list.filter((s) => !s.startsWith("dept:")).join(", ")).list.slice(0, 200);
const strip = (list: string[]) => list.map((s) => s.trim().slice(0, 320)).filter(Boolean).slice(0, 200);

/** One of this person's own drafts in a mailbox they see, or null. */
export function findOwnDraft(me: MailMe, id: string) {
  return prisma.mailMessage.findFirst({
    where: { id, status: "draft", authorEmail: me.email, mailboxId: { in: me.mailboxIds } },
    include: { attachments: { orderBy: { createdAt: "asc" } }, thread: { select: { id: true, messageCount: true, mailboxId: true } } },
  });
}

const view = (a: { id: string; filename: string; size: number; contentType: string; path: string }, parentPaths: Set<string>): ComposeAttachment => ({
  id: a.id, filename: a.filename, size: a.size, contentType: a.contentType, ...(parentPaths.has(a.path) ? { forwarded: true } : {}),
});

async function parentFor(me: MailMe, id: string | null | undefined) {
  if (!id) return null;
  return prisma.mailMessage.findFirst({ where: { id, mailboxId: { in: me.mailboxIds }, status: { not: "draft" } }, include: { attachments: { where: { inline: false } } } });
}

/** True when nothing else uses the stored file (forward copies and department copies share one). */
async function unusedPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of new Set(paths)) if (p.startsWith("out/") && !(await prisma.mailAttachment.count({ where: { path: p } }))) out.push(p);
  return out;
}

/** After a draft leaves a thread: a thread with nothing else in it goes, otherwise its draft flag is brought up to date. */
export async function tidyThread(tx: Prisma.TransactionClient, threadId: string): Promise<void> {
  const left = await tx.mailMessage.findMany({ where: { threadId }, select: { status: true } });
  if (!left.length) await tx.mailThread.delete({ where: { id: threadId } });
  else await tx.mailThread.update({ where: { id: threadId }, data: { hasDraft: left.some((m) => m.status === "draft") } });
}

/** Saves (or first creates) a draft. Recipients are kept as typed, departments included. */
export async function saveDraft(me: MailMe, input: DraftInput): Promise<SaveDraftResult> {
  if (!me.mailboxIds.includes(input.from)) return { ok: false, error: "You cannot send from that mailbox." };
  const mailbox = await prisma.mailbox.findUnique({ where: { id: input.from }, select: { id: true, address: true, name: true, kind: true } });
  if (!mailbox?.address) return { ok: false, error: "Pick a mailbox with its own address to send from." };
  const existing = input.draftId ? await findOwnDraft(me, input.draftId) : null;
  if (input.draftId && !existing) return { ok: false, error: GONE, gone: true };
  const oldMeta = existing ? readDraftMeta(existing.draft) : null;
  const parentId = existing ? (oldMeta?.parentId ?? null) : (input.parentId ?? null);
  const parent = await parentFor(me, parentId);
  const mode: ComposeMode = parent ? (input.mode && input.mode !== "new" ? input.mode : "reply") : "new";
  const subject = (input.subject ?? "").slice(0, 500);
  const body = sanitizeComposerHtml((input.html ?? "").slice(0, 400_000));
  const text = (input.text ?? "").slice(0, 200_000);
  const meta: DraftMeta = { v: 1, to: strip(input.to), cc: strip(input.cc), bcc: strip(input.bcc), subject, body, parentId: parent?.id ?? null, mode, dropped: oldMeta?.dropped ?? [] };
  const snippet = makeSnippet(text);
  const fromName = mailbox.kind === "personal" ? me.name : `${mailbox.name} · BuPulse`;
  const fields = {
    mailboxId: mailbox.id, fromAddress: mailbox.address, fromName, to: addrs(meta.to), cc: addrs(meta.cc), bcc: addrs(meta.bcc),
    subject, text, html: body, snippet, date: new Date(), draft: meta as unknown as Prisma.InputJsonValue,
  };
  const inParentThread = !!parent && mode !== "forward" && parent.mailboxId === mailbox.id;

  let changedFiles = false;
  const draftId = await prisma.$transaction(async (tx) => {
    let threadId: string;
    if (existing) {
      threadId = existing.threadId;
      const draftOnly = existing.thread.messageCount === 0 && (await tx.mailMessage.count({ where: { threadId, id: { not: existing.id } } })) === 0;
      const wantParent = inParentThread ? parent!.threadId : null;
      if (wantParent && wantParent !== threadId) {
        threadId = wantParent;
      } else if (!wantParent && !draftOnly) {
        threadId = (await tx.mailThread.create({ data: { mailboxId: mailbox.id, subject, subjectKey: subjectKey(subject), snippet, folder: "drafts", unread: false, hasDraft: true, messageCount: 0 } })).id;
      }
      await tx.mailMessage.update({ where: { id: existing.id }, data: { ...fields, threadId } });
      if (threadId !== existing.threadId) await tidyThread(tx, existing.threadId);
    } else {
      threadId = inParentThread
        ? parent!.threadId
        : (await tx.mailThread.create({ data: { mailboxId: mailbox.id, subject, subjectKey: subjectKey(subject), snippet, folder: "drafts", unread: false, hasDraft: true, messageCount: 0 } })).id;
    }
    const msg = existing
      ? { id: existing.id }
      : await tx.mailMessage.create({ data: { ...fields, threadId, direction: "out", status: "draft", authorEmail: me.email }, select: { id: true } });
    // A draft-only thread follows the draft's mailbox, subject and words; a conversation only learns it has a draft.
    const own = await tx.mailThread.findUnique({ where: { id: threadId }, select: { messageCount: true } });
    await tx.mailThread.update({
      where: { id: threadId },
      data: own?.messageCount ? { hasDraft: true } : { hasDraft: true, mailboxId: mailbox.id, subject, subjectKey: subjectKey(subject), snippet, lastMessageAt: new Date(), participants: [...fields.to, ...fields.cc] as unknown as Prisma.InputJsonValue },
    });

    // Forwarding keeps the original files (unless removed); switching to Reply takes them away again.
    if (parent) {
      const files = await tx.mailAttachment.findMany({ where: { messageId: msg.id }, select: { id: true, path: true } });
      const plan = forwardFilePlan(parent.attachments, files, mode, meta.dropped);
      if (plan.add.length) await tx.mailAttachment.createMany({ data: plan.add.map((a) => ({ messageId: msg.id, filename: a.filename, contentType: a.contentType, size: a.size, path: a.path })) });
      if (plan.remove.length) await tx.mailAttachment.deleteMany({ where: { id: { in: plan.remove } } });
      changedFiles = plan.add.length + plan.remove.length > 0;
    }
    const files = await tx.mailAttachment.aggregate({ where: { messageId: msg.id }, _sum: { size: true } });
    await tx.mailMessage.update({ where: { id: msg.id }, data: { sizeBytes: (files._sum.size ?? 0) + body.length } });
    return msg.id;
  });

  if (!changedFiles) return { ok: true, draftId, savedAt: new Date().toISOString() };
  const parentPaths = new Set(parent?.attachments.map((a) => a.path) ?? []);
  const rows = await prisma.mailAttachment.findMany({ where: { messageId: draftId }, orderBy: { createdAt: "asc" } });
  return { ok: true, draftId, savedAt: new Date().toISOString(), attachments: rows.map((a) => view(a, parentPaths)) };
}

/** A draft as the composer opens it: recipients, body, files, and the message it answers with the reply switch. */
export async function loadDraft(me: MailMe, id: string): Promise<ComposeInit | null> {
  const d = await findOwnDraft(me, id);
  if (!d) return null;
  const meta = readDraftMeta(d.draft);
  const parent = await parentFor(me, meta?.parentId);
  const mailbox = await prisma.mailbox.findUnique({ where: { id: d.mailboxId }, select: { address: true } });
  const parentPaths = new Set(parent?.attachments.map((a) => a.path) ?? []);
  const init: ComposeInit = {
    draftId: d.id,
    from: d.mailboxId,
    to: meta?.to ?? (d.to as Addr[]).map((a) => a.address),
    cc: meta?.cc ?? (d.cc as Addr[]).map((a) => a.address),
    bcc: meta?.bcc ?? (d.bcc as Addr[]).map((a) => a.address),
    subject: d.subject,
    // Drafts saved before this column existed (Undo) hold the whole sent text: start from the words only.
    html: meta ? meta.body : textToHtml(d.text.split(/\n-- ?\n|\n\n(?=On .{4,200} wrote:)/)[0].trim()),
    parentId: parent?.id ?? null,
    mode: parent ? (meta?.mode ?? "reply") : "new",
    attachments: d.attachments.map((a) => view(a, parentPaths)),
  };
  if (parent) {
    const source: QuoteSource = { fromName: parent.fromName, fromAddress: parent.fromAddress, replyTo: parent.replyTo, to: parent.to as Addr[], cc: parent.cc as Addr[], subject: parent.subject, direction: parent.direction, dateLong: longDate(parent.date), text: parent.text };
    const options = replyOptions(source, mailbox?.address ?? "");
    init.options = options;
    init.quote = options[init.mode === "new" || !init.mode ? "reply" : init.mode].quote;
    init.parentFiles = parent.attachments.length;
  }
  return init;
}

/** Discard: the draft, its files nobody else uses, and its thread when nothing else is in it. */
export async function discardDraft(me: MailMe, id: string): Promise<boolean> {
  const d = await findOwnDraft(me, id);
  if (!d) return false;
  await prisma.$transaction(async (tx) => {
    await tx.mailMessage.delete({ where: { id: d.id } });
    await tidyThread(tx, d.threadId);
  });
  const gone = await unusedPaths(d.attachments.map((a) => a.path));
  if (gone.length) await removeObjects(gone).catch(() => undefined);
  return true;
}

/** Bytes this person uses: mail that reached their own mailbox, plus everything they sent or are writing. */
export async function storageUsed(me: MailMe): Promise<{ used: number; quotaMb: number }> {
  const [member, own, settings] = await Promise.all([
    me.memberId ? prisma.mailMember.findUnique({ where: { id: me.memberId }, select: { quotaMb: true } }) : null,
    me.memberId ? prisma.mailbox.findFirst({ where: { memberId: me.memberId }, select: { id: true } }) : null,
    prisma.mailSettings.findUnique({ where: { id: "default" }, select: { poolMb: true, defaultQuotaMb: true } }),
  ]);
  const or: Prisma.MailMessageWhereInput[] = [{ authorEmail: me.email, direction: "out" }];
  if (own) or.push({ mailboxId: own.id, direction: "in" });
  const sum = await prisma.mailMessage.aggregate({ where: { OR: or }, _sum: { sizeBytes: true } });
  // The owner (ADMIN_EMAILS) without a member row is limited only by the shared pool.
  return { used: sum._sum.sizeBytes ?? 0, quotaMb: member?.quotaMb ?? (me.isOwner ? settings?.poolMb ?? 1000 : settings?.defaultQuotaMb ?? 250) };
}

export type UploadSlot = { ok: true; path: string; token: string; signedUrl: string } | { ok: false; error: string };

/** Step 1 of attaching: checks the limits and the person's storage, then gives a one-time upload link. */
export async function startAttachment(me: MailMe, draftId: string, file: { filename: string; size: number }): Promise<UploadSlot> {
  const d = await findOwnDraft(me, draftId);
  if (!d) return { ok: false, error: GONE };
  const size = Math.max(0, Math.floor(Number(file.size) || 0));
  const problem = attachmentProblem(d.attachments.map((a) => a.size), size);
  if (problem) return { ok: false, error: problem };
  const { used, quotaMb } = await storageUsed(me);
  const full = quotaProblem(used, quotaMb, size);
  if (full) return { ok: false, error: full };
  const path = `out/${d.id}/${randomUUID().slice(0, 8)}-${pathSafe(file.filename)}`;
  const slot = await createUploadSlot(path);
  return { ok: true, path, ...slot };
}

/** Step 2: the file is in Storage; its real size is checked again and it joins the draft. */
export async function finishAttachment(me: MailMe, draftId: string, f: { path: string; filename: string; contentType: string }): Promise<{ ok: true; attachment: ComposeAttachment } | { ok: false; error: string }> {
  const d = await findOwnDraft(me, draftId);
  if (!d) return { ok: false, error: GONE };
  if (!f.path.startsWith(`out/${d.id}/`) || f.path.includes("..") || d.attachments.some((a) => a.path === f.path)) return { ok: false, error: "That upload does not belong to this draft." };
  const size = await objectSize(f.path);
  if (size === null) return { ok: false, error: "The file did not arrive. Please attach it again." };
  const { used, quotaMb } = await storageUsed(me);
  const problem = attachmentProblem(d.attachments.map((a) => a.size), size) ?? quotaProblem(used, quotaMb, size);
  if (problem) {
    await removeObjects([f.path]).catch(() => undefined);
    return { ok: false, error: problem };
  }
  const row = await prisma.mailAttachment.create({ data: { messageId: d.id, filename: safeFilename(f.filename), contentType: safeContentType(f.contentType), size, path: f.path } });
  await prisma.mailMessage.update({ where: { id: d.id }, data: { sizeBytes: { increment: size } } });
  return { ok: true, attachment: { id: row.id, filename: row.filename, size: row.size, contentType: row.contentType } };
}

/** Removes a file from a draft. A forwarded file is remembered as removed, so the next save does not bring it back. */
export async function removeAttachment(me: MailMe, attachmentId: string): Promise<boolean> {
  const a = await prisma.mailAttachment.findFirst({ where: { id: attachmentId, message: { status: "draft", authorEmail: me.email, mailboxId: { in: me.mailboxIds } } }, include: { message: { select: { id: true, draft: true } } } });
  if (!a) return false;
  await prisma.mailAttachment.delete({ where: { id: a.id } });
  const meta = readDraftMeta(a.message.draft);
  const data: Prisma.MailMessageUpdateInput = { sizeBytes: { decrement: a.size } };
  if (meta && !a.path.startsWith(`out/${a.message.id}/`)) data.draft = { ...meta, dropped: [...new Set([...meta.dropped, a.path])] } as unknown as Prisma.InputJsonValue;
  await prisma.mailMessage.update({ where: { id: a.message.id }, data });
  const gone = await unusedPaths([a.path]);
  if (gone.length) await removeObjects(gone).catch(() => undefined);
  return true;
}
