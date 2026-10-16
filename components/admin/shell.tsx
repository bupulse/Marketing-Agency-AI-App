"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CurrencySwitch } from "./currency-switch";
import type { DisplayCurrency } from "@/lib/money/display";
import { ChevronDown, ChevronRight, LogOut, Menu, Search, X } from "lucide-react";
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { Badge, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CommandPalette } from "./command-palette";
import { breadcrumbsFor, findNavItem, navFor, type BadgeKey } from "./nav";
import type { Permission } from "@/lib/staff/permissions";

export type ShellBadge = { count: number; tone: BadgeTone; label: string };
export type ShellBadges = Partial<Record<BadgeKey, ShellBadge>>;

const STORAGE_KEY = "bp-admin-nav-collapsed";

const NAV_EVENT = "bp-admin-nav";

// The folded groups live in localStorage (per browser, a convenience only) and are read through
// useSyncExternalStore, so the server render (everything open) and the browser agree without an effect.
function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseCollapsed(raw: string): string[] {
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

function writeCollapsed(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private windows and blocked storage: the groups just open again next time.
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

function CountBadge({ badge }: { badge?: ShellBadge }) {
  if (!badge || badge.count <= 0) return null;
  return (
    <Badge tone={badge.tone} aria-label={badge.label} className="px-2 py-0.5 tabular-nums">
      {badge.count > 99 ? "99+" : badge.count}
    </Badge>
  );
}

/** The sidebar: groups that fold (remembered in this browser); the active page's group always stays open. */
export function Nav({ badges, permissions, onNavigate }: { badges: ShellBadges; permissions: readonly Permission[]; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/admin";
  const active = findNavItem(pathname);
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const collapsed = useMemo(() => parseCollapsed(raw), [raw]);
  const toggle = (id: string) => writeCollapsed(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);

  return (
    <nav aria-label="Admin" className="flex flex-col gap-2">
      {navFor(permissions).map((group) => {
        const open = !group.title || !collapsed.includes(group.id) || active?.group.id === group.id;
        const hidden = group.items.reduce((s, i) => s + (i.badge ? (badges[i.badge]?.count ?? 0) : 0), 0);
        const GroupIcon = group.icon;
        return (
          <div key={group.id} className="flex flex-col gap-0.5">
            {group.title && (
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={open}
                aria-controls={`nav-${group.id}`}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-3 text-[12px] font-semibold uppercase tracking-wide text-muted hover:text-text"
              >
                {GroupIcon && <GroupIcon aria-hidden className="size-3.5" />}
                <span className="flex-1 text-left">{group.title}</span>
                {!open && hidden > 0 && <span className="rounded-full bg-danger-bg px-1.5 text-[11px] text-danger tabular-nums">{hidden}</span>}
                {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
              </button>
            )}
            <div id={`nav-${group.id}`} hidden={!open} className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: Icon, badge }) => {
                const isActive = active?.href === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-[15px] font-medium no-underline transition-colors duration-200",
                      isActive ? "bg-soft text-text shadow-[inset_3px_0_0_var(--color-pulse-blue)]" : "text-muted hover:bg-soft hover:text-text",
                    )}
                  >
                    <Icon aria-hidden className={cn("size-[18px] shrink-0", isActive && "text-pulse-blue")} />
                    <span className="flex-1 truncate">{label}</span>
                    <CountBadge badge={badge ? badges[badge] : undefined} />
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Admin > Money > Invoices > Details, from the nav map. */
export function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = breadcrumbsFor(pathname);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
        {crumbs.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0" />}
            {c.href ? (
              <Link href={c.href} className="truncate hover:text-text">
                {c.label}
              </Link>
            ) : (
              <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className={cn("truncate", i === crumbs.length - 1 && "font-medium text-text")}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function AdminShell({ email, roleName, permissions, badges, currency, children }: { email: string; roleName?: string; permissions: readonly Permission[]; badges: ShellBadges; /** The display currency (RWF | USD | EUR switch). */ currency?: DisplayCurrency; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const pathname = usePathname() ?? "/admin";
  const onSearch = useCallback((v: boolean) => setSearch(v), []);
  return (
    <div className="relative flex min-h-dvh w-full flex-wrap items-start gap-5 p-3 sm:p-5">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        className="glass-strong hidden w-[256px] shrink-0 flex-col gap-4 rounded-[28px] p-3.5 lg:sticky lg:top-5 lg:flex lg:max-h-[calc(100dvh-2.5rem)] lg:self-start lg:overflow-y-auto"
      >
        <div className="flex items-center gap-2 px-2 pt-1">
          <Logo height={26} />
          <Badge tone="violet">Admin</Badge>
        </div>
        <button type="button" onClick={() => setSearch(true)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border border-line bg-surface/60 px-3 text-sm text-muted hover:text-text">
          <Search aria-hidden className="size-4" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded-md border border-line px-1.5 text-[11px] font-sans">⌘K</kbd>
        </button>
        <Nav badges={badges} permissions={permissions} />
      </aside>

      <div className="flex min-w-0 flex-1 basis-[min(100%,560px)] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="admin-mobile-nav"
              className="glass inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full lg:hidden"
            >
              {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
            </button>
            <Breadcrumbs pathname={pathname} />
          </div>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => setSearch(true)} aria-label="Search pages and companies" className="glass inline-flex size-11 cursor-pointer items-center justify-center rounded-full lg:hidden">
              <Search aria-hidden className="size-5" />
            </button>
            {currency && <CurrencySwitch value={currency} />}
            <ThemeToggle />
            <span className="hidden max-w-[14rem] truncate text-sm text-muted xl:inline" title={email}>
              {email}
              {roleName && <span className="ml-1.5 text-xs">({roleName})</span>}
            </span>
            <Link href="/dashboard" className="hidden min-h-11 items-center px-2 text-sm font-medium text-muted underline sm:inline-flex">
              Customer view
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="glass inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium">
                <LogOut aria-hidden className="size-4" /> <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>

        {open && (
          <div id="admin-mobile-nav" className="glass-strong rounded-[24px] p-3 lg:hidden">
            <Nav badges={badges} permissions={permissions} onNavigate={() => setOpen(false)} />
          </div>
        )}

        <main id="main" className="flex min-w-0 flex-col gap-5 outline-none">
          {children}
        </main>
      </div>
      <CommandPalette open={search} onOpenChange={onSearch} permissions={permissions} />
    </div>
  );
}
