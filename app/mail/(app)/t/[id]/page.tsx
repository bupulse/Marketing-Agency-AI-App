import { notFound } from "next/navigation";
import { ThreadView, type ViewThread } from "@/components/mail/thread-view";
import type { Addr } from "@/lib/mail/addresses";
import { getThread, mailboxesFor } from "@/lib/mail/queries";
import { requireMail } from "@/lib/mail/session";

export const metadata = { title: "Conversation" };

const KIGALI = { timeZone: "Africa/Kigali" } as const;
const short = (d: Date) => d.toLocaleString("en-GB", { ...KIGALI, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const long = (d: Date) => d.toLocaleString("en-GB", { ...KIGALI, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const names = (list: Addr[]) => list.map((a) => a.name || a.address).join(", ");

export default async function MailThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMail();
  const { id } = await params;
  const [thread, boxes] = await Promise.all([getThread(me, id), mailboxesFor(me)]);
  if (!thread) notFound();
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
  return <ThreadView refreshOnOpen={thread.wasUnread} thread={view} ourAddresses={boxes.map((b) => (b.address ?? "").toLowerCase()).filter(Boolean)} />;
}
