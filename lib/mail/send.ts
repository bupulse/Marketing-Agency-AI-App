import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { isServiceEnabled } from "@/lib/admin/switch";
import { formatPhone } from "@/lib/phone";
import { publicSiteUrl } from "@/lib/auth/site-url";
import type { Prisma } from "@/lib/generated/prisma/client";
import { formatAddress, MAIL_DOMAIN, type Addr } from "./addresses";
import { sendableDepartments } from "./address-book";
import { readDraftMeta, type DraftMeta } from "./draft-rules";
import { findOwnDraft, tidyThread } from "./drafts";
import { escapeHtml, forwardBlock, quoteBlock, textToHtml } from "./html";
import { departmentProblem, fillFirstName, firstNameOf, greetingFor, hasFirstName, PERSONAL_MAX, personalRecipients, type Person } from "./personal";
import { sanitizeComposerHtml } from "./sanitize";
import { makeSnippet } from "./parse";
import { signatureHtmlFor, signatureText, withPhoto } from "./signature-render";
import { photoUrl } from "./photo";
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

/** Sends left today: the daily limit less what went out and what is waiting to go (inside its undo window). */
export async function sendsLeftToday(): Promise<number> {
  const [row, waiting] = await Promise.all([
    prisma.mailSendDay.findUnique({ where: { day: today() } }),
    prisma.mailMessage.count({ where: { status: { in: ["queued", "sending"] } } }),
  ]);
  return Math.max(0, DAILY_LIMIT - (row?.sent ?? 0) - waiting);
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
  /** Departments picked in To (ids, or "everyone"): one personal email per person (docs/MAIL_CRM.md "Departments"). */
  departments?: string[];
  /** The draft being sent: its files go with the message and the draft goes away. */
  draftId?: string | null;
  /** The composer as it was, kept on the first message so Undo can put it back. */
  composer?: DraftMeta;
};

export type QueueResult = { ok: true; messageId: string; threadId: string; sendAt: string; count: number } | { ok: false; error: string };

