"use client";

import Link from "next/link";
import { useAppPath, useHostHref } from "@/components/platform/hosts";
import { usePathname } from "next/navigation";
import { CurrencySwitch } from "./currency-switch";
import type { DisplayCurrency } from "@/lib/money/display";
import { ArrowUpRight, ChevronDown, ChevronRight, Ellipsis, LayoutGrid, LogOut, Search, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { BrandLockup } from "@/components/brand/lockup";
import { ThemeToggle } from "@/components/theme";
import type { BadgeTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CommandPalette } from "./command-palette";
import { breadcrumbsFor, findNavItem, groupHref, hubFor, inGroup, navFor, phoneTabsFor, type AdminNavGroup, type BadgeKey } from "./nav";
import { Breadcrumbs as KitBreadcrumbs } from "./kit/breadcrumbs";
import { IconBadge } from "./kit/icon-badge";
import { KitStyles } from "./kit/kit-styles";
import { CountBubble } from "./kit/status-pill";
import type { Permission } from "@/lib/staff/permissions";

// The admin console's frame, in the support app's style. On a computer: a sidebar with the brand, a big Search button
// (Cmd/Ctrl+K), the groups with their icons (each folds, remembered in this browser, and links to its hub of cards),
// the to-do badges, and who is signed in; a top bar with the breadcrumbs, the currency switch, the theme and sign out.
// On a phone: a slim top bar (brand, search, theme) and a tab bar at the bottom (Overview, Inbox, Clients, Sales, More)
// whose More sheet lists every group, the currency switch, the theme, the customer view and sign out. Who sees which
// page is decided by nav.ts (navFor), exactly as before.

export type ShellBadge = { count: number; tone: BadgeTone; label: string };
export type ShellBadges = Partial<Record<BadgeKey, ShellBadge>>;

// Groups start folded (a calm list of areas with their to-do counts) except the one you are in; the ones you open
// stay open. (The old key held folded groups when everything started open.)
const STORAGE_KEY = "bp-admin-nav-open";

const NAV_EVENT = "bp-admin-nav";

// The opened groups live in localStorage (per browser, a convenience only) and are read through
// useSyncExternalStore, so the server render (only the current group open) and the browser agree without an effect.
function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseOpened(raw: string): string[] {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(NAV_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(NAV_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeOpened(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private windows and blocked storage: the groups just open again next time.
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

const bubbleTone = (t: BadgeTone) => (t === "danger" ? "danger" : t === "neutral" || t === "success" ? "neutral" : "violet");

function CountBadge({ badge }: { badge?: ShellBadge }) {
  if (!badge || badge.count <= 0) return null;
  return <CountBubble count={badge.count} tone={bubbleTone(badge.tone)} label={badge.label} />;
}

/** The to-dos waiting in a list of badges (red and violet ones; error counts are information, not to-dos). */
function waitingIn(badges: ShellBadges, keys: BadgeKey[]): number {
  return keys.reduce((s, k) => {
    const b = badges[k];
    return s + (b && b.tone !== "neutral" ? b.count : 0);
  }, 0);
}

const groupBadgeKeys = (g: AdminNavGroup): BadgeKey[] => g.items.flatMap((i) => (i.badge ? [i.badge] : []));

/** BuPulse's real logo and "Admin" (components/brand/lockup.tsx), linking to the Overview. Light and dark. */
function AdminBrand({ compact }: { compact?: boolean }) {
  const toHref = useHostHref();
  return (
    <Link href={toHref("/admin")} className={cn("inline-flex items-center rounded-lg no-underline", !compact && "self-start", "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30")}>
      <BrandLockup service="Admin" height={compact ? 26 : 32} eager />
    </Link>
  );
}

/** The sidebar: groups that fold (remembered in this browser); the active page's group always stays open. */
export function Nav({ badges, permissions, onNavigate, pathname: forced }: { badges: ShellBadges; permissions: readonly Permission[]; onNavigate?: () => void; /** For the dev preview: the page to mark current. */ pathname?: string }) {
  // The app path (/admin/...) behind the address shown: on the admin host "/companies" is /admin/companies.
  const current = useAppPath(usePathname() ?? "/admin");
  const pathname = forced ?? current;
  const toHref = useHostHref();
  const active = findNavItem(pathname);
  const activeHub = hubFor(pathname);
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const opened = useMemo(() => parseOpened(raw), [raw]);
  const toggle = (id: string) => writeOpened(opened.includes(id) ? opened.filter((x) => x !== id) : [...opened, id]);

  return (
    <nav aria-label="Admin" className="flex flex-col gap-3">
      {navFor(permissions).map((group) => {
        const here = active?.group.id === group.id || activeHub?.id === group.id;
        const open = !group.title || opened.includes(group.id) || here;
        const hidden = waitingIn(badges, groupBadgeKeys(group));
        const GroupIcon = group.icon;
        const hubHref = group.items.length > 1 ? group.hub : undefined;
        return (
          <div key={group.id} className="flex flex-col gap-0.5">
            {group.title && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={open}
                  aria-controls={`nav-${group.id}`}
                  className="flex min-h-10 flex-1 cursor-pointer items-center gap-2.5 rounded-xl px-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted hover:text-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30"
                >
                  {GroupIcon && <IconBadge icon={GroupIcon} tone={group.tone} size="sm" className="size-6 rounded-lg [&>svg]:size-3.5" />}
                  <span className="flex-1 text-left">{group.title}</span>
                  {!open && hidden > 0 && <CountBubble count={hidden} label={`${hidden} waiting in ${group.title}`} />}
                  {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
                </button>
                {hubHref && (
                  <Link
                    href={toHref(hubHref)}
                    onClick={onNavigate}
                    aria-label={`All of ${group.title}, as cards`}
                    title={`All of ${group.title}`}
                    aria-current={activeHub?.id === group.id ? "page" : undefined}
                    className={cn(
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-soft hover:text-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30",
                      activeHub?.id === group.id && "bg-pulse-blue/10 text-pulse-blue dark:text-[#8db0ff]",
                    )}
                  >
                    <LayoutGrid aria-hidden className="size-4" />
                  </Link>
                )}
              </div>
            )}
            <ul id={`nav-${group.id}`} hidden={!open} className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: Icon, badge }) => {
                const isActive = active?.href === href;
                return (
                  <li key={href}>
                    <Link
                      href={toHref(href)}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "group relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30",
                        isActive ? "kit-pop bg-brand-gradient font-semibold text-white shadow-[0_10px_22px_-14px_rgba(47,107,255,0.9)]" : "text-muted hover:bg-soft hover:text-text",
                      )}
                    >
                      <Icon aria-hidden className={cn("size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110 motion-reduce:transform-none", isActive ? "text-white" : "")} />
                      <span className="flex-1 truncate">{label}</span>
                      {isActive && badge && badges[badge] && badges[badge]!.count > 0 ? (
                        <span aria-label={badges[badge]!.label} className="rounded-full bg-white/25 px-1.5 text-[11px] font-bold tabular-nums">
                          {badges[badge]!.count > 99 ? "99+" : badges[badge]!.count}
                        </span>
                      ) : (
                        <CountBadge badge={badge ? badges[badge] : undefined} />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Admin > Money > Invoices > Details, from the nav map (the group links to its hub). */
export function Breadcrumbs({ pathname }: { pathname: string }) {
  const toHref = useHostHref();
  return <KitBreadcrumbs crumbs={breadcrumbsFor(pathname).map((c) => (c.href ? { ...c, href: toHref(c.href) } : c))} />;
}

function SignOutButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}

const initialOf = (email: string) => (email.trim()[0] ?? "A").toUpperCase();

/** The phone tab bar: up to four main places and More. */
function TabBar({ permissions, badges, pathname, onMore }: { permissions: readonly Permission[]; badges: ShellBadges; pathname: string; onMore: () => void }) {
  const tabs = phoneTabsFor(permissions);
  const toHref = useHostHref();
  const isOn = (t: (typeof tabs)[number]) => (t.groupId ? inGroup(pathname, t.groupId) : t.href === "/admin" ? pathname === "/admin" : pathname === t.href || pathname.startsWith(`${t.href}/`));
  const anyOn = tabs.some(isOn);
  const tabGroups = new Set(tabs.map((t) => t.groupId));
  const moreWaiting = navFor(permissions)
    .filter((g) => g.id !== "home" && !tabGroups.has(g.id))
    .reduce((s, g) => s + waitingIn(badges, groupBadgeKeys(g)), 0);
  const cell = "relative flex min-h-[58px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-blue/50";
  return (
    <>
      <div aria-hidden className="h-[calc(76px+env(safe-area-inset-bottom))] shrink-0 lg:hidden" />
      <nav aria-label="Main sections" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/92 px-1.5 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 shadow-[0_-10px_30px_-20px_rgba(17,24,39,0.35)] backdrop-blur-xl lg:hidden dark:bg-[#111117]/92">
        <ul className="mx-auto flex max-w-lg items-stretch gap-1">
          {tabs.map((t) => {
            const on = isOn(t);
            const waiting = waitingIn(badges, t.badges);
            return (
              <li key={t.key} className="flex min-w-0 flex-1">
                <Link href={toHref(t.href)} aria-current={on ? "page" : undefined} className={cn(cell, on ? "text-pulse-blue dark:text-[#8db0ff]" : "text-muted")}>
                  <span className={cn("relative inline-flex h-8 w-14 items-center justify-center rounded-full", on && "kit-pop bg-pulse-blue/12 dark:bg-pulse-blue/25")}>
                    <t.icon aria-hidden className="size-[21px]" />
                    {waiting > 0 && (
                      <span className="absolute -right-0.5 -top-1">
                        <CountBubble count={waiting} label={`${waiting} waiting`} />
                      </span>
                    )}
                  </span>
                  <span className="max-w-full truncate">{t.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button type="button" onClick={onMore} aria-haspopup="dialog" className={cn(cell, "cursor-pointer", !anyOn ? "text-pulse-blue dark:text-[#8db0ff]" : "text-muted")}>
              <span className={cn("relative inline-flex h-8 w-14 items-center justify-center rounded-full", !anyOn && "bg-pulse-blue/12 dark:bg-pulse-blue/25")}>
                <Ellipsis aria-hidden className="size-[21px]" />
                {moreWaiting > 0 && (
                  <span className="absolute -right-0.5 -top-1">
                    <CountBubble count={moreWaiting} label={`${moreWaiting} waiting in other areas`} />
                  </span>
                )}
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

/** The phone's More sheet: every group (to its hub, or its only page), search, the currency, theme and sign out. */
function MoreSheet({ dialog, permissions, badges, pathname, email, roleName, currency, onSearch }: { dialog: RefObject<HTMLDialogElement | null>; permissions: readonly Permission[]; badges: ShellBadges; pathname: string; email: string; roleName?: string; currency?: DisplayCurrency; onSearch: () => void }) {
  const close = () => dialog.current?.close();
  const toHref = useHostHref();
  const groups = navFor(permissions).filter((g) => g.title);
  return (
    <dialog
      ref={dialog}
      aria-label="More"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="kit-sheet m-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-[26px] border-0 bg-surface p-0 text-text shadow-2xl backdrop:bg-transparent lg:hidden dark:bg-[#15151b]"
    >
      <div className="flex flex-col gap-4 p-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        <span aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <div className="flex items-center gap-3">
          <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[15px] font-bold text-white">{initialOf(email)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-bold">{email}</span>
            <span className="truncate text-[12.5px] text-muted">{roleName ?? "Owner"}</span>
          </span>
          <button type="button" onClick={close} aria-label="Close" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full bg-bg hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-blue/50 dark:bg-white/[0.06]">
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            close();
            onSearch();
          }}
          className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-bg px-3 text-left text-[14px] font-semibold text-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 dark:bg-white/[0.04]"
        >
          <Search aria-hidden className="size-5 text-pulse-blue" />
          Search pages and companies
        </button>

        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Every area</p>
          <ul className="grid grid-cols-1 gap-2">
            {groups.map((g) => {
              const on = inGroup(pathname, g.id);
              const waiting = waitingIn(badges, groupBadgeKeys(g));
              return (
                <li key={g.id}>
                  <Link
                    href={toHref(groupHref(g))}
                    onClick={close}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "flex min-h-[60px] items-center gap-3 rounded-2xl border-2 p-2.5 text-text no-underline transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30",
                      on ? "border-pulse-blue bg-pulse-blue/[0.07] dark:bg-pulse-blue/15" : "border-line hover:border-pulse-blue/40",
                    )}
                  >
                    {g.icon && <IconBadge icon={g.icon} tone={g.tone} />}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[15px] font-semibold">{g.title}</span>
                      <span className="line-clamp-1 text-[12.5px] text-muted">{g.items.length === 1 ? g.items[0].description : g.hint}</span>
                    </span>
                    <CountBubble count={waiting} label={`${waiting} waiting in ${g.title}`} />
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-[linear-gradient(140deg,#2f6bff,#7b5cff)] p-2 text-white dark:bg-none dark:bg-[#1d1d25]">
          {currency && (
            <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[13px] font-semibold">
              Show amounts in
              <CurrencySwitch value={currency} />
            </div>
          )}
          <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-1 text-[13px] font-semibold">
            Light or dark look
            <ThemeToggle className="size-10 border-white/20 bg-white/15 text-white shadow-none dark:bg-white/[0.06]" />
          </div>
          {/* The Marketing dashboard, on its own host once it has one: a plain link (never a cross-host Next Link). */}
          <a href={toHref("/dashboard")} onClick={close} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-white no-underline hover:bg-white/15">
            <ArrowUpRight aria-hidden className="size-4" /> Customer view
          </a>
          <SignOutButton className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-[13px] font-semibold hover:bg-white/15">
            <LogOut aria-hidden className="size-4" /> Sign out
          </SignOutButton>
        </div>
      </div>
    </dialog>
  );
}

export function AdminShell({
  email,
  roleName,
  permissions,
  badges,
  currency,
  children,
  pathname: forced,
}: {
  email: string;
  roleName?: string;
  permissions: readonly Permission[];
  badges: ShellBadges;
  /** The display currency (RWF | USD | EUR switch). */ currency?: DisplayCurrency;
  children: ReactNode;
  /** For the dev preview only: the page to mark current (otherwise the real path). */
  pathname?: string;
}) {
  const [search, setSearch] = useState(false);
  const current = useAppPath(usePathname() ?? "/admin");
  const pathname = forced ?? current;
  const toHref = useHostHref();
  const sheet = useRef<HTMLDialogElement>(null);
  const onSearch = useCallback((v: boolean) => setSearch(v), []);
  const crumbs = breadcrumbsFor(pathname).map((c) => (c.href ? { ...c, href: toHref(c.href) } : c));
  return (
    <div className="relative min-h-dvh w-full bg-bg lg:flex">
      <KitStyles />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>

      {/* Computer: the sidebar, full height, its own scroll. */}
      <aside aria-label="Sidebar" className="hidden shrink-0 border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[272px] lg:flex-col dark:bg-[#111117]">
        <div className="flex flex-col gap-5 px-4 pb-3 pt-6">
          <AdminBrand />
          <button
            type="button"
            onClick={() => setSearch(true)}
            className="group flex min-h-12 cursor-pointer items-center gap-2.5 rounded-2xl border border-line bg-bg px-3 text-[14px] text-muted transition-[border-color,box-shadow] hover:border-pulse-blue/40 hover:shadow-[0_10px_24px_-18px_rgba(47,107,255,0.8)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 dark:bg-white/[0.04]"
          >
            <Search aria-hidden className="size-[18px] text-pulse-blue dark:text-[#8db0ff]" />
            <span className="flex-1 text-left font-medium group-hover:text-text">Search</span>
            <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans text-[11px] font-semibold dark:bg-white/[0.06]">⌘K</kbd>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <Nav badges={badges} permissions={permissions} pathname={forced} />
        </div>
        <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
          <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[13px] font-bold text-white">{initialOf(email)}</span>
          <span className="flex min-w-0 flex-1 flex-col" title={email}>
            <span className="truncate text-[13px] font-semibold">{email}</span>
            <span className="truncate text-[12px] text-muted">{roleName ?? "Owner"}</span>
          </span>
          <a href={toHref("/dashboard")} aria-label="Customer view" title="Customer view" className="inline-flex size-9 items-center justify-center rounded-xl text-muted hover:bg-soft hover:text-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30">
            <ArrowUpRight aria-hidden className="size-4" />
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone: a slim top bar. */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/92 px-3.5 py-2.5 backdrop-blur-xl lg:hidden dark:bg-[#111117]/92">
          <AdminBrand compact />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSearch(true)} aria-label="Search pages and companies" className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-bg px-3.5 text-[13px] font-semibold text-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 dark:bg-white/[0.05]">
              <Search aria-hidden className="size-4 text-pulse-blue dark:text-[#8db0ff]" />
              Search
            </button>
            <ThemeToggle className="size-10 shadow-none" />
          </div>
        </header>

        {/* Computer: breadcrumbs and the account controls. */}
        <div className="sticky top-0 z-20 hidden items-center justify-between gap-4 border-b border-line bg-bg/80 px-8 py-3 backdrop-blur-xl lg:flex">
          <KitBreadcrumbs crumbs={crumbs} />
          <div className="flex shrink-0 items-center gap-2.5">
            {currency && <CurrencySwitch value={currency} />}
            <ThemeToggle className="size-10 shadow-none" />
            <SignOutButton className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:border-danger/40 hover:text-danger focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 dark:bg-white/[0.04]">
              <LogOut aria-hidden className="size-4" /> Sign out
            </SignOutButton>
          </div>
        </div>

        <main id="main" className="mx-auto flex w-full min-w-0 max-w-[1320px] flex-col gap-5 px-4 pb-8 pt-4 outline-none sm:px-6 lg:px-8 lg:pt-7">
          {crumbs.length > 1 && <KitBreadcrumbs crumbs={crumbs} className="-mb-1 lg:hidden" />}
          {children}
        </main>

        <TabBar permissions={permissions} badges={badges} pathname={pathname} onMore={() => sheet.current?.showModal()} />
      </div>
      <MoreSheet dialog={sheet} permissions={permissions} badges={badges} pathname={pathname} email={email} roleName={roleName} currency={currency} onSearch={() => setSearch(true)} />
      <CommandPalette open={search} onOpenChange={onSearch} permissions={permissions} />
    </div>
  );
}
