"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Archive, ChevronLeft, ChevronRight, Ellipsis, MailOpen, OctagonAlert, Paperclip, RefreshCw, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { threadAction } from "@/app/mail/(app)/actions";
import { BMark } from "./brand";
import { TAG_STYLE, useMail } from "./shell";

export type ListRow = {
  id: string; subject: string; snippet: string; unread: boolean; starred: boolean; important: boolean; hasAttachment: boolean;
  tags: string[]; messageCount: number; time: string; who: string; initial: string; source: string | null; forwarded: boolean; copied: string | null;
  /** A team member's photo (signed link), when the sender is one of us. */
  photo?: string | null;
};

const CHIPS = [["", "All"], ["unread", "Unread"], ["important", "Important"], ["attachment", "Has attachment"]] as const;
// Sender initials (design "Main"): one of seven calm colours, the same for the same sender every time.
const PALETTE = ["#11633a", "#7d4c00", "#1946b8", "#0d5f61", "#5131c4", "#b4236b", "#3c3c43"];
export const avatarColor = (who: string) => {
  let h = 0;
  for (const ch of who.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

export function Avatar({ who, initial, photo, size = 30 }: { who: string; initial: string; photo?: string | null; size?: number }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private photo
    return <img src={photo} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: avatarColor(who), fontSize: Math.round(size * 0.43) }}>{initial}</span>;
}

