"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { Archive, FolderInput, Inbox, MailOpen, Mic, Pencil, Reply, Search, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMail } from "./shell";

// The phone screens (design "MobileInbox", "MobileThread"): iOS-style large title, mailbox tabs, swipe actions on rows,
// and a floating bottom bar. Only on phones (md:hidden); computers keep the Gmail-style layout.

export function PhoneListHeader({ title, unread }: { title: string; unread: number }) {
  const { data } = useMail();
  const sp = useSearchParams();
  const box = sp.get("box");
  const fwd = sp.get("fwd");
  const tab = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold";
  return (
    <div className="px-4 pb-2 pt-3 md:hidden">
      <h1 className="text-[32px] font-bold leading-tight tracking-[-0.03em]">{title}</h1>
      <p className="text-[13.5px] text-muted">{unread} unread · updated just now</p>
      <div role="tablist" aria-label="Mailboxes" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <Link role="tab" aria-selected={!box && !fwd} href="/mail" className={cn(tab, !box && !fwd ? "bg-[#1f5ae6] text-white" : "bg-black/[0.06] dark:bg-white/10")}>All</Link>
        {data.mailboxes.map((m) => (
          <Link key={m.id} role="tab" aria-selected={box === m.id} href={`/mail?box=${m.id}`} className={cn(tab, box === m.id ? "bg-[#1f5ae6] text-white" : "bg-black/[0.06] dark:bg-white/10")}>
            <span aria-hidden className="size-2 rounded-full" style={{ background: m.color ?? (m.kind === "personal" ? "#2f6bff" : "#8e8e93") }} />{m.name}
          </Link>
        ))}
        {data.forwarded.map((f) => (
          <Link key={f.address} role="tab" aria-selected={fwd === f.address} href={`/mail?folder=all&fwd=${encodeURIComponent(f.address)}`} className={cn(tab, fwd === f.address ? "bg-[#1f5ae6] text-white" : "bg-[#fff4e5] text-[#8a4b00] dark:bg-[rgba(255,170,60,0.2)] dark:text-[#ffd29a]")}>↪ {f.address.split("@")[0].replace(/^./, (c) => c.toUpperCase())}</Link>
        ))}
      </div>
    </div>
  );
}

/** A row you can swipe left on a phone to show More, Star and Archive (like Apple Mail). */
export function SwipeRow({ children, starred, unread, onStar, onArchive, onRead }: { children: ReactNode; starred: boolean; unread: boolean; onStar: () => void; onArchive: () => void; onRead: () => void }) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; dir: "h" | "v" | null } | null>(null);
  const OPEN = -210;
  const act = (f: () => void) => () => { setX(0); f(); };
  return (
    <div className="relative w-full overflow-hidden md:contents">
      <div aria-hidden={x === 0} className="absolute inset-y-0 right-0 flex md:hidden">
        <button type="button" onClick={act(onRead)} className="flex w-[70px] flex-col items-center justify-center gap-1 bg-[#1f6bff] text-[12px] font-semibold text-white"><MailOpen className="size-5" />{unread ? "Read" : "Unread"}</button>
        <button type="button" onClick={act(onStar)} className="flex w-[70px] flex-col items-center justify-center gap-1 bg-[#f59e0b] text-[12px] font-semibold text-white"><Star className="size-5" />{starred ? "Unstar" : "Star"}</button>
        <button type="button" onClick={act(onArchive)} className="flex w-[70px] flex-col items-center justify-center gap-1 bg-[#7b5cff] text-[12px] font-semibold text-white"><Archive className="size-5" />Archive</button>
      </div>
      <div
        className="relative touch-pan-y bg-[rgba(var(--bmail-rgb,255,255,255),0.96)] transition-transform duration-200 md:contents dark:bg-[#1c1c22]"
        style={{ transform: x ? `translateX(${x}px)` : undefined, transitionDuration: dragging ? "0ms" : undefined }}
        onPointerDown={(e) => { if (e.pointerType === "mouse") return; start.current = { x: e.clientX, y: e.clientY, base: x, dir: null }; }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.x, dy = e.clientY - s.y;
          if (!s.dir) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; s.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v"; }
          if (s.dir === "h") { setDragging(true); setX(Math.max(OPEN - 30, Math.min(0, s.base + dx))); }
        }}
        onPointerUp={() => { const s = start.current; start.current = null; setDragging(false); if (s?.dir === "h") setX((v) => (v < OPEN / 2 ? OPEN : 0)); }}
        onPointerCancel={() => { start.current = null; setDragging(false); setX(0); }}
        onClickCapture={(e) => { if (x !== 0) { e.preventDefault(); e.stopPropagation(); setX(0); } }}
      >
        {children}
      </div>
    </div>
  );
}

