import { notFound, redirect } from "next/navigation";
import { loadDraft } from "@/lib/mail/drafts";
import { ThreadView, type ViewThread } from "@/components/mail/thread-view";
import type { Addr } from "@/lib/mail/addresses";
import { FOLDERS, getThread, listThreads, mailboxesFor, neighbours, ONLY, type Folder } from "@/lib/mail/queries";
import { SplitFrame } from "@/components/mail/split-frame";
import { displayName } from "@/lib/mail/addresses";
import { requireMail } from "@/lib/mail/session";

export const metadata = { title: "Conversation" };

const KIGALI = { timeZone: "Africa/Kigali" } as const;
const short = (d: Date) => d.toLocaleString("en-GB", { ...KIGALI, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const long = (d: Date) => d.toLocaleString("en-GB", { ...KIGALI, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const names = (list: Addr[]) => list.map((a) => a.name || a.address).join(", ");

export default async function MailThreadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireMail();
  const { id } = await params;
  const sp = await searchParams;
  const [thread, boxes] = await Promise.all([getThread(me, id), mailboxesFor(me)]);
  if (!thread) notFound();
  // The list it was opened from (same filters), for "1 of N" and previous / next.
  const folder = (FOLDERS as readonly string[]).includes(sp.folder ?? "") ? (sp.folder as Folder) : sp.q || sp.tag || sp.fwd || sp.label ? "all" : thread.folder === "inbox" ? "inbox" : (FOLDERS as readonly string[]).includes(thread.folder) ? (thread.folder as Folder) : "all";
  const box = sp.box && me.mailboxIds.includes(sp.box) ? sp.box : "all";
  const only = (ONLY as readonly string[]).includes(sp.only ?? "") ? sp.only : undefined;
  const label = sp.label && /^[\w-]{3,40}$/.test(sp.label) ? sp.label : undefined;
  const fwd = sp.fwd && /^[^\s@]+@[^\s@]+$/.test(sp.fwd) ? sp.fwd.toLowerCase() : undefined;
  const args = { box, folder, q: sp.q, tag: sp.tag, only, fwd, label };
  const [near, list] = await Promise.all([neighbours(me, args, { id: thread.id, lastMessageAt: thread.lastMessageAt }), listThreads(me, { ...args, page: 1 })]);
  const rows = list.rows.map((r) => {
    const who = r.lastFrom ? (r.lastFrom.name === "me" ? "me" : displayName(r.lastFrom)) : r.participants[0] ? displayName(r.participants[0]) : "(nobody)";
    return { id: r.id, who, initial: (who[0] ?? "?").toUpperCase(), subject: r.subject || "(no subject)", snippet: r.snippet, time: short(r.lastMessageAt).split(",")[0], unread: r.unread && r.id !== thread.id, hasAttachment: r.hasAttachment };
  });
  const query = new URLSearchParams(Object.entries({ box: box === "all" ? "" : box, folder: sp.folder ?? "", q: sp.q ?? "", tag: sp.tag ?? "", only: only ?? "", fwd: fwd ?? "", label: label ?? "" }).filter(([, v]) => v)).toString();
  const messages = thread.messages.filter((m) => m.status !== "draft");
  // Drafts (docs/mail-crm/GAPS.md C3): a new message's draft opens in the composer over the Drafts folder; a reply
  // draft opens in this conversation's reply box.
  const ownDraft = thread.messages.find((m) => m.status === "draft" && m.authorEmail === me.email);
  if (!messages.length) {
    if (ownDraft) redirect(`/mail?folder=drafts&draft=${ownDraft.id}`);
    notFound();
  }
  const draft = ownDraft ? await loadDraft(me, ownDraft.id) : null;
  const view: ViewThread = {
    id: thread.id, subject: thread.subject, mailboxId: thread.mailboxId, mailboxAddress: thread.mailbox.address, mailboxName: thread.mailbox.name,
    starred: thread.starred, tags: thread.tags, labelIds: thread.labelIds, copiedFrom: thread.copiedFrom, copyKind: thread.copyKind, folder: thread.folder,
    messages: messages.map((m) => {
      const to = (m.to as Addr[] | null) ?? [];
      const cc = (m.cc as Addr[] | null) ?? [];
      return {
        id: m.id, direction: m.direction, status: m.status, fromName: m.fromName, fromAddress: m.fromAddress, replyTo: m.replyTo,
        to, cc, toLine: names(to) || "(nobody)", ccLine: names(cc), date: short(m.date), dateLong: long(m.date), subject: m.subject,
        text: m.text, html: m.html, snippet: m.snippet, error: m.error,
        attachments: m.attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.contentType, size: a.size, inline: a.inline, contentId: a.contentId })),
      };
    }),
  };
  return (
    <SplitFrame rows={rows} current={thread.id} query={query} title={folder === "inbox" ? "Inbox" : folder.charAt(0).toUpperCase() + folder.slice(1)}>
      <ThreadView refreshOnOpen={thread.wasUnread} thread={view} nav={{ ...near, query }} draft={draft} ourAddresses={boxes.map((b) => (b.address ?? "").toLowerCase()).filter(Boolean)} />
    </SplitFrame>
  );
}
