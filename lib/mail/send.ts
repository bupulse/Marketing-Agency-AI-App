import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { isServiceEnabled } from "@/lib/admin/switch";
import { formatPhone } from "@/lib/phone";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { formatAddress, MAIL_DOMAIN, type Addr } from "./addresses";
import { forwardBlock, quoteBlock, textToHtml } from "./html";
import { sanitizeComposerHtml } from "./sanitize";
import { makeSnippet } from "./parse";
import { signatureHtml, signatureText } from "./signature-render";
import { getObject } from "./storage";
import { replyReferences, subjectKey } from "./threading";
import type { MailMe } from "./session";

// Sending from B Mail through Resend (docs/MAIL_CRM.md "Sending"). A message is queued with an undo window
// (UNDO_SECONDS), then delivered by deliverDue(): called right after the window by the sending request, and again on
// every page load and by /api/cron/mail-send, so a message is sent even if that request ended early.
// The free plan allows 100 emails a day (MailSendDay counts them, shared with bulk sending later).

export const UNDO_SECONDS = 10;
export const DAILY_LIMIT = Number(process.env.MAIL_DAILY_LIMIT ?? 100);

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export async function sendsLeftToday(): Promise<number> {
  const row = await prisma.mailSendDay.findUnique({ where: { day: today() } });
  return Math.max(0, DAILY_LIMIT - (row?.sent ?? 0));
}

export type Outgoing = {
  fromMailboxId: string;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  text: string;
  /** Formatted body from the composer (cleaned with sanitizeComposerHtml before use). */
  html?: string;
  /** The message being answered or forwarded. */
  parentId?: string | null;
  mode?: "new" | "reply" | "all" | "forward";
  /** Hidden quote/forward block shown under the signature. */
  includeQuote?: boolean;
};

export type QueueResult = { ok: true; messageId: string; threadId: string; sendAt: string } | { ok: false; error: string };

export async function signatureFor(me: MailMe, fromAddress: string) {
  const [settings, member] = await Promise.all([
    prisma.mailSettings.findUnique({ where: { id: "default" } }),
    me.memberId ? prisma.mailMember.findUnique({ where: { id: me.memberId }, select: { name: true, title: true, phone: true, prefs: true } }) : null,
  ]);
  const prefs = (member?.prefs as Record<string, unknown> | null) ?? {};
  const company = {
    website: settings?.website ?? "bupulse.com",
    address: settings?.address ?? "Kigali, Rwanda",
    companyPhone: settings?.companyPhone ? formatPhone(settings.companyPhone) : null,
    linkedinUrl: settings?.linkedinUrl ?? null,
    instagramUrl: settings?.instagramUrl ?? null,
    facebookUrl: settings?.facebookUrl ?? null,
    ctaText: settings?.ctaText ?? "Get your free BuPulse quote",
    ctaUrl: settings?.ctaUrl ?? "https://bupulse.com/quote",
    logoUrl: `${publicSiteUrl()}/brand/logo.png`,
  };
  const person = { name: member?.name || me.name, title: member?.title ?? null, email: fromAddress, mobile: member?.phone ? formatPhone(member.phone) : null, extra: typeof prefs.signatureExtra === "string" ? prefs.signatureExtra : null };
  return { text: signatureText(company, person), html: signatureHtml(company, person) };
}

/** Queues a message: checks the mailbox and recipients, builds the body, files it in its conversation. */
export async function queueMessage(me: MailMe, o: Outgoing): Promise<QueueResult> {
  if (!me.mailboxIds.includes(o.fromMailboxId)) return { ok: false, error: "You cannot send from that mailbox." };
  const mailbox = await prisma.mailbox.findUnique({ where: { id: o.fromMailboxId }, select: { id: true, address: true, name: true, kind: true } });
  if (!mailbox?.address) return { ok: false, error: "Pick a mailbox with its own address to send from." };
  const all = [...o.to, ...o.cc, ...o.bcc];
  if (!o.to.length && !o.cc.length && !o.bcc.length) return { ok: false, error: "Add at least one recipient." };
  if (all.length > 50) return { ok: false, error: "At most 50 recipients in one email." };
  if ((await sendsLeftToday()) < 1) return { ok: false, error: `Today's ${DAILY_LIMIT} free sends are used up. It resets at 02:00 Kigali time.` };

  const parent = o.parentId
    ? await prisma.mailMessage.findFirst({ where: { id: o.parentId, mailboxId: { in: me.mailboxIds } }, include: { attachments: true } })
    : null;
  const sig = await signatureFor(me, mailbox.address);
  // Our text first, then the signature, then the earlier message (owner's rule, docs/MAIL_CRM.md).
  let text = `${o.text.trim()}\n\n${sig.text}`;
  const body = o.html && o.html.trim() ? sanitizeComposerHtml(o.html) : textToHtml(o.text.trim());
  let html = `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#1d1d1f">${body}<br>${sig.html}`;
  if (parent && o.includeQuote !== false) {
    const block = o.mode === "forward"
      ? forwardBlock({ date: parent.date, fromName: parent.fromName, fromAddress: parent.fromAddress, subject: parent.subject, to: (parent.to as Addr[]).map(formatAddress).join(", "), text: parent.text })
      : quoteBlock({ date: parent.date, fromName: parent.fromName, fromAddress: parent.fromAddress, text: parent.text });
    text += `\n\n${block.text}`;
    html += `<br>${block.html}`;
  }
  html += "</div>";

  const messageId = `${randomUUID()}@${MAIL_DOMAIN}`;
  const references = parent && o.mode !== "forward" ? replyReferences({ messageId: parent.messageId, references: parent.references }) : [];
  const sendAt = new Date(Date.now() + UNDO_SECONDS * 1000);
  const fromName = mailbox.kind === "personal" ? me.name : `${mailbox.name} · BuPulse`;
  const snippet = makeSnippet(o.text);

  const result = await prisma.$transaction(async (tx) => {
    const threadId = parent && o.mode !== "forward" && parent.mailboxId === mailbox.id ? parent.threadId : null;
    const thread = threadId
      ? await tx.mailThread.update({ where: { id: threadId }, data: { hasSent: true, snippet, lastMessageAt: new Date(), folder: "inbox" } })
      : await tx.mailThread.create({ data: { mailboxId: mailbox.id, subject: o.subject, subjectKey: subjectKey(o.subject), snippet, participants: all, folder: "inbox", unread: false, hasSent: true, lastMessageAt: new Date() } });
    const msg = await tx.mailMessage.create({
      data: {
        threadId: thread.id, mailboxId: mailbox.id, direction: "out", status: "queued", messageId,
        inReplyTo: parent && o.mode !== "forward" ? parent.messageId : null, references,
        fromAddress: mailbox.address!, fromName, to: o.to, cc: o.cc, bcc: o.bcc, subject: o.subject.slice(0, 500),
        text, html, snippet, date: new Date(), sendAt, authorEmail: me.email,
        // A forward carries the original attachments (same stored files).
        ...(parent && o.mode === "forward" && parent.attachments.length
          ? { attachments: { create: parent.attachments.filter((a) => !a.inline).map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size, path: a.path })) } }
          : {}),
      },
      select: { id: true },
    });
    await tx.mailThread.update({ where: { id: thread.id }, data: { messageCount: { increment: 1 } } });
    return { messageId: msg.id, threadId: thread.id };
  });
  return { ok: true, ...result, sendAt: sendAt.toISOString() };
}

