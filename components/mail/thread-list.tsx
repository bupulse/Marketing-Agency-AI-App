"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Archive, ChevronLeft, ChevronRight, MailOpen, OctagonAlert, Paperclip, RefreshCw, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { threadAction } from "@/app/mail/(app)/actions";
import { TAG_STYLE } from "./shell";

export type ListRow = {
  id: string; subject: string; snippet: string; unread: boolean; starred: boolean; important: boolean; hasAttachment: boolean;
  tags: string[]; messageCount: number; time: string; who: string; initial: string; source: string | null; forwarded: boolean; copied: string | null;
};

export function ThreadList({ title, subtitle, rows, total, page, pageSize, showSource, base, empty }: { title: string; subtitle: string; rows: ListRow[]; total: number; page: number; pageSize: number; showSource: boolean; base: string; empty: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [pending, start] = useTransition();
  const act = (ids: string[], a: Parameters<typeof threadAction>[1]) => start(async () => { await threadAction(ids, a); setSel(new Set()); router.refresh(); });
  const ids = sel.size ? [...sel] : rows[cursor] ? [rows[cursor].id] : [];

  // Keyboard like Gmail: j/k move, Enter opens, e archive, # trash, s star, x select, Shift+u unread.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey) return;
      const r = rows[cursor];
      if (e.key === "j") setCursor((c) => Math.min(rows.length - 1, c + 1));
      else if (e.key === "k") setCursor((c) => Math.max(0, c - 1));
      else if ((e.key === "Enter" || e.key === "o") && r) router.push(`/mail/t/${r.id}`);
      else if (e.key === "e" && ids.length) act(ids, "archive");
      else if (e.key === "#" && ids.length) act(ids, "trash");
      else if (e.key === "s" && r) act([r.id], r.starred ? "unstar" : "star");
      else if (e.key === "x" && r) setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; });
      else if (e.key === "U" && ids.length) act(ids, "unread");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const pageHref = (p: number) => `${base}${base.includes("?") ? "&" : "?"}page=${p}`;
  const btn = "inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-[#3c3c43] transition hover:bg-black/[0.07] disabled:opacity-40 dark:text-white/80 dark:hover:bg-white/10";

  return (
    <section aria-label={title} className="overflow-hidden rounded-[24px] border border-white/75 bg-white/[0.72] shadow-[0_20px_50px_-30px_rgba(15,23,42,0.4)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(30,30,36,0.72)]">
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <input type="checkbox" aria-label="Select all" checked={!!rows.length && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} className="mx-2 size-[18px] cursor-pointer accent-[#1f5ae6]" />
        {sel.size > 0 ? (
          <>
            <button type="button" aria-label="Archive" disabled={pending} onClick={() => act([...sel], "archive")} className={btn}><Archive className="size-[18px]" /></button>
            <button type="button" aria-label="Report spam" disabled={pending} onClick={() => act([...sel], "spam")} className={btn}><OctagonAlert className="size-[18px]" /></button>
            <button type="button" aria-label="Delete" disabled={pending} onClick={() => act([...sel], "trash")} className={btn}><Trash2 className="size-[18px]" /></button>
            <button type="button" aria-label="Mark as read" disabled={pending} onClick={() => act([...sel], "read")} className={btn}><MailOpen className="size-[18px]" /></button>
            <span className="ml-2 text-[13px] text-muted">{sel.size} selected</span>
          </>
        ) : (
          <button type="button" aria-label="Refresh" onClick={() => router.refresh()} className={btn}><RefreshCw className="size-[18px]" /></button>
        )}
        <span className="flex-1" />
        <span className="text-[12.5px] text-muted">{from}–{to} of {total}</span>
        <Link aria-label="Newer" href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} className={cn(btn, page <= 1 && "pointer-events-none opacity-40")}><ChevronLeft className="size-[18px]" /></Link>
        <Link aria-label="Older" href={pageHref(page + 1)} aria-disabled={to >= total} className={cn(btn, to >= total && "pointer-events-none opacity-40")}><ChevronRight className="size-[18px]" /></Link>
      </div>
      <div className="flex flex-wrap items-baseline gap-3 border-b border-black/[0.08] px-5 pb-3 dark:border-white/10">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
        <span className="text-[13px] text-muted">{subtitle}</span>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
          <p className="text-[17px] font-semibold">All caught up</p>
          <p className="text-[14px] text-muted">{empty}</p>
        </div>
      ) : (
        <ul>
          {rows.map((r, i) => (
            <li key={r.id} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} className={cn("bmail-rise group relative flex h-[50px] items-center gap-1.5 border-b border-black/[0.06] pl-2 pr-3 transition-shadow hover:z-[1] hover:shadow-[inset_1px_0_0_rgba(60,60,67,0.12),inset_-1px_0_0_rgba(60,60,67,0.12),0_2px_6px_-2px_rgba(0,0,0,0.25)] dark:border-white/[0.06]", r.unread ? "bg-white/70 dark:bg-white/[0.06]" : "bg-transparent", (sel.has(r.id) || i === cursor) && "bg-[rgba(31,90,230,0.08)] dark:bg-[rgba(122,162,255,0.12)]")}>
              <input type="checkbox" aria-label={`Select ${r.subject}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="ml-2.5 mr-1 size-[18px] cursor-pointer accent-[#1f5ae6]" />
              <button type="button" aria-label={r.starred ? "Starred" : "Not starred"} onClick={() => act([r.id], r.starred ? "unstar" : "star")} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-black/5"><Star className={cn("size-[18px]", r.starred ? "fill-[#f4b400] text-[#e0a100]" : "text-[#8e8e93]")} /></button>
              <Link href={`/mail/t/${r.id}`} className="flex h-full min-w-0 flex-1 items-center gap-3 text-text">
                <span className={cn("inline-block w-3 text-[#f4b400]", !r.important && "invisible")} aria-label={r.important ? "Important" : undefined}>▸</span>
                <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#5c6bff] text-[13px] font-semibold text-white">{r.initial}</span>
                <span className={cn("w-[160px] shrink-0 truncate text-[14px]", r.unread ? "font-bold" : "font-medium")}>{r.who}{r.messageCount > 1 && <span className="ml-1 font-normal text-muted">{r.messageCount}</span>}</span>
                {showSource && r.source && <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold", r.forwarded ? "bg-[#fff4e5] text-[#8a4b00] dark:bg-[rgba(255,170,60,0.2)] dark:text-[#ffd29a]" : "bg-[rgba(31,90,230,0.1)] text-[#1946b8] dark:bg-[rgba(120,160,255,0.2)] dark:text-[#c7d8ff]")}>{r.forwarded ? "↪ " : ""}{r.source}</span>}
                <span className="min-w-0 flex-1 truncate text-[14px]"><span className={r.unread ? "font-bold" : "font-medium"}>{r.subject}</span><span className="text-muted"> — {r.snippet}</span></span>
                {r.copied && <span className="shrink-0 rounded-md bg-[#e2f5ea] px-2 py-0.5 text-[12px] font-semibold text-[#11633a]">copy from {r.copied}</span>}
                {r.tags.slice(0, 2).map((t) => TAG_STYLE[t] && <span key={t} className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold" style={{ background: `${TAG_STYLE[t].color}1f`, color: TAG_STYLE[t].color }}>{TAG_STYLE[t].label}</span>)}
                {r.hasAttachment && <Paperclip aria-label="Has attachment" className="size-[15px] shrink-0 text-muted" />}
                <span className={cn("w-[72px] shrink-0 text-right text-[12.5px] group-hover:hidden", r.unread ? "font-bold" : "text-muted")}>{r.time}</span>
              </Link>
              <span className="hidden items-center gap-0.5 group-hover:flex">
                <button type="button" aria-label="Archive" onClick={() => act([r.id], "archive")} className={btn}><Archive className="size-[17px]" /></button>
                <button type="button" aria-label="Delete" onClick={() => act([r.id], "trash")} className={btn}><Trash2 className="size-[17px]" /></button>
                <button type="button" aria-label={r.unread ? "Mark as read" : "Mark as unread"} onClick={() => act([r.id], r.unread ? "read" : "unread")} className={btn}><MailOpen className="size-[17px]" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
