"use client";

import { Briefcase, Check, ChevronDown, LayoutGrid, Megaphone } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// The service switcher in the Marketing top bar (docs/HOSTS.md): the services the person has (Marketing, ticked here;
// Agency in phase 2) and "All services", the chooser on bupulse.com. The support app's look: a rounded panel with a
// gradient tile per service. Every link leaves this host, so they are plain <a> (never a prefetched Next Link).

export type SwitcherProps = { chooser: string; agencyPicked: boolean };

export function ServiceSwitcher({ chooser, agencyPicked }: SwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label="Switch BuPulse service. Now: Marketing"
        className="glass inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-[14px] max-sm:w-11 max-sm:px-0 font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30"
      >
        <LayoutGrid aria-hidden className="size-[18px] text-pulse-blue" />
        <span className="hidden sm:inline">Marketing</span>
        <ChevronDown aria-hidden className={cn("size-4 text-muted transition-transform max-sm:hidden", open && "rotate-180")} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="BuPulse services"
          className="animate-pop absolute right-0 top-[calc(100%+8px)] z-40 flex w-72 overflow-hidden max-w-[calc(100vw-32px)] flex-col gap-1 rounded-[22px] border border-line bg-surface p-2 shadow-[0_24px_60px_-30px_rgba(17,24,39,0.45)]"
        >
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-[22px] bg-brand-gradient" />
          <p className="px-3 pb-1 pt-2 text-[11px] font-bold tracking-[0.06em] text-muted">YOUR SERVICES</p>
          <div role="menuitemradio" aria-checked="true" aria-disabled="true" className="flex min-h-12 items-center gap-3 rounded-2xl bg-pulse-blue/[0.07] px-2.5 py-2 dark:bg-pulse-blue/15">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(140deg,#2f6bff_0%,#5b4dff_55%,#9b5cff_100%)] text-white shadow-[0_8px_18px_-10px_rgba(47,107,255,0.9)]">
              <Megaphone aria-hidden className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold">Marketing</span>
              <span className="text-[12px] text-muted">You are here</span>
            </span>
            <Check aria-hidden className="size-4 text-pulse-blue" strokeWidth={3} />
          </div>
          <div role="menuitem" aria-disabled="true" className="flex min-h-12 items-center gap-3 rounded-2xl px-2.5 py-2 opacity-80">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-soft text-muted">
              <Briefcase aria-hidden className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold">Agency</span>
              <span className="text-[12px] text-muted">{agencyPicked ? "Coming soon. You are on the list" : "Coming soon"}</span>
            </span>
          </div>
          <div className="my-1 h-px bg-line" />
          <a
            href={chooser}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold text-pulse-blue no-underline hover:bg-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30"
          >
            <LayoutGrid aria-hidden className="size-4" /> All services
          </a>
        </div>
      )}
    </div>
  );
}
