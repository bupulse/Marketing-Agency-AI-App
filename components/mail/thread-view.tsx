"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Archive, ArrowLeft, ChevronLeft, ChevronRight, Eye, Forward, MailOpen, Maximize2, Menu, Minimize2, OctagonAlert, Printer, Reply, ReplyAll, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { safeEmailDocument } from "@/lib/mail/html";
import { threadAction } from "@/app/mail/(app)/actions";
import { replyOptions, type ReplyMode } from "@/lib/mail/compose-rules";
import type { ComposeMode } from "@/lib/mail/draft-rules";
import { AttachmentCards } from "./attachment-viewer";
import { Composer, type ComposeInit, type ComposerHandle } from "./composer";
import { TAG_STYLE, useMail } from "./shell";
import { Avatar } from "./thread-list";

export type ViewAttachment = { id: string; filename: string; contentType: string; size: number; inline: boolean; contentId: string | null };
export type ViewMessage = {
  id: string; direction: string; status: string; fromName: string; fromAddress: string; toLine: string; ccLine: string; replyTo: string | null;
  to: { name: string; address: string }[]; cc: { name: string; address: string }[];
  date: string; dateLong: string; subject: string; text: string; html: string | null; snippet: string; attachments: ViewAttachment[]; error: string | null;
};
export type ViewThread = { id: string; subject: string; mailboxId: string; mailboxAddress: string | null; mailboxName: string; starred: boolean; tags: string[]; copiedFrom: string | null; copyKind: string | null; folder: string; messages: ViewMessage[] };

/** Splits a plain-text email at the quoted earlier message ("On … wrote:" or "> " lines). */
function splitQuote(text: string): [string, string] {
  const lines = text.split("\n");
  const i = lines.findIndex((l, n) => /^on .{4,200} wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*(original|forwarded) message/i.test(l.trim()) || (l.startsWith(">") && n > 0 && lines.slice(n).every((x) => !x.trim() || x.startsWith(">"))));
  return i > 0 ? [lines.slice(0, i).join("\n").trimEnd(), lines.slice(i).join("\n")] : [text, ""];
}

/** The reading mode kept in this browser (full screen or in the frame); a private window simply starts in the frame. */
const readMode = {
  get: () => { try { return localStorage.getItem("bmail-read") === "full"; } catch { return false; } },
  set: (v: boolean) => { try { localStorage.setItem("bmail-read", v ? "full" : "split"); } catch { /* private window */ } window.dispatchEvent(new Event("bmail-read")); },
  subscribe: (cb: () => void) => { window.addEventListener("bmail-read", cb); window.addEventListener("storage", cb); return () => { window.removeEventListener("bmail-read", cb); window.removeEventListener("storage", cb); }; },
};

/** Where this conversation sits in the list it was opened from ("1 of 312", previous / next). */
export type ThreadNav = { index: number; total: number; newer: string | null; older: string | null; query: string };