export function ThreadList({ title, subtitle, rows, total, page, pageSize, showSource, base, empty, only }: { title: string; subtitle: string; rows: ListRow[]; total: number; page: number; pageSize: number; showSource: boolean; base: string; empty: string; only: string }) {
  const router = useRouter();
  const { data } = useMail();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
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
      else if ((e.key === "Enter" || e.key === "o") && r) router.push(`/mail/t/${r.id}?${listQuery(base)}`);
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
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !moreRef.current?.contains(e.target as Node)) setMore(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [more]);

  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const withParam = (k: string, v: string | null) => {
    const u = new URL(base, "http://x");
    if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
    if (k !== "page") u.searchParams.delete("page");
    const q = u.searchParams.toString();
    return `/mail${q ? `?${q}` : ""}`;
  };
  const btn = "inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-[#3c3c43] transition hover:bg-black/[0.07] disabled:opacity-40 dark:text-white/80 dark:hover:bg-white/10";
  const menuItem = "flex h-10 w-full cursor-pointer items-center rounded-xl px-3 text-left text-[14px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]";
  const q = listQuery(base);
  const usedPct = Math.min(100, Math.round((data.storage.usedMb / Math.max(1, data.storage.quotaMb)) * 100));
  const quota = data.storage.quotaMb >= 1000 ? `${data.storage.quotaMb / 1000} GB` : `${data.storage.quotaMb} MB`;

  return (
    <section aria-label={title} className="bmail-glass overflow-hidden rounded-[24px]">
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
          <button type="button" aria-label="Refresh" onClick={() => router.refresh()} className={btn}><RefreshCw className={cn("size-[18px]", pending && "animate-spin")} /></button>
        )}
        <div ref={moreRef} className="relative">
          <button type="button" aria-label="More" aria-expanded={more} onClick={() => setMore((v) => !v)} className={btn}><Ellipsis className="size-[18px]" /></button>
          {more && (
            <div role="menu" className="bmail-pop absolute left-0 top-10 z-30 w-[240px] rounded-2xl border border-white/80 bg-white/95 p-1.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c22]/95">
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMore(false); act(rows.filter((r) => r.unread).map((r) => r.id), "read"); }}>Mark all on this page as read</button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMore(false); setSel(new Set(rows.map((r) => r.id))); }}>Select all on this page</button>
              {ids.length > 0 && <>
                <div className="mx-2 my-1 h-px bg-black/10 dark:bg-white/10" />
                <p className="px-3 pb-0.5 pt-1 text-[12px] font-semibold text-muted">Move {sel.size ? `${sel.size} selected` : "this one"} to</p>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMore(false); act(ids, "inbox"); }}>Inbox</button>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMore(false); act(ids, "archive"); }}>Archive</button>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMore(false); act(ids, "spam"); }}>Spam</button>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMore(false); act(ids, "trash"); }}>Trash</button>
                <div className="mx-2 my-1 h-px bg-black/10 dark:bg-white/10" />
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMore(false); act(ids, "important"); }}>Mark as important</button>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMore(false); act(ids, "unimportant"); }}>Mark as not important</button>
              </>}
            </div>
          )}
        </div>
        <span className="flex-1" />
        <span className="text-[12.5px] text-muted">{from}–{to} of {total}</span>
        <Link aria-label="Newer" href={withParam("page", String(Math.max(1, page - 1)))} aria-disabled={page <= 1} className={cn(btn, page <= 1 && "pointer-events-none opacity-40")}><ChevronLeft className="size-[18px]" /></Link>
        <Link aria-label="Older" href={withParam("page", String(page + 1))} aria-disabled={to >= total} className={cn(btn, to >= total && "pointer-events-none opacity-40")}><ChevronRight className="size-[18px]" /></Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/[0.08] px-5 pb-3 dark:border-white/10">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
        <span className="text-[13px] text-muted">{subtitle}</span>
        <span className="flex-1" />
        <span className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {CHIPS.map(([id, name]) => (
            <Link key={id || "all"} href={withParam("only", id || null)} aria-pressed={only === id} className={cn("inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition", only === id ? "bg-[#1f5ae6] text-white" : "bg-black/[0.06] hover:bg-black/[0.1] dark:bg-white/10 dark:hover:bg-white/15")}>{name}</Link>
          ))}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
          <BMark size={76} className="mb-1 text-[#010106] dark:text-white" />
          <p className="text-[17px] font-semibold">All caught up</p>
          <p className="text-[14px] text-muted">{empty}</p>
        </div>
      ) : (
        <ul>
          {rows.map((r, i) => {
            const open = `/mail/t/${r.id}${q ? `?${q}` : ""}`;
            return (
              <li key={r.id} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} className={cn("bmail-rise group relative flex items-center gap-1.5 border-b border-black/[0.06] pl-2 pr-3 transition-shadow hover:z-[1] hover:shadow-[inset_1px_0_0_rgba(60,60,67,0.12),inset_-1px_0_0_rgba(60,60,67,0.12),0_2px_6px_-2px_rgba(0,0,0,0.25)] md:h-[50px] max-md:py-2.5 dark:border-white/[0.06]", r.unread ? "bg-white/70 dark:bg-white/[0.06]" : "bg-transparent", (sel.has(r.id) || i === cursor) && "bg-[rgba(31,90,230,0.08)] dark:bg-[rgba(122,162,255,0.12)]")}>
                <input type="checkbox" aria-label={`Select ${r.subject}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="ml-2.5 mr-1 size-[18px] cursor-pointer accent-[#1f5ae6] max-md:hidden" />
                <button type="button" aria-label={r.starred ? "Starred" : "Not starred"} onClick={() => act([r.id], r.starred ? "unstar" : "star")} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 max-md:hidden"><Star className={cn("size-[18px]", r.starred ? "fill-[#f4b400] text-[#e0a100]" : "text-[#8e8e93]")} /></button>
                {/* Phones: two lines with the blue unread dot (design "MobileInbox"). */}
                <Link href={open} className="flex min-w-0 flex-1 items-start gap-3 text-text md:hidden">
                  <span className={cn("mt-4 size-2.5 shrink-0 rounded-full", r.unread ? "bg-[#1f6bff]" : "bg-transparent")} aria-label={r.unread ? "Unread" : undefined} />
                  <Avatar who={r.who} initial={r.initial} photo={r.photo} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline gap-2"><span className={cn("min-w-0 flex-1 truncate text-[15.5px]", r.unread ? "font-bold" : "font-semibold")}>{r.who}</span>{r.hasAttachment && <Paperclip className="size-[14px] text-muted" />}<span className="shrink-0 text-[13px] text-muted">{r.time}</span></span>
                    <span className={cn("truncate text-[14.5px]", r.unread && "font-semibold")}>{r.subject}</span>
                    <span className="line-clamp-2 text-[14px] leading-snug text-muted">{r.snippet}</span>
                  </span>
                </Link>
                <Link href={open} className="flex h-full min-w-0 flex-1 items-center gap-3 text-text max-md:hidden">
                  <span className={cn("inline-block w-3 text-[#f4b400]", !r.important && "invisible")} title={r.important ? "Important" : undefined}>▸</span>
                  <Avatar who={r.who} initial={r.initial} photo={r.photo} />
                  <span className={cn("w-[160px] shrink-0 truncate text-[14px]", r.unread ? "font-bold" : "font-medium")}>{r.who}{r.messageCount > 1 && <span className="ml-1 font-normal text-muted">{r.messageCount}</span>}</span>
                  {showSource && r.source && <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold", r.forwarded ? "bg-[#fff4e5] text-[#8a4b00] dark:bg-[rgba(255,170,60,0.2)] dark:text-[#ffd29a]" : "bg-[rgba(31,90,230,0.1)] text-[#1946b8] dark:bg-[rgba(120,160,255,0.2)] dark:text-[#c7d8ff]")}>{r.forwarded ? "↪ " : ""}{r.source}</span>}
                  <span className="min-w-0 flex-1 truncate text-[14px]"><span className={r.unread ? "font-bold" : "font-medium"}>{r.subject}</span><span className="text-muted"> — {r.snippet}</span></span>
                  {r.copied && <span className="shrink-0 rounded-md bg-[#e2f5ea] px-2 py-0.5 text-[12px] font-semibold text-[#11633a]">also in {r.copied}</span>}
                  {r.tags.slice(0, 2).map((t) => TAG_STYLE[t] && <span key={t} className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold" style={{ background: `${TAG_STYLE[t].color}1f`, color: TAG_STYLE[t].color }}>{TAG_STYLE[t].label}</span>)}
                  {r.hasAttachment && <Paperclip aria-label="Has attachment" className="size-[15px] shrink-0 text-muted" />}
                  <span className={cn("w-[72px] shrink-0 text-right text-[12.5px] group-hover:hidden", r.unread ? "font-bold" : "text-muted")}>{r.time}</span>
                </Link>
                <span className="hidden items-center gap-0.5 md:group-hover:flex">
                  <button type="button" aria-label="Archive" onClick={() => act([r.id], "archive")} className={btn}><Archive className="size-[17px]" /></button>
                  <button type="button" aria-label="Delete" onClick={() => act([r.id], "trash")} className={btn}><Trash2 className="size-[17px]" /></button>
                  <button type="button" aria-label={r.unread ? "Mark as read" : "Mark as unread"} onClick={() => act([r.id], r.unread ? "read" : "unread")} className={btn}><MailOpen className="size-[17px]" /></button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-2" title={`${data.storage.usedMb} MB of your ${quota}`}>
          <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"><span className={cn("block h-full rounded-full", usedPct > 90 ? "bg-[#d92d20]" : "bg-[#1f5ae6]")} style={{ width: `${Math.max(2, usedPct)}%` }} /></span>
          {data.storage.usedMb < 1 ? "Under 1 MB" : `${Math.round(data.storage.usedMb)} MB`} of {quota} used
        </span>
        <span className="flex-1" />
        <span>{data.sendsLeft} of 100 sends left today</span>
      </div>
    </section>
  );
}

/** The list's own filters, carried into a conversation so Previous / Next walk the same list. */
function listQuery(base: string): string {
  const u = new URL(base, "http://x");
  u.searchParams.delete("page");
  return u.searchParams.toString();
}
