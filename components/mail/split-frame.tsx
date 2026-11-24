"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "./thread-list";

// The split reading layout (design "ReadSplit"): the list beside the open email on wide screens. The choice is kept in
// this browser; on phones and narrow windows the email always has the whole width.

export type SplitRow = { id: string; who: string; initial: string; subject: string; snippet: string; time: string; unread: boolean; hasAttachment: boolean; photo?: string | null };

export const splitMode = {
  get: () => { try { return localStorage.getItem("bmail-split") === "on"; } catch { return false; } },
  set: (v: boolean) => { try { localStorage.setItem("bmail-split", v ? "on" : "off"); } catch { /* private window */ } window.dispatchEvent(new Event("bmail-split")); },
  subscribe: (cb: () => void) => { window.addEventListener("bmail-split", cb); window.addEventListener("storage", cb); return () => { window.removeEventListener("bmail-split", cb); window.removeEventListener("storage", cb); }; },
};

export function SplitFrame({ rows, current, query, title, children }: { rows: SplitRow[]; current: string; query: string; title: string; children: ReactNode }) {
  const split = useSyncExternalStore(splitMode.subscribe, splitMode.get, () => false);
  if (!split) return <>{children}</>;
  return (
    <div className="flex items-start gap-2">
      <aside aria-label={title} className="bmail-glass sticky top-2 hidden max-h-[calc(100dvh-90px)] w-[380px] shrink-0 overflow-y-auto rounded-[24px] lg:block">
        <h2 className="sticky top-0 z-[1] border-b border-black/[0.08] bg-[rgba(var(--bmail-rgb,255,255,255),var(--bmail-strong))] px-5 py-3 text-[15px] font-semibold backdrop-blur-xl dark:border-white/10 dark:bg-[rgba(30,30,36,var(--bmail-strong))]">{title}</h2>
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/mail/t/${r.id}${query ? `?${query}` : ""}`} aria-current={r.id === current ? "page" : undefined} className={cn("flex gap-3 border-b border-black/[0.06] px-4 py-3 text-text transition-colors hover:bg-black/[0.03] dark:border-white/[0.06] dark:hover:bg-white/[0.04]", r.id === current && "bg-[rgba(31,90,230,0.1)] dark:bg-[rgba(122,162,255,0.16)]", r.unread && r.id !== current && "bg-white/60 dark:bg-white/[0.05]")}>
                <Avatar who={r.who} initial={r.initial} photo={r.photo} size={34} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-baseline gap-2"><span className={cn("min-w-0 flex-1 truncate text-[14px]", r.unread ? "font-bold" : "font-semibold")}>{r.who}</span>{r.hasAttachment && <Paperclip className="size-[13px] text-muted" />}<span className="shrink-0 text-[12px] text-muted">{r.time}</span></span>
                  <span className={cn("truncate text-[13.5px]", r.unread && "font-semibold")}>{r.subject}</span>
                  <span className="truncate text-[13px] text-muted">{r.snippet}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