export function ThreadView({ thread, ourAddresses, refreshOnOpen = false, nav, draft }: { thread: ViewThread; ourAddresses: string[]; refreshOnOpen?: boolean; nav?: ThreadNav; draft?: ComposeInit | null }) {
  const router = useRouter();
  const { openMenu } = useMail();
  // Full screen reading (owner, 23 Nov 2026): 10px margins, Return, a button for the menu, a comfortable text width.
  const full = useSyncExternalStore(readMode.subscribe, readMode.get, () => false);
  const setFullMode = readMode.set;
  const back = `/mail${nav?.query ? `?${nav.query}` : ""}`;
  const go = (id: string | null | undefined) => id && router.push(`/mail/t/${id}${nav?.query ? `?${nav.query}` : ""}`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey) return;
      if (e.key === "k" && nav?.newer) go(nav.newer);
      else if (e.key === "j" && nav?.older) go(nav.older);
      else if (e.key === "Escape" && full) setFullMode(false);
      else if (e.key === "u") router.push(back);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (refreshOnOpen) router.refresh();
  }, [refreshOnOpen, router]);
  const [olderOpen, setOlderOpen] = useState(thread.messages.length <= 3);
  const [open, setOpen] = useState<Set<string>>(new Set([thread.messages.at(-1)?.id ?? ""]));
  // A reply draft of this person's in this conversation opens in the reply box (docs/mail-crm/GAPS.md C3).
  const [reply, setReply] = useState<ComposeInit | null>(draft ?? null);
  const [replyMode, setReplyMode] = useState<ComposeMode | null>(draft?.mode ?? null);
  const replyBox = useRef<ComposerHandle>(null);
  const [pending, start] = useTransition();
  const last = thread.messages.at(-1)!;
  const act = (a: Parameters<typeof threadAction>[1], leave = true) => start(async () => { await threadAction([thread.id], a); if (leave) router.push(nav?.older ? `/mail/t/${nav.older}${nav.query ? `?${nav.query}` : ""}` : back); else router.refresh(); });

  const startReply = (m: ViewMessage, mode: ReplyMode) => {
    // Already answering this message: Reply / Reply all / Forward switch the open box and keep what was typed.
    if (reply && reply.parentId === m.id && replyBox.current) {
      replyBox.current.switchMode(mode);
      return;
    }
    const options = replyOptions({ ...m, subject: m.subject || thread.subject }, thread.mailboxAddress ?? "");
    const o = options[mode];
    setReply({ from: thread.mailboxId, to: o.to, cc: o.cc, subject: o.subject, parentId: m.id, mode, quote: o.quote, options, parentFiles: m.attachments.filter((a) => !a.inline).length });
    setReplyMode(mode);
    setTimeout(() => document.getElementById("bmail-reply")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const hiddenCount = olderOpen ? 0 : Math.max(0, thread.messages.length - 2);
  const shown = olderOpen ? thread.messages : [thread.messages[0], ...thread.messages.slice(-1)].filter((m, i, a) => a.indexOf(m) === i);
  const ib = "inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-[#3c3c43] transition hover:bg-black/[0.07] disabled:opacity-40 dark:text-white/80 dark:hover:bg-white/10";

  return (
    <article aria-label="Conversation" className={cn("bmail-pop bmail-glass bmail-print overflow-hidden rounded-[24px] [--bmail-a:var(--bmail-strong)]", full && "fixed inset-[10px] z-40 overflow-y-auto")}>
      <div className="bmail-noprint h-[3px] overflow-hidden"><div className="h-full w-1/4 bg-gradient-to-r from-[#2f6bff] to-[#7b5cff]" style={{ animation: "bmail-line 1.1s ease-in-out 2 both" }} /></div>
      <div className="bmail-noprint sticky top-0 z-10 flex items-center gap-0.5 px-3 py-1.5">
        {full ? (
          <>
            <button type="button" aria-label="Menu" onClick={openMenu} className={ib}><Menu className="size-5" /></button>
            <button type="button" onClick={() => setFullMode(false)} className="mr-1 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full pl-2.5 pr-4 text-[14px] font-semibold hover:bg-black/[0.07] dark:hover:bg-white/10"><ArrowLeft className="size-5" />Return</button>
          </>
        ) : (
          <Link href={back} aria-label="Back to the list" className={ib}><ArrowLeft className="size-5" /></Link>
        )}
        <button type="button" aria-label="Archive (e)" disabled={pending} onClick={() => act("archive")} className={ib}><Archive className="size-[19px]" /></button>
        <button type="button" aria-label="Report spam" disabled={pending} onClick={() => act(thread.folder === "spam" ? "notspam" : "spam")} className={ib}><OctagonAlert className="size-[19px]" /></button>
        <button type="button" aria-label="Delete" disabled={pending} onClick={() => act("trash")} className={ib}><Trash2 className="size-[19px]" /></button>
        <button type="button" aria-label="Mark as unread" disabled={pending} onClick={() => act("unread")} className={ib}><MailOpen className="size-[19px]" /></button>
        <button type="button" aria-label={thread.starred ? "Unstar" : "Star"} disabled={pending} onClick={() => act(thread.starred ? "unstar" : "star", false)} className={ib}><Star className={cn("size-[19px]", thread.starred && "fill-[#f4b400] text-[#e0a100]")} /></button>
        <span className="flex-1" />
        {nav && nav.total > 0 && <span className="mr-1 text-[12.5px] text-muted max-sm:hidden">{nav.index} of {nav.total}</span>}
        {nav && <button type="button" aria-label="Newer (k)" disabled={!nav.newer} onClick={() => go(nav.newer)} className={ib}><ChevronLeft className="size-5" /></button>}
        {nav && <button type="button" aria-label="Older (j)" disabled={!nav.older} onClick={() => go(nav.older)} className={ib}><ChevronRight className="size-5" /></button>}
        <button type="button" aria-label="Print" onClick={() => window.print()} className={cn(ib, "max-sm:hidden")}><Printer className="size-[19px]" /></button>
        <button type="button" aria-label={full ? "Leave full screen" : "Open full screen"} onClick={() => setFullMode(!full)} className={cn(ib, "max-sm:hidden")}>{full ? <Minimize2 className="size-[19px]" /> : <Maximize2 className="size-[19px]" />}</button>
      </div>
      <div className={cn(full && "mx-auto w-full max-w-[860px]")}>

      <div className="flex flex-wrap items-center gap-2.5 px-6 pb-2 pt-1 md:pl-[76px]">
        <h1 className="text-[23px] font-semibold tracking-[-0.015em]">{thread.subject || "(no subject)"}</h1>
        {thread.tags.map((t) => TAG_STYLE[t] && <span key={t} className="rounded-md px-2 py-0.5 text-[12px] font-semibold" style={{ background: `${TAG_STYLE[t].color}1f`, color: TAG_STYLE[t].color }}>{TAG_STYLE[t].label}</span>)}
        <span className="rounded-md bg-[rgba(31,90,230,0.1)] px-2 py-0.5 text-[12px] font-semibold text-[#1946b8] dark:text-[#c7d8ff]">{thread.mailboxAddress ? `${thread.mailboxAddress.split("@")[0]}@` : thread.mailboxName}</span>
        {thread.copiedFrom && <span className="rounded-md bg-[#e2f5ea] px-2 py-0.5 text-[12px] font-semibold text-[#11633a]">{thread.copyKind === "forward" ? "Forwarded from" : "Copy from"} {thread.copiedFrom}</span>}
      </div>

      {shown.map((m, i) => (
        <div key={m.id}>
          {i === 1 && hiddenCount > 0 && (
            <div className="relative my-2 h-[34px]">
              <span aria-hidden className="absolute inset-x-0 top-4 border-t border-black/10 dark:border-white/10" />
              <span aria-hidden className="absolute inset-x-0 top-[19px] border-t border-black/10 dark:border-white/10" />
              <button type="button" onClick={() => setOlderOpen(true)} aria-label={`Show ${hiddenCount} older messages`} className="absolute left-6 top-0 inline-flex size-[34px] cursor-pointer items-center justify-center rounded-full border border-black/15 bg-white text-[12.5px] font-bold text-[#3c3c43] dark:bg-[#26262c] dark:text-white">{hiddenCount}</button>
            </div>
          )}
          <MessageBlock m={m} open={open.has(m.id) || m.id === last.id} onToggle={() => setOpen((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} onReply={(mode) => startReply(m, mode)} isLast={m.id === last.id} ours={ourAddresses} />
        </div>
      ))}

      <div id="bmail-reply" className="flex flex-col gap-3 px-5 pb-6 pt-2 md:pl-[70px]">
        <div className="flex flex-wrap gap-2.5">
          {([["reply", "Reply", Reply], ["all", "Reply all", ReplyAll], ["forward", "Forward", Forward]] as const).map(([mode, label, Icon]) => {
            const on = !!reply && reply.parentId === last.id && replyMode === mode;
            return (
              <button key={mode} type="button" aria-pressed={on} onClick={() => startReply(last, mode)} className={cn("inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-5 text-[14px] font-medium transition-colors", on ? "border-[#1d1d1f] bg-[#1d1d1f] text-white dark:border-white dark:bg-white dark:text-[#1d1d1f]" : "border-black/20 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10")}><Icon className="size-[17px]" />{label}</button>
            );
          })}
        </div>
        {reply && <Composer key={`reply-${reply.parentId}`} ref={replyBox} init={reply} inline onModeChange={setReplyMode} onClose={() => { setReply(null); setReplyMode(null); }} />}
      </div>

      </div>
    </article>
  );
}

function MessageBlock({ m, open, onToggle, onReply, isLast, ours }: { m: ViewMessage; open: boolean; onToggle: () => void; onReply: (mode: "reply" | "all" | "forward") => void; isLast: boolean; ours: string[] }) {
  const [images, setImages] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const files = m.attachments.filter((a) => !a.inline);
  const fromUs = ours.includes(m.fromAddress.toLowerCase());
  const doc = useMemo(() => {
    if (!m.html) return null;
    let html = m.html;
    for (const a of m.attachments) if (a.contentId) html = html.split(`cid:${a.contentId}`).join(`/api/mail/attachments/${a.id}`);
    return safeEmailDocument(html, { allowRemote: images });
  }, [m.html, m.attachments, images]);
  const hasRemote = !!m.html && /<img[^>]+src=["']?https?:/i.test(m.html);
  const [body, quote] = splitQuote(m.text);

  if (!open) {
    return (
      <button type="button" onClick={onToggle} className="flex w-full cursor-pointer items-center gap-3 border-t border-black/[0.07] px-5 py-3 text-left hover:bg-black/[0.03] dark:border-white/[0.07] dark:hover:bg-white/[0.04]">
        <Avatar who={m.fromName || m.fromAddress} initial={(m.fromName || m.fromAddress)[0]?.toUpperCase() ?? "?"} size={34} />
        <span className="w-[170px] shrink-0 truncate text-[14px] font-bold">{fromUs ? "me" : m.fromName || m.fromAddress}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] text-muted">{m.snippet}</span>
        <span className="text-[12.5px] text-muted">{m.date}</span>
      </button>
    );
  }
  return (
    <div className="flex gap-3.5 border-t border-black/[0.07] px-5 pb-3 pt-4 dark:border-white/[0.07]">
      <Avatar who={m.fromName || m.fromAddress} initial={(m.fromName || m.fromAddress)[0]?.toUpperCase() ?? "?"} size={40} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start gap-2">
          <button type="button" onClick={isLast ? undefined : onToggle} className={cn("flex min-w-0 flex-1 flex-col text-left", !isLast && "cursor-pointer")}>
            <span className="text-[14.5px]"><strong>{m.fromName || m.fromAddress}</strong> <span className="text-[13px] text-muted">&lt;{m.fromAddress}&gt;</span></span>
            <span className="truncate text-[12.5px] text-muted">to {m.toLine}{m.ccLine ? ` · cc ${m.ccLine}` : ""}</span>
          </button>
          <span className="pt-0.5 text-[12.5px] text-muted">{m.date}</span>
          <button type="button" aria-label="Reply" onClick={() => onReply("reply")} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"><Reply className="size-[18px]" /></button>
        </div>
        {m.status === "queued" && <p className="rounded-xl bg-[#eef3ff] px-3 py-2 text-[13px] text-[#1f4fc7]">Sending in a few seconds…</p>}
        {m.status === "failed" && <p className="rounded-xl bg-[#fdecec] px-3 py-2 text-[13px] text-[#b42318]">Not sent: {m.error ?? "the mail service refused it"}.</p>}
        {doc ? (
          <>
            {hasRemote && !images && <button type="button" onClick={() => setImages(true)} className="flex w-fit cursor-pointer items-center gap-2 rounded-xl bg-black/[0.05] px-3 py-2 text-[13px] dark:bg-white/[0.07]"><Eye className="size-4" />Pictures from the internet are hidden to protect your privacy. Show them</button>}
            <iframe ref={frame} title={`Message from ${m.fromName || m.fromAddress}`} srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" onLoad={() => { const d = frame.current?.contentDocument; if (frame.current && d) frame.current.style.height = `${d.documentElement.scrollHeight + 8}px`; }} className="min-h-[60px] w-full rounded-md bg-white" />
          </>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.7]">
            {body}
            {quote && (
              <div className="mt-2">
                <button type="button" onClick={() => setShowQuote((v) => !v)} aria-expanded={showQuote} aria-label={showQuote ? "Hide the earlier message" : "Show the earlier message"} className="inline-flex h-[18px] w-[34px] cursor-pointer items-center justify-center rounded-md bg-[#e8eaef] text-[14px] font-extrabold leading-none tracking-[1px] text-[#3c3c43] hover:bg-[#dcdfe6]">···</button>
                {showQuote && <div className="bmail-rise mt-2 border-l-2 border-[#d1d5db] pl-3 text-[14px] text-[#3c3c43] dark:text-white/70">{quote}</div>}
              </div>
            )}
          </div>
        )}
        {files.length > 0 && <AttachmentCards files={files} message={m} onForward={() => onReply("forward")} />}
      </div>
    </div>
  );
}
