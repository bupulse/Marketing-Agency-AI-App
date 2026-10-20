"use client";

import Link from "next/link";
import { Menu, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { isActive, type NavItem } from "./nav";

/** "9+" past nine: the badge stays small. */
export const badgeText = (n: number) => (n > 9 ? "9+" : String(n));

/**
 * The phone bar (below the lg breakpoint): Home, Calendar, the big + (Create), Inbox, Menu (the drawer). `items` comes
 * from bottomBarItems (pages the role and plan cannot open give their place to others). Fixed at the bottom above the
 * home indicator; the shell pads the page so nothing hides behind it.
 */
export function BottomBar({
  items,
  pathname,
  unread,
  canCreate,
  createOpen,
  menuOpen,
  onCreate,
  onMenu,
}: {
  items: NavItem[];
  pathname: string;
  /** Inbox conversations with unread messages: the badge on Inbox. */
  unread: number;
  canCreate: boolean;
  createOpen: boolean;
  menuOpen: boolean;
  onCreate: (button: HTMLButtonElement) => void;
  onMenu: (button: HTMLButtonElement) => void;
}) {
  const slot = "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[11px] font-semibold no-underline";
  const link = ({ href, label, icon: Icon }: NavItem) => {
    const active = isActive(pathname, href);
    const badge = href === "/dashboard/inbox" && unread > 0;
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={badge ? `${label}, ${unread} unread` : undefined}
        className={cn(slot, active ? "text-pulse-blue" : "text-muted hover:text-text")}
      >
        <span aria-hidden className={cn("relative inline-flex h-8 w-12 items-center justify-center rounded-full transition-colors", active && "bg-pulse-blue/12")}>
          <Icon className="size-[22px]" />
          {badge && (
            <span className="absolute -top-0.5 right-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-[18px] font-bold text-white ring-2 ring-[var(--bp-bg-solid)]">
              {badgeText(unread)}
            </span>
          )}
        </span>
        <span className="max-w-full truncate">{label}</span>
      </Link>
    );
  };
  const [first, second, third] = items;

  return (
    <nav
      aria-label="Quick menu"
      data-bottom-bar
      className="fixed inset-x-0 bottom-0 z-40 flex items-end gap-1 rounded-t-[24px] border border-b-0 border-line bg-surface shadow-glass px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {first && link(first)}
      {second && link(second)}
      {canCreate && (
        <div className="flex min-w-0 flex-1 justify-center">
          <button
            type="button"
            onClick={(e) => onCreate(e.currentTarget)}
            aria-haspopup="menu"
            aria-expanded={createOpen}
            aria-label="Create"
            className="-mt-6 flex cursor-pointer flex-col items-center gap-0.5 text-[11px] font-semibold text-text"
          >
            <span aria-hidden className={cn("inline-flex size-14 items-center justify-center rounded-full bg-brand-gradient text-white shadow-glow ring-4 ring-[var(--bp-bg-solid)] transition-transform", createOpen && "rotate-45")}>
              <Plus className="size-7" />
            </span>
            <span aria-hidden>Create</span>
          </button>
        </div>
      )}
      {third && link(third)}
      <button type="button" onClick={(e) => onMenu(e.currentTarget)} aria-expanded={menuOpen} aria-label="Menu, all pages" className={cn(slot, "cursor-pointer text-muted hover:text-text")}>
        <span aria-hidden className="inline-flex h-8 w-12 items-center justify-center">
          <Menu className="size-[22px]" />
        </span>
        <span aria-hidden>Menu</span>
      </button>
    </nav>
  );
}
