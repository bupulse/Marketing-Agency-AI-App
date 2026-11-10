"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { CARD, FOCUS } from "./tones";

/** The interactive part of ExpandCard (./expand-card.tsx): the badge arrives already drawn, so pages pass plain data. */
export function ExpandShell({ badge, title, label, summary, aside, children, defaultOpen = false, className }: { badge?: ReactNode; title: ReactNode; label?: string; summary?: ReactNode; aside?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  // null: untouched (hover peeks); true: pinned open; false: closed on purpose (no peek until the mouse leaves).
  const [open, setOpen] = useState<boolean | null>(defaultOpen ? true : null);
  const id = useId();
  return (
    <div className={cn("group/expand relative min-w-0 overflow-hidden", CARD, className)} onMouseLeave={() => open === false && setOpen(null)}>
      <button
        type="button"
        aria-expanded={open === true}
        aria-controls={id}
        onClick={() => setOpen(open !== true)}
        className={cn("flex w-full cursor-pointer items-center gap-3 rounded-[22px] p-4 text-left sm:p-5", FOCUS)}
      >
        {badge}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-bold leading-snug">{title}</span>
          {summary && <span className="text-[13px] leading-snug text-muted">{summary}</span>}
        </span>
        {aside}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-5 shrink-0 text-muted transition-transform duration-300 motion-reduce:transition-none",
            open === true && "rotate-180",
            open === null && "[@media(hover:hover)]:group-hover/expand:rotate-180",
          )}
        />
      </button>
      <div
        id={id}
        role="region"
        aria-label={label}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out focus-within:grid-rows-[1fr] motion-reduce:transition-none",
          open === true ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          open === null && "[@media(hover:hover)]:group-hover/expand:grid-rows-[1fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-line px-4 pb-4 pt-3 sm:px-5 sm:pb-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
