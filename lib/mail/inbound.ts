import "server-only";
import { prisma } from "@/lib/db";
import { cleanAddress, isOurAddress, routeRecipient, type Addr, type MailboxRef } from "./addresses";
import { parseMime, type ParsedMail } from "./parse";
import { pathSafe, putObject } from "./storage";
import { isImportant, tagsFor, type Tag } from "./tags";
import { pickThread, subjectKey } from "./threading";
import { sha256Hex } from "./signature";

// Receiving one message for one envelope recipient (docs/MAIL_CRM.md "Mail"). The Cloudflare Email Worker calls
// POST /api/mail/inbound once per recipient; that route checks the signature and calls receiveMail.
//
// 1. The recipient picks the mailbox: an extra address (MailAlias), a named mailbox, else the catch-all (or refused when
//    the console says "refuse").
// 2. The raw message and its attachments are stored once, by the SHA-256 of the raw bytes.
// 3. It is filed in a conversation (lib/mail/threading.ts), tagged (lib/mail/tags.ts), spam-checked (sender rules first,
//    then the receiving side's DMARC verdict).
// 4. Copies: copy rules by tag (bank, invoices, payments, receipts into accounting@) and internal forwarders
//    (grace@ -> cyusa@) file the same message in those mailboxes too, marked "copiedFrom". Outside forward targets are
//    returned to the Worker, which forwards through Cloudflare (free, never one of the 100 daily sends).

export type ReceiveResult =
  | { status: "stored"; mailboxId: string; threadId: string; messageId: string; copies: number; forwardTo: string[] }
  | { status: "duplicate"; mailboxId: string; forwardTo: string[] }
  | { status: "refused"; reason: "not_ours" | "catch_all_off" };

type Stored = { rawPath: string; sha: string; attachments: { filename: string; contentType: string; size: number; path: string; contentId: string | null; inline: boolean }[] };

/** The mailbox for a recipient: an extra address first, then routeRecipient. */
export async function mailboxForRecipient(recipient: string): Promise<{ mailbox: MailboxRef & { address: string | null } } | { refused: "not_ours" | "catch_all_off" }> {
  const address = cleanAddress(recipient);
  if (!address || !isOurAddress(address)) return { refused: "not_ours" };
  const alias = await prisma.mailAlias.findUnique({ where: { address }, select: { mailboxId: true } });
  const mailboxes = await prisma.mailbox.findMany({ select: { id: true, address: true, kind: true } });
  if (alias) {
    const m = mailboxes.find((b) => b.id === alias.mailboxId);
    if (m) return { mailbox: m };
  }
  const routed = routeRecipient(address, mailboxes);
  if (!routed) return { refused: "not_ours" };
  if (routed.kind === "catchall") {
    const settings = await prisma.mailSettings.findUnique({ where: { id: "default" }, select: { catchAll: true } });
    if (settings?.catchAll === "refuse") return { refused: "catch_all_off" };
  }
  return { mailbox: routed };
}

async function storeRaw(raw: Uint8Array, parsed: ParsedMail): Promise<Stored> {
  const sha = await sha256Hex(raw);
  const rawPath = `raw/${sha}.eml`;
  await putObject(rawPath, raw, "message/rfc822");
  const attachments: Stored["attachments"] = [];
  for (const [i, a] of parsed.attachments.entries()) {
    const path = `att/${sha}/${i + 1}-${pathSafe(a.filename)}`;
    await putObject(path, a.content, a.contentType);
    attachments.push({ filename: a.filename, contentType: a.contentType, size: a.content.byteLength, path, contentId: a.contentId, inline: a.inline });
  }
  return { rawPath, sha, attachments };
}

/** Outside people on a message: from, to and cc without our own addresses. */
export function outsideParticipants(parsed: Pick<ParsedMail, "from" | "to" | "cc">): Addr[] {
  const out: Addr[] = [];
  for (const a of [parsed.from, ...parsed.to, ...parsed.cc]) if (!isOurAddress(a.address) && !out.some((o) => o.address === a.address)) out.push(a);
  return out;
}

