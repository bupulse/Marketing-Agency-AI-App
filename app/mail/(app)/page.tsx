import { ThreadList, type ListRow } from "@/components/mail/thread-list";
import { FOLDERS, listThreads, mailboxesFor, ONLY, PAGE_SIZE, type Folder } from "@/lib/mail/queries";
import { requireMail } from "@/lib/mail/session";
import { TAG_LABEL, type Tag } from "@/lib/mail/tags";
import { displayName } from "@/lib/mail/addresses";

export const metadata = { title: "Inbox" };

const FOLDER_TITLE: Record<Folder, string> = { inbox: "Inbox", starred: "Starred", sent: "Sent", drafts: "Drafts", archive: "Archive", spam: "Spam", trash: "Trash", all: "All mail" };

function when(d: Date): string {
  const now = new Date();
  const opts = { timeZone: "Africa/Kigali" } as const;
  if (d.toLocaleDateString("en-GB", opts) === now.toLocaleDateString("en-GB", opts)) return d.toLocaleTimeString("en-GB", { ...opts, hour: "2-digit", minute: "2-digit" });
  const y = new Date(now.getTime() - 86_400_000);
  if (d.toLocaleDateString("en-GB", opts) === y.toLocaleDateString("en-GB", opts)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { ...opts, day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export default async function MailListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireMail();
  const sp = await searchParams;
  const folder = (FOLDERS as readonly string[]).includes(sp.folder ?? "") ? (sp.folder as Folder) : "inbox";
  const box = sp.box && me.mailboxIds.includes(sp.box) ? sp.box : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const only = (ONLY as readonly string[]).includes(sp.only ?? "") ? sp.only! : "";
  const fwd = sp.fwd && /^[^\s@]+@[^\s@]+$/.test(sp.fwd) ? sp.fwd.toLowerCase() : undefined;
  const [{ rows, total }, boxes] = await Promise.all([listThreads(me, { box, folder: fwd ? "all" : folder, q: sp.q, tag: sp.tag, page, only, fwd }), mailboxesFor(me)]);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const mbox = box === "all" ? null : byId.get(box);
  const title = fwd ? `Forwarded from ${fwd.split("@")[0].replace(/^./, (c) => c.toUpperCase())}` : sp.q ? `Search: ${sp.q}` : sp.tag ? TAG_LABEL[sp.tag as Tag] ?? "Tag" : folder !== "inbox" ? FOLDER_TITLE[folder] : mbox ? mbox.name : "All inboxes";
  const subtitle = fwd ? `Mail sent to ${fwd}, forwarded to you` : mbox ? `${mbox.address ?? "every other @bupulse.com address"}${mbox.visibility === "everyone" ? " · everyone sees it" : ""}` : `${boxes.length} mailbox${boxes.length === 1 ? "" : "es"}`;
  const list: ListRow[] = rows.map((r) => {
    const who = r.lastFrom ? (r.lastFrom.name === "me" ? "me" : displayName(r.lastFrom)) : r.participants[0] ? displayName(r.participants[0]) : "(nobody)";
    const b = byId.get(r.mailboxId);
    return {
      id: r.id, subject: r.subject || "(no subject)", snippet: r.snippet, unread: r.unread, starred: r.starred, important: r.important, hasAttachment: r.hasAttachment,
      tags: r.tags, messageCount: r.messageCount, time: when(r.lastMessageAt), who, initial: (who[0] ?? "?").toUpperCase(),
      source: r.copyKind === "forward" ? (r.copiedFrom?.split("@")[0] ?? null) + "@" : b?.address ? `${b.address.split("@")[0]}@` : b?.name ?? null,
      forwarded: r.copyKind === "forward",
      copied: r.copyKind === "rule" ? r.copiedFrom?.split("@")[0] + "@" : null,
    };
  });
  const base = `/mail?${new URLSearchParams(Object.entries({ box: box === "all" ? "" : box, folder: folder === "inbox" ? "" : folder, q: sp.q ?? "", tag: sp.tag ?? "", only, fwd: fwd ?? "" }).filter(([, v]) => v)).toString()}`;
  return <ThreadList title={title} subtitle={subtitle} rows={list} total={total} page={page} pageSize={PAGE_SIZE} showSource={box === "all"} base={base} empty={sp.q ? "Nothing matches this search." : only ? "Nothing matches this filter." : "Nothing new here."} only={only} />;
}
