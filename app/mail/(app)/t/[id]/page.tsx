import { notFound } from "next/navigation";
import { ThreadView, type ViewThread } from "@/components/mail/thread-view";
import type { Addr } from "@/lib/mail/addresses";
import { FOLDERS, getThread, mailboxesFor, neighbours, ONLY, type Folder } from "@/lib/mail/queries";
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
  const folder = (FOLDERS as readonly string[]).includes(sp.folder ?? "") ? (sp.folder as Folder) : sp.q || sp.tag || sp.fwd ? "all" : thread.folder === "inbox" ? "inbox" : (FOLDERS as readonly string[]).includes(thread.folder) ? (thread.folder as Folder) : "all";
  const box = sp.box && me.mailboxIds.includes(sp.box) ? sp.box : "all";
  const only = (ONLY as readonly string[]).includes(sp.only ?? "") ? sp.only : undefined;
  const fwd = sp.fwd && /^[^\s@]+@[^\s@]+$/.test(sp.fwd) ? sp.fwd.toLowerCase() : undefined;
  const near = await neighbours(me, { box, folder, q: sp.q, tag: sp.tag, only, fwd }, { id: thread.id, lastMessageAt: thread.lastMessageAt });
  const query = new URLSearchParams(Object.entries({ box: box === "all" ? "" : box, folder: sp.folder ?? "", q: sp.q ?? "", tag: sp.tag ?? "", only: only ?? "", fwd: fwd ?? "" }).filter(([, v]) => v)).toString();
  const messages = thread.messages.filter((m) => m.status !== "draft");
  const view: ViewThread = {
    id: thread.id, subject: thread.subject, mailboxId: thread.mailboxId, mailboxAddress: thread.mailbox.address, mailboxName: thread.mailbox.name,
    starred: thread.starred, tags: thread.tags, copiedFrom: thread.copiedFrom, copyKind: thread.copyKind, folder: thread.folder,
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
  return <ThreadView refreshOnOpen={thread.wasUnread} thread={view} nav={{ ...near, query }} ourAddresses={boxes.map((b) => (b.address ?? "").toLowerCase()).filter(Boolean)} />;
}
