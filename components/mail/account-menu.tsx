"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Grid2x2, LogOut, Settings, Shield, UserRound } from "lucide-react";
import { signOutMail } from "@/app/mail/(app)/actions";

// The menu behind the profile picture (owner, 23 Nov 2026): profile and signature, the Mail console for admins, the
// BuPulse account, all services, sign out.
export function AccountMenu({ name, email, initial, isAdmin, role }: { name: string; email: string; initial: string; isAdmin: boolean; role: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const item = "flex h-11 items-center gap-3 rounded-xl px-3 text-[14.5px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]";
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label="Your account" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full bg-[#1f5ae6] text-[15px] font-semibold text-white ring-[3px] ring-white/80 transition hover:ring-white dark:ring-white/20">{initial}</button>
      {open && (
        <div role="menu" className="bmail-pop absolute right-0 top-12 z-50 w-[300px] rounded-[22px] border border-white/80 bg-white/95 p-2 text-text shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c22]/95">
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[#1f5ae6] text-[18px] font-semibold text-white">{initial}</span>
            <span className="flex min-w-0 flex-col"><span className="truncate text-[15px] font-semibold">{name}</span><span className="truncate text-[12.5px] text-muted">{email}</span><span className="text-[12px] font-semibold text-[#1f5ae6]">{role}</span></span>
          </div>
          <div className="h-px bg-black/[0.08] dark:bg-white/10" />
          <Link role="menuitem" href="/mail/settings" onClick={() => setOpen(false)} className={item}><UserRound className="size-[18px]" />Profile and signature</Link>
          <Link role="menuitem" href="/mail/settings#look" onClick={() => setOpen(false)} className={item}><Settings className="size-[18px]" />Look (background, light or dark)</Link>
          {isAdmin && <Link role="menuitem" href="/mail/console" onClick={() => setOpen(false)} className={item}><Shield className="size-[18px]" />Mail console</Link>}
          <a role="menuitem" href="/account" className={item}><UserRound className="size-[18px]" />Manage your BuPulse account</a>
          <a role="menuitem" href="/apps?all=1" className={item}><Grid2x2 className="size-[18px]" />All BuPulse services</a>
          <div className="my-1 h-px bg-black/[0.08] dark:bg-white/10" />
          <form action={signOutMail}><button role="menuitem" className={`${item} w-full cursor-pointer text-[#b42318]`}><LogOut className="size-[18px]" />Sign out</button></form>
        </div>
      )}
    </div>
  );
}
