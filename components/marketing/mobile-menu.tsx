"use client";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { buttonClasses } from "@/components/ui";
import { accountLinks } from "./account-menu";

type MobileMenuProps = { links: { label: string; href: string }[]; email?: string | null };

/** Disclosure menu for small screens: a real button controls a panel of links. */
export function MobileMenu({ links, email = null }: MobileMenuProps) {
  // Remember the page the menu was opened on, so navigating away closes it without an effect.
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) =>
    setOpenOn((cur) => ((typeof next === "function" ? next(cur === pathname) : next) ? pathname : null));
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="glass inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-text"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="glass-strong animate-pop absolute inset-x-0 top-full mt-2 flex flex-col gap-1 rounded-3xl p-3"
      >
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={close}
            className="flex min-h-11 items-center rounded-2xl px-4 text-base font-medium text-text no-underline hover:bg-soft"
          >
            {l.label}
          </Link>
        ))}
        {email ? (
          <div className="mt-2 flex flex-col gap-1 border-t border-line pt-3">
            <p className="truncate px-4 pb-1 text-xs text-muted">{email}</p>
            {accountLinks.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={close}
                className="flex min-h-11 items-center gap-2.5 rounded-2xl px-4 text-base font-medium text-text no-underline hover:bg-soft"
              >
                <Icon aria-hidden className="size-4" /> {label}
              </Link>
            ))}
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-2xl px-4 text-left text-base font-medium text-text hover:bg-soft"
              >
                <LogOut aria-hidden className="size-4" /> Sign out
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
            <Link href="/login" onClick={close} className={buttonClasses({ variant: "ghost" })}>
              Log in
            </Link>
            <Link href="/signup" onClick={close} className={buttonClasses({ variant: "primary" })}>
              Book a free demo
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