export async function signatureFor(me: MailMe, fromAddress: string) {
  const [settings, member] = await Promise.all([
    prisma.mailSettings.findUnique({ where: { id: "default" } }),
    me.memberId ? prisma.mailMember.findUnique({ where: { id: me.memberId }, select: { id: true, name: true, title: true, phone: true, prefs: true, photoPath: true } }) : null,
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
  // The person's look (Settings), else the company default (Mail console); their photo when they switched it on.
  const look = typeof prefs.signatureTemplate === "string" ? prefs.signatureTemplate : settings?.defaultTemplate;
  const photo = prefs.photoInSignature === true && member ? photoUrl(member.id, member.photoPath, publicSiteUrl()) : null;
  return { text: signatureText(company, person), html: withPhoto(signatureHtmlFor(look, company, person), photo, person.name) };
}

/**
 * Queues a message: checks the mailbox and recipients, builds the body, files it in its conversation. With departments
 * in To it queues one personal email per person (their own To, "Hello {first_name}," on top), each one of the daily
 * sends. A draft being sent hands over its files and goes away.
 */
export async function queueMessage(me: MailMe, o: Outgoing): Promise<QueueResult> {
  if (!me.mailboxIds.includes(o.fromMailboxId)) return { ok: false, error: "You cannot send from that mailbox." };
  const mailbox = await prisma.mailbox.findUnique({ where: { id: o.fromMailboxId }, select: { id: true, address: true, name: true, kind: true } });
  if (!mailbox?.address) return { ok: false, error: "Pick a mailbox with its own address to send from." };
  const departments = [...new Set(o.departments ?? [])];

  // Who gets what: one email to everyone typed, or one personal email per person.
  let personal: Person[] | null = null;
  if (departments.length) {
    if (o.cc.length || o.bcc.length) return { ok: false, error: "Cc and Bcc cannot be used with a department. Put everyone in To: each person gets their own email." };
    const groups = await sendableDepartments(me);
    const problem = departmentProblem(departments, groups);
    if (problem) return { ok: false, error: problem };
    personal = personalRecipients(departments, o.to, groups, [mailbox.address, me.email]);
    if (!personal.length) return { ok: false, error: "Nobody else is in that department yet." };
    if (personal.length > PERSONAL_MAX) return { ok: false, error: `At most ${PERSONAL_MAX} personal emails in one send.` };
  } else {
    if (!o.to.length && !o.cc.length && !o.bcc.length) return { ok: false, error: "Add at least one recipient." };
    if (o.to.length + o.cc.length + o.bcc.length > 50) return { ok: false, error: "At most 50 recipients in one email." };
  }
  const count = personal ? personal.length : 1;
  const left = await sendsLeftToday();
  if (left < count) {
    return { ok: false, error: left < 1 ? `Today's ${DAILY_LIMIT} free sends are used up. It resets at 02:00 Kigali time.` : `This needs ${count} sends and ${left} are left today. Send to fewer people, or wait until 02:00 Kigali time.` };
  }

  const draft = o.draftId ? await findOwnDraft(me, o.draftId) : null;
  if (o.draftId && !draft) return { ok: false, error: "This draft was already sent or deleted." };
  const parentId = o.parentId ?? (draft ? readDraftMeta(draft.draft)?.parentId : null) ?? null;
  const parent = parentId
    ? await prisma.mailMessage.findFirst({ where: { id: parentId, mailboxId: { in: me.mailboxIds }, status: { not: "draft" } }, include: { attachments: true } })
    : null;
  const forward = o.mode === "forward";
  const sig = await signatureFor(me, mailbox.address);
  const words = o.text.trim();
  const body = o.html && o.html.trim() ? sanitizeComposerHtml(o.html) : textToHtml(words);
  const quote = parent && o.includeQuote !== false
    ? forward
      ? forwardBlock({ date: parent.date, fromName: parent.fromName, fromAddress: parent.fromAddress, subject: parent.subject, to: (parent.to as Addr[]).map(formatAddress).join(", "), text: parent.text })
      : quoteBlock({ date: parent.date, fromName: parent.fromName, fromAddress: parent.fromAddress, text: parent.text })
    : null;
  // Our text first, then the signature, then the earlier message (owner's rule, docs/MAIL_CRM.md).
  const build = (first: string | null, greet: boolean) => {
    const fill = (s: string, html = false) => (first === null ? s : fillFirstName(s, first, { html }));
    const hello = greet && first !== null ? greetingFor(first) : null;
    const text = `${hello ? `${hello}\n\n` : ""}${fill(words)}\n\n${sig.text}${quote ? `\n\n${quote.text}` : ""}`;
    const html = `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#1d1d1f">${hello ? `<p style="margin:0 0 1em">${escapeHtml(hello)}</p>` : ""}${fill(body, true)}<br>${sig.html}${quote ? `<br>${quote.html}` : ""}</div>`;
    return { text, html, subject: fill(o.subject).slice(0, 500), snippet: makeSnippet(`${hello ? `${hello} ` : ""}${fill(words)}`) };
  };
  // {first_name} in an ordinary email: the one person in To, else "everyone".
  const single = hasFirstName(`${o.subject}\n${words}`) ? (o.to.length === 1 ? firstNameOf(o.to[0].name, o.to[0].address) : "everyone") : null;
  const copies = personal
    ? personal.map((p) => ({ to: [{ name: p.name, address: p.address }], cc: [] as Addr[], bcc: [] as Addr[], ...build(p.firstName, true) }))
    : [{ to: o.to, cc: o.cc, bcc: o.bcc, ...build(single, false) }];

  const references = parent && !forward ? replyReferences({ messageId: parent.messageId, references: parent.references }) : [];
  const sendAt = new Date(Date.now() + UNDO_SECONDS * 1000);
  const fromName = mailbox.kind === "personal" ? me.name : `${mailbox.name} · BuPulse`;
  const everyone = copies.flatMap((c) => [...c.to, ...c.cc, ...c.bcc]);
  const files = draft ? draft.attachments : parent && forward ? parent.attachments.filter((a) => !a.inline) : [];
  const fileBytes = files.reduce((n, a) => n + a.size, 0);

  const result = await prisma.$transaction(async (tx) => {
    // A reply joins its conversation; a new message reuses its draft's own thread, or starts one.
    const replyThread = parent && !forward && parent.mailboxId === mailbox.id ? parent.threadId : null;
    const draftThread = !replyThread && draft && draft.mailboxId === mailbox.id && draft.thread.messageCount === 0 ? draft.threadId : null;
    const snippet = copies[0].snippet;
    const thread = replyThread
      ? await tx.mailThread.update({ where: { id: replyThread }, data: { hasSent: true, snippet, lastMessageAt: new Date(), folder: "inbox" } })
      : draftThread
        ? await tx.mailThread.update({ where: { id: draftThread }, data: { subject: o.subject, subjectKey: subjectKey(o.subject), snippet, participants: everyone, folder: "inbox", unread: false, hasSent: true, lastMessageAt: new Date() } })
        : await tx.mailThread.create({ data: { mailboxId: mailbox.id, subject: o.subject, subjectKey: subjectKey(o.subject), snippet, participants: everyone, folder: "inbox", unread: false, hasSent: true, lastMessageAt: new Date() } });
    const row = (c: (typeof copies)[number]) => ({
      threadId: thread.id, mailboxId: mailbox.id, direction: "out", status: "queued", messageId: `${randomUUID()}@${MAIL_DOMAIN}`,
      inReplyTo: parent && !forward ? parent.messageId : null, references,
      fromAddress: mailbox.address!, fromName, to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject,
      text: c.text, html: c.html, snippet: c.snippet, date: new Date(), sendAt, authorEmail: me.email,
    });
    // The first message carries the size (shared files count once) and the composer, for Undo.
    const first = await tx.mailMessage.create({
      data: { ...row(copies[0]), sizeBytes: fileBytes + copies[0].html.length, ...(o.composer ? { draft: o.composer as unknown as Prisma.InputJsonValue } : {}) },
      select: { id: true },
    });
    const rest = copies.length > 1 ? await tx.mailMessage.createManyAndReturn({ data: copies.slice(1).map(row), select: { id: true } }) : [];
    if (draft && files.length) await tx.mailAttachment.updateMany({ where: { messageId: draft.id }, data: { messageId: first.id } });
    const copyTo = draft ? rest : [first, ...rest];
    if (files.length && copyTo.length) {
      await tx.mailAttachment.createMany({ data: copyTo.flatMap((m) => files.map((a) => ({ messageId: m.id, filename: a.filename, contentType: a.contentType, size: a.size, path: a.path }))) });
    }
    if (draft) await tx.mailMessage.delete({ where: { id: draft.id } });
    await tx.mailThread.update({ where: { id: thread.id }, data: { messageCount: { increment: copies.length }, ...(files.length ? { hasAttachment: true } : {}) } });
    if (draft) await tidyThread(tx, draft.threadId);
    return { messageId: first.id, threadId: thread.id };
  }, { timeout: 30_000 });
  return { ok: true, ...result, sendAt: sendAt.toISOString(), count: copies.length };
}

/**
 * Undo inside the window: everything queued by that send (one email, or every personal copy) stops, and the first
 * message goes back to being the draft the composer had open. Returns the draft's id, or null when it was too late.
 */
export async function undoSend(me: MailMe, messageId: string): Promise<string | null> {
  const m = await prisma.mailMessage.findFirst({ where: { id: messageId, status: "queued", sendAt: { gt: new Date() }, mailboxId: { in: me.mailboxIds } }, select: { threadId: true, sendAt: true, authorEmail: true } });
  if (!m?.sendAt) return null;
  const batch = { threadId: m.threadId, sendAt: m.sendAt, authorEmail: m.authorEmail };
  const ids = (await prisma.mailMessage.findMany({ where: { ...batch, status: "queued" }, select: { id: true } })).map((x) => x.id);
  // Claimed in one statement, so a delivery run starting now cannot take any of them.
  const claim = await prisma.mailMessage.updateMany({ where: { id: { in: ids }, status: "queued", sendAt: { gt: new Date() } }, data: { status: "draft", sendAt: null } });
  if (!claim.count) return null;
  return prisma.$transaction(async (tx) => {
    const back = await tx.mailMessage.findMany({ where: { id: { in: ids }, status: "draft" }, orderBy: { createdAt: "asc" }, select: { id: true, draft: true, subject: true } });
    const keep = back.find((b) => b.id === messageId) ?? back[0];
    const others = back.filter((b) => b.id !== keep.id).map((b) => b.id);
    if (others.length) await tx.mailMessage.deleteMany({ where: { id: { in: others } } });
    const meta = readDraftMeta(keep.draft);
    if (meta) {
      const list = (l: string[]) => l.filter((s) => !s.startsWith("dept:") && s.includes("@")).map((address) => ({ name: "", address }));
      await tx.mailMessage.update({ where: { id: keep.id }, data: { to: list(meta.to), cc: list(meta.cc), bcc: list(meta.bcc), subject: meta.subject || keep.subject, html: meta.body, text: meta.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() } });
    }
    const left = await tx.mailMessage.findMany({ where: { threadId: m.threadId, status: { not: "draft" } }, select: { direction: true } });
    await tx.mailThread.update({
      where: { id: m.threadId },
      data: { hasDraft: true, messageCount: left.length, hasSent: left.some((x) => x.direction === "out"), ...(left.length ? {} : { folder: "drafts" }) },
    });
    return keep.id;
  });
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
  for (const [i, { id }] of due.entries()) {
    // Resend's free plan takes about 2 requests a second: department sends queue many at once.
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 550));
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