type SpeechCtor = new () => { lang: string; interimResults: boolean; onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null; onend: (() => void) | null; start: () => void };

/** The floating bar at the bottom of a phone: Mailboxes, Search (with dictation where the phone offers it), Compose. */
export function PhoneBottomBar() {
  const { openMenu, compose } = useMail();
  const router = useRouter();
  const sp = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const speech = typeof window !== "undefined" ? ((window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition) : undefined;
  const dictate = () => {
    if (!speech) return;
    const r = new speech();
    r.lang = "en-RW";
    r.interimResults = false;
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript ?? ""; if (input.current) input.current.value = t; if (t) router.push(`/mail?q=${encodeURIComponent(t)}`); };
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };
  const glass = "border border-white/80 bg-[rgba(var(--bmail-rgb,255,255,255),0.82)] shadow-[0_14px_40px_-16px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(40,40,46,0.82)]";
  return (
    <div className="bmail-noprint fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex items-center gap-2 md:hidden">
      <button type="button" aria-label="Mailboxes" onClick={openMenu} className={cn("inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full", glass)}><Inbox className="size-5" /></button>
      <form action="/mail" className={cn("flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full pl-4 pr-1.5", glass)}>
        <Search className="size-[18px] shrink-0 text-muted" aria-hidden />
        <label htmlFor="phone-q" className="sr-only">Search</label>
        <input ref={input} id="phone-q" type="search" name="q" defaultValue={sp.get("q") ?? ""} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" />
        {speech && <button type="button" aria-label="Search by voice" onClick={dictate} className={cn("inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full", listening && "bg-[#ff3b30] text-white")}><Mic className="size-[18px]" /></button>}
      </form>
      <button type="button" aria-label="Compose" onClick={() => compose({})} className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#1f5ae6] text-white shadow-[0_14px_30px_-12px_rgba(31,90,230,0.9)]"><Pencil className="size-5" /></button>
    </div>
  );
}

/** The phone email screen's bottom bar (design "MobileThread"): Trash, Move, Archive, Reply, Compose. */
export function PhoneThreadBar({ onTrash, onArchive, onReply, onMove }: { onTrash: () => void; onArchive: () => void; onReply: () => void; onMove: (to: "inbox" | "spam" | "archive") => void }) {
  const { compose } = useMail();
  const [move, setMove] = useState(false);
  const b = "inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-[#1f5ae6] dark:text-[#8fb4ff]";
  return (
    <div className="bmail-noprint fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[45] md:hidden">
      {move && (
        <div role="menu" className="bmail-pop mb-2 rounded-2xl border border-white/80 bg-white/95 p-1.5 shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c22]/95">
          {(["inbox", "archive", "spam"] as const).map((to) => <button key={to} type="button" role="menuitem" onClick={() => { setMove(false); onMove(to); }} className="flex h-11 w-full cursor-pointer items-center rounded-xl px-4 text-left text-[15px] capitalize hover:bg-black/5 dark:hover:bg-white/10">Move to {to}</button>)}
        </div>
      )}
      <div className="flex items-center justify-around rounded-full border border-white/80 bg-[rgba(var(--bmail-rgb,255,255,255),0.85)] px-2 py-1 shadow-[0_14px_40px_-16px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(40,40,46,0.85)]">
        <button type="button" aria-label="Move to trash" onClick={onTrash} className={b}><Trash2 className="size-[21px]" /></button>
        <button type="button" aria-label="Move to folder" aria-expanded={move} onClick={() => setMove((v) => !v)} className={b}><FolderInput className="size-[21px]" /></button>
        <button type="button" aria-label="Archive" onClick={onArchive} className={b}><Archive className="size-[21px]" /></button>
        <button type="button" aria-label="Reply" onClick={onReply} className={b}><Reply className="size-[21px]" /></button>
        <button type="button" aria-label="Compose" onClick={() => compose({})} className={b}><Pencil className="size-[21px]" /></button>
      </div>
    </div>
  );
}