/** "spam" when a rule or the receiving side says so, else "inbox". An "allow" rule wins over everything. */
export async function spamVerdict(fromAddress: string, suspicious: boolean): Promise<"spam" | "inbox"> {
  const domain = `@${fromAddress.slice(fromAddress.lastIndexOf("@") + 1)}`;
  const rules = await prisma.mailSenderRule.findMany({ where: { pattern: { in: [fromAddress, domain] } }, select: { pattern: true, action: true } });
  const exact = rules.find((r) => r.pattern === fromAddress) ?? rules.find((r) => r.pattern === domain);
  if (exact) return exact.action === "spam" ? "spam" : "inbox";
  return suspicious ? "spam" : "inbox";
}

type DeliverOpts = { folder: "inbox" | "spam" | "archive"; tags: Tag[]; important: boolean; copiedFrom?: string; copyKind?: "rule" | "forward" };

/** Files the message in one mailbox. Returns null when that mailbox already has it (same Message-ID). */
async function deliver(mailboxId: string, parsed: ParsedMail, messageId: string, stored: Stored, raw: Uint8Array, opts: DeliverOpts): Promise<{ threadId: string; id: string } | null> {
  const existing = await prisma.mailMessage.findUnique({ where: { mailboxId_messageId: { mailboxId, messageId } }, select: { id: true } });
  if (existing) return null;
  const key = subjectKey(parsed.subject);
  const people = outsideParticipants(parsed);
  const refIds = [...new Set([parsed.inReplyTo, ...parsed.references].filter((x): x is string => !!x))];
  const [headerHits, candidates] = await Promise.all([
    refIds.length ? prisma.mailMessage.findMany({ where: { mailboxId, messageId: { in: refIds } }, select: { threadId: true }, orderBy: { date: "desc" } }) : Promise.resolve([]),
    key ? prisma.mailThread.findMany({ where: { mailboxId, subjectKey: key, lastMessageAt: { gte: new Date(parsed.date.getTime() - 31 * 86_400_000) } }, select: { id: true, subjectKey: true, lastMessageAt: true, participants: true }, take: 20 }) : Promise.resolve([]),
  ]);
  const threadId = pickThread({
    headerMatches: headerHits.map((h) => h.threadId),
    subjectKey: key,
    date: parsed.date,
    participants: people.map((p) => p.address),
    candidates: candidates.map((c) => ({ id: c.id, subjectKey: c.subjectKey, lastMessageAt: c.lastMessageAt, participants: ((c.participants as Addr[] | null) ?? []).map((p) => p.address) })),
  });

  return prisma.$transaction(async (tx) => {
    let thread = threadId ? await tx.mailThread.findUnique({ where: { id: threadId } }) : null;
    if (!thread) {
      thread = await tx.mailThread.create({
        data: {
          mailboxId, subject: parsed.subject, subjectKey: key, snippet: parsed.snippet, participants: people, folder: opts.folder,
          hasAttachment: stored.attachments.some((a) => !a.inline), tags: opts.tags, important: opts.important,
          copiedFrom: opts.copiedFrom ?? null, copyKind: opts.copyKind ?? null, lastMessageAt: parsed.date,
        },
      });
    } else {
      const known = (thread.participants as Addr[] | null) ?? [];
      const merged = [...people, ...known.filter((k) => !people.some((p) => p.address === k.address))].slice(0, 20);
      const newer = parsed.date >= thread.lastMessageAt;
      // A new message brings an archived conversation back to the inbox (trash and spam stay where they are).
      const folder = opts.folder === "spam" ? "spam" : thread.folder === "archive" ? "inbox" : thread.folder;
      thread = await tx.mailThread.update({
        where: { id: thread.id },
        data: {
          participants: merged, unread: true, folder, important: thread.important || opts.important,
          tags: [...new Set([...thread.tags, ...opts.tags])],
          hasAttachment: thread.hasAttachment || stored.attachments.some((a) => !a.inline),
          ...(newer ? { snippet: parsed.snippet, lastMessageAt: parsed.date } : {}),
        },
      });
    }
    const message = await tx.mailMessage.create({
      data: {
        threadId: thread.id, mailboxId, direction: "in", status: "received", messageId,
        inReplyTo: parsed.inReplyTo, references: parsed.references,
        fromAddress: parsed.from.address, fromName: parsed.from.name, to: parsed.to, cc: parsed.cc, replyTo: parsed.replyTo,
        subject: parsed.subject, text: parsed.text, html: parsed.html, snippet: parsed.snippet, date: parsed.date,
        rawPath: stored.rawPath, sizeBytes: raw.byteLength, authResults: parsed.authResults,
        attachments: { create: stored.attachments },
      },
      select: { id: true },
    });
    await tx.mailThread.update({ where: { id: thread.id }, data: { messageCount: { increment: 1 } } });
    return { threadId: thread.id, id: message.id };
  });
}