/** Undo inside the window: the message goes back to being a draft. True when it was still waiting. */
export async function undoSend(me: MailMe, messageId: string): Promise<boolean> {
  const r = await prisma.mailMessage.updateMany({ where: { id: messageId, status: "queued", sendAt: { gt: new Date() }, mailboxId: { in: me.mailboxIds } }, data: { status: "draft", sendAt: null } });
  if (r.count) {
    const m = await prisma.mailMessage.findUnique({ where: { id: messageId }, select: { threadId: true } });
    if (m) await prisma.mailThread.update({ where: { id: m.threadId }, data: { hasDraft: true, messageCount: { decrement: 1 } } });
  }
  return r.count > 0;
}

async function resendSend(m: { fromName: string; fromAddress: string; to: Addr[]; cc: Addr[]; bcc: Addr[]; subject: string; html: string | null; text: string; messageId: string | null; inReplyTo: string | null; references: string[]; attachments: { filename: string; path: string; contentType: string }[] }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const attachments = [];
  for (const a of m.attachments) attachments.push({ filename: a.filename, content: Buffer.from(await getObject(a.path)).toString("base64"), content_type: a.contentType });
  const headers: Record<string, string> = {};
  if (m.messageId) headers["Message-ID"] = `<${m.messageId}>`;
  if (m.inReplyTo) headers["In-Reply-To"] = `<${m.inReplyTo}>`;
  if (m.references.length) headers["References"] = m.references.map((r) => `<${r}>`).join(" ");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: formatAddress({ name: m.fromName, address: m.fromAddress }),
      to: m.to.map(formatAddress), cc: m.cc.length ? m.cc.map(formatAddress) : undefined, bcc: m.bcc.length ? m.bcc.map(formatAddress) : undefined,
      subject: m.subject, html: m.html ?? undefined, text: m.text, headers, attachments: attachments.length ? attachments : undefined,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  return (JSON.parse(body) as { id?: string }).id ?? null;
}

/** Sends every queued message whose undo window is over. Each one is claimed first, so two runs never send it twice. */
export async function deliverDue(limit = 20): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  if (!(await isServiceEnabled("resend"))) return { sent, failed };
  const due = await prisma.mailMessage.findMany({ where: { status: "queued", sendAt: { lte: new Date() } }, orderBy: { sendAt: "asc" }, take: limit, select: { id: true } });
  for (const { id } of due) {
    const claim = await prisma.mailMessage.updateMany({ where: { id, status: "queued" }, data: { status: "sending" } });
    if (!claim.count) continue;
    const m = await prisma.mailMessage.findUnique({ where: { id }, include: { attachments: true } });
    if (!m) continue;
    try {
      const providerId = await resendSend({ ...m, to: m.to as Addr[], cc: m.cc as Addr[], bcc: m.bcc as Addr[] });
      await prisma.mailMessage.update({ where: { id }, data: { status: "sent", providerId, date: new Date(), error: null } });
      await prisma.mailSendDay.upsert({ where: { day: today() }, create: { day: today(), sent: 1 }, update: { sent: { increment: 1 } } });
      sent++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      await prisma.mailMessage.update({ where: { id }, data: { status: "failed", error: message.slice(0, 500) } });
      await logError(error, { source: "mail.send", level: "warn", messageId: id });
    }
  }
  return { sent, failed };
}