export async function receiveMail(input: { raw: Uint8Array; recipient: string; receivedAt?: Date }): Promise<ReceiveResult> {
  const target = await mailboxForRecipient(input.recipient);
  if ("refused" in target) return { status: "refused", reason: target.refused };
  const { mailbox } = target;
  const recipient = cleanAddress(input.recipient)!;
  const parsed = await parseMime(input.raw, input.receivedAt ?? new Date());
  const sha = await sha256Hex(input.raw);
  // No Message-ID (rare, broken senders): the raw message's hash stands in, so a retry is still a duplicate.
  const messageId = parsed.messageId ?? `${sha.slice(0, 40)}@no-message-id.bupulse.com`;

  const forwarders = await prisma.mailForwarder.findMany({
    where: { enabled: true, source: { in: [...new Set([recipient, ...(mailbox.address ? [mailbox.address] : [])])] } },
    select: { target: true, external: true, keepCopy: true, verifiedAt: true, source: true },
  });
  const forwardTo = forwarders.filter((f) => f.external && f.verifiedAt).map((f) => f.target);

  const already = await prisma.mailMessage.findUnique({ where: { mailboxId_messageId: { mailboxId: mailbox.id, messageId } }, select: { id: true } });
  if (already) return { status: "duplicate", mailboxId: mailbox.id, forwardTo };

  const tags = tagsFor({ fromAddress: parsed.from.address, fromName: parsed.from.name, subject: parsed.subject, text: parsed.text, mailboxAddress: mailbox.address, attachmentNames: parsed.attachments.map((a) => a.filename) });
  const important = isImportant({ fromAddress: parsed.from.address, fromName: parsed.from.name, subject: parsed.subject, text: parsed.text, mailboxAddress: mailbox.address, attachmentNames: [] }, tags);
  const folder = await spamVerdict(parsed.from.address, parsed.suspicious);
  const stored = await storeRaw(input.raw, parsed);
  // keepCopy off on every rule for this address: the original is archived, nothing is deleted.
  const keep = forwarders.length === 0 || forwarders.some((f) => f.keepCopy);
  const main = await deliver(mailbox.id, parsed, messageId, stored, input.raw, { folder: folder === "spam" ? "spam" : keep ? "inbox" : "archive", tags, important });
  if (!main) return { status: "duplicate", mailboxId: mailbox.id, forwardTo };

  let copies = 0;
  if (folder !== "spam") {
    const source = mailbox.address ?? recipient;
    const rules = tags.length ? await prisma.mailCopyRule.findMany({ where: { enabled: true, tag: { in: tags } }, select: { mailboxId: true } }) : [];
    const targets = new Map<string, DeliverOpts>();
    for (const r of rules) if (r.mailboxId !== mailbox.id) targets.set(r.mailboxId, { folder: "inbox", tags, important, copiedFrom: source, copyKind: "rule" });
    for (const f of forwarders.filter((x) => !x.external)) {
      const t = await mailboxForRecipient(f.target);
      if ("mailbox" in t && t.mailbox.id !== mailbox.id) targets.set(t.mailbox.id, { folder: "inbox", tags, important, copiedFrom: f.source, copyKind: "forward" });
    }
    for (const [mailboxId, opts] of targets) if (await deliver(mailboxId, parsed, messageId, stored, input.raw, opts)) copies++;
  }
  return { status: "stored", mailboxId: mailbox.id, threadId: main.threadId, messageId: main.id, copies, forwardTo: folder === "spam" ? [] : forwardTo };
}
