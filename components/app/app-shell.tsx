"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, Clapperboard, ExternalLink, LogOut, Menu, Plus, Search, Settings, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { Avatar, Button, Meter, useToast } from "@/components/ui";
import { readableTextColor } from "@/lib/color-contrast";
import { cn } from "@/lib/cn";
import { FEATURES, type FeatureKey } from "@/lib/features";
import { BottomBar, badgeText } from "./bottom-bar";
import { CreateMenu } from "./create-menu";
import { activeGroup, bottomBarItems, createActions, FEATURE_ICONS, finderEntries, FOLDED_GROUP, isActive, navFor, type CreateAction, type NavGroup, type StudioLink } from "./nav";
import { PageFinder } from "./page-finder";
import { can, type Role } from "@/lib/team/roles";

export type ShellPlan = {
  name: string;
  /** e.g. "5 days left"; null when not on a trial. */
  trialLabel: string | null;
  used: number;
  max: number;
};

export type ShellBrand = {
  /** Signed URL of the business logo, if one was uploaded. */
  logoUrl: string | null;
  /** Three validated hex colours, already padded with BuPulse defaults. */
  colors: [string, string, string];
  /** True when the business set at least one colour of its own. */
  hasColors: boolean;
};

type ShellProps = {
  brand: ShellBrand;
  displayName: string;
  firstName: string;
  email: string;
  businessName: string;
  plan: ShellPlan;
  role: Role;
  /** The features of the company's plan (lib/features.ts). Pages for the others show "Add to your plan". */
  features: FeatureKey[];
  /** Things that need the owner's attention, shown under the bell (for example apps to connect). */
  notices?: ShellNotice[];
  /**
   * The Video Studio link in the sidebar (docs/VIDEO_STUDIO_SPLIT.md): "open" opens studio.bupulse.com in a new tab,
   * signed in; "upgrade" goes to the Videos library, which says the plan has no video credits; null hides it (the
   * studio is switched off, or the role may not make content).
   */
  studio?: StudioLink;
  /** Open inbox conversations with unread messages: the badge on Inbox (0 without the inbox feature). */
  inboxUnread?: number;
  children: ReactNode;
};

export type ShellNotice = { id: string; title: string; text: string; href: string; action: string };

/** The bell: a short list of notices, or "all caught up". Esc and a click outside close it. */
function NoticesBell({ notices }: { notices: ShellNotice[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={notices.length ? `Notifications, ${notices.length} new` : "Notifications"}
        aria-expanded={notices.length ? open : undefined}
        onClick={() => (notices.length ? setOpen((o) => !o) : toast("You're all caught up. No new notifications.", "info"))}
        className="glass relative inline-flex size-11 cursor-pointer items-center justify-center rounded-full"
      >
        <Bell aria-hidden className="size-5" />
        {notices.length > 0 && <span aria-hidden className="absolute top-2 right-2 size-2.5 rounded-full bg-amber-500 ring-2 ring-[var(--bp-bg-solid)]" />}
      </button>
      {open && (
        <div role="region" aria-label="Notifications" className="glass-strong absolute right-0 z-40 mt-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-1 rounded-card p-2 shadow-glass">
          {notices.map((n) => (
            <Link key={n.id} href={n.href} onClick={() => setOpen(false)} className="flex flex-col gap-0.5 rounded-2xl p-3 hover:bg-soft">
              <span className="text-[15px] font-semibold">{n.title}</span>
              <span className="text-[14px] text-muted">{n.text}</span>
              <span className="text-[14px] font-semibold text-pulse-blue">{n.action}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Built features of the app the plan does not include: offered in a small group under the navigation. */
function addable(features: FeatureKey[]) {
  return FEATURES.filter((f) => f.status === "built" && f.kind === "app" && !features.includes(f.key));
}

// The "Account & settings" group's open or closed choice, remembered on this device. Storage may be refused (private
// windows): the choice then lasts until the page is opened again.
const FOLD_KEY = "bp-nav-account-open";
const foldListeners = new Set<() => void>();
let foldMemory: boolean | null = null;

function readFold(): boolean {
  if (foldMemory !== null) return foldMemory;
  try {
    return window.localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFold(open: boolean) {
  foldMemory = open;
  try {
    window.localStorage.setItem(FOLD_KEY, open ? "1" : "0");
  } catch {
    // Kept in memory instead.
  }
  foldListeners.forEach((l) => l());
}

function subscribeFold(cb: () => void) {
  foldListeners.add(cb);
  return () => {
    foldListeners.delete(cb);
  };
}

// "⌘K" on a Mac or an iPad with a keyboard, "Ctrl K" elsewhere; nothing on the server (the hint is for keyboards only).
const noSubscribe = () => () => {};
const shortcutHint = () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K");

function NavLink({ href, label, icon: Icon, pathname, badge, onNavigate }: { href: string; label: string; icon: NavGroup["items"][number]["icon"]; pathname: string; badge?: number; onNavigate?: () => void }) {
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-[15px] font-medium no-underline transition-colors duration-200",
        active ? "bg-soft text-text" : "text-muted hover:bg-soft hover:text-text",
      )}
    >
      {active && (
        <span
          aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full"
          style={{ background: "linear-gradient(180deg, var(--brand-1), var(--brand-2))" }}
        />
      )}
      <Icon aria-hidden className={cn("size-[18px] shrink-0", active && "text-pulse-blue")} />
      {label}
      {badge ? (
        <span className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-full bg-danger px-1.5 text-[12px] leading-[22px] font-bold text-white">
          {badgeText(badge)}
          <span className="sr-only"> unread</span>
        </span>
      ) : null}
    </Link>
  );
}

function BrandMark({ name, brand, size }: { name: string; brand: ShellBrand; size: number }) {
  if (brand.logoUrl) {
    return (
      // Signed Supabase URL: a plain img avoids needing remotePatterns for a rotating host.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt={`${name} logo`}
        width={size}
        height={size}
        className="shrink-0 rounded-xl bg-white object-contain p-0.5"
        style={{ width: size, height: size }}
      />
    );
  }
  if (!brand.hasColors) return <Avatar name={name} size={size} className="rounded-xl" />;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.38),
        background: "var(--brand-1)",
        color: "var(--brand-1-text)",
      }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

type SidebarProps = {
  pathname: string;
  role: Role;
  plan: ShellPlan;
  businessName: string;
  brand: ShellBrand;
  features: FeatureKey[];
  studio: StudioLink;
  inboxUnread: number;
  actions: CreateAction[];
  createOpen: boolean;
  onCreate: (button: HTMLButtonElement) => void;
  onFind: (button: HTMLButtonElement) => void;
  onNavigate?: () => void;
};

/** The "Account & settings" group: folded unless opened (remembered) or one of its pages is open. */
function FoldedGroup({ group, pathname, children }: { group: NavGroup; pathname: string; children: ReactNode }) {
  const uid = useId();
  const stored = useSyncExternalStore(subscribeFold, readFold, () => false);
  // Folded by hand on one of its own pages: stays folded there until another page is opened.
  const [closedOn, setClosedOn] = useState<string | null>(null);
  const inside = activeGroup(pathname, [group]) === group.id;
  const open = stored || (inside && closedOn !== pathname);
  const toggle = () => {
    if (open) {
      writeFold(false);
      if (inside) setClosedOn(pathname);
    } else {
      writeFold(true);
      setClosedOn(null);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${uid}-items`}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-2xl px-3.5 text-xs font-semibold uppercase tracking-wide text-muted hover:bg-soft hover:text-text"
      >
        {group.title}
        <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      <div id={`${uid}-items`} hidden={!open} className="flex flex-col gap-1">
        {children}
      </div>
    </div>
  );
}

function Sidebar({ pathname, plan, businessName, brand, role, features, studio, inboxUnread, actions, createOpen, onCreate, onFind, onNavigate }: SidebarProps) {
  // Members get no purchase prompts; Admins see what could be added so they can ask the owner (lib/team/roles.ts).
  const missing = can(role, "upgrade") ? addable(features) : [];
  const groups = useMemo(() => navFor(role, features), [role, features]);
  const hint = useSyncExternalStore(noSubscribe, shortcutHint, () => null);
  const uid = useId();
  const brandRow = (
    <>
      <BrandMark name={businessName} brand={brand} size={36} />
      <span className="min-w-0 truncate text-sm font-semibold">{businessName}</span>
    </>
  );
  const quiet = "flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-[15px] font-medium text-muted no-underline transition-colors duration-200 hover:bg-soft hover:text-text";
  const studioLink =
    studio === "open" ? (
      // A plain link, not next/link: it must never be prefetched (each visit writes a sign-in ticket).
      <a href="/dashboard/video/open" target="_blank" rel="noopener" onClick={onNavigate} className={quiet}>
        <Clapperboard aria-hidden className="size-[18px] shrink-0" />
        Video Studio
        <ExternalLink aria-hidden className="ml-auto size-4 shrink-0" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    ) : studio === "upgrade" ? (
      <Link href="/dashboard/video?studio=plan" onClick={onNavigate} className={quiet}>
        <Clapperboard aria-hidden className="size-[18px] shrink-0" />
        Video Studio
      </Link>
    ) : null;
  const links = (g: NavGroup) =>
    g.items.map((i) => <NavLink key={i.href} href={i.href} label={i.label} icon={i.icon} pathname={pathname} badge={i.href === "/dashboard/inbox" ? inboxUnread : undefined} onNavigate={onNavigate} />);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="px-2 pt-1">
        <Link href="/dashboard" onClick={onNavigate} aria-label="BuPulse home" className="inline-flex min-h-11 items-center">
          <Logo height={28} />
        </Link>
      </div>
      {can(role, "settings") ? (
        <Link
          href="/dashboard/brand"
          onClick={onNavigate}
          className="flex min-h-12 items-center gap-2.5 rounded-2xl bg-soft px-2.5 py-1.5 no-underline"
        >
          {brandRow}
        </Link>
      ) : (
        <div className="flex min-h-12 items-center gap-2.5 rounded-2xl bg-soft px-2.5 py-1.5">{brandRow}</div>
      )}
      {actions.length > 0 && (
        <button
          type="button"
          onClick={(e) => onCreate(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={createOpen}
          className="-my-1 inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-4 text-[15px] font-semibold text-white shadow-glow transition-shadow hover:shadow-glow-hover"
        >
          <Plus aria-hidden className="size-5" />
          Create
        </button>
      )}
      <nav aria-label="App" className="flex flex-col gap-3">
        {groups.map((g) =>
          g.id === FOLDED_GROUP ? (
            <FoldedGroup key={g.id} group={g} pathname={pathname}>
              {links(g)}
            </FoldedGroup>
          ) : (
            <div key={g.id} role={g.title ? "group" : undefined} aria-labelledby={g.title ? `${uid}-${g.id}` : undefined} className="flex flex-col gap-1">
              {g.title && (
                <p id={`${uid}-${g.id}`} className="px-3.5 pb-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  {g.title}
                </p>
              )}
              {links(g)}
              {g.id === "create" && studioLink}
            </div>
          ),
        )}
      </nav>
      {missing.length > 0 && (
        <nav aria-label="Add to your plan" className="flex flex-col gap-1">
          <p className="px-3.5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Add to your plan</p>
          {missing.map(({ key, label }) => {
            const Icon = FEATURE_ICONS[key];
            const href = `/dashboard/upgrade?feature=${key}`;
            return (
              <Link
                key={key}
                href={href}
                onClick={onNavigate}
                className="flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-[14px] font-medium text-muted no-underline transition-colors duration-200 hover:bg-soft hover:text-text"
              >
                <Icon aria-hidden className="size-[18px] shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="mt-auto flex flex-col gap-3">
        <button
          type="button"
          onClick={(e) => onFind(e.currentTarget)}
          aria-haspopup="dialog"
          className="glass flex min-h-11 cursor-pointer items-center gap-2.5 rounded-2xl px-3.5 text-left text-[15px] text-muted hover:text-text"
        >
          <Search aria-hidden className="size-[18px] shrink-0" />
          <span className="flex-1">Find a page</span>
          {hint && (
            <kbd aria-hidden className="hidden rounded-md border border-line px-1.5 py-0.5 font-sans text-[11px] lg:inline">
              {hint}
            </kbd>
          )}
        </button>
        <div className="glass-strong flex flex-col gap-2.5 rounded-[20px] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px]">
            <strong>{plan.name}</strong>
            {plan.trialLabel && <span className="text-muted">{plan.trialLabel}</span>}
          </div>
          <Meter value={plan.used} max={plan.max} label="Text generations used" />
          <span className="text-xs text-muted">
            {plan.used} of {plan.max} generations used
          </span>
        </div>
      </div>
    </div>
  );
}

function UserMenu({ displayName, email }: { displayName: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
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
        aria-label="Account menu"
        className="glass inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5"
      >
        <Avatar name={displayName} size={36} />
        <ChevronDown aria-hidden className={cn("size-4 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="glass-strong absolute right-0 top-[calc(100%+8px)] z-40 flex w-64 max-w-[calc(100vw-32px)] flex-col gap-1 rounded-[20px] p-2"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <Link
            href="/dashboard/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-medium no-underline hover:bg-soft"
          >
            <Settings aria-hidden className="size-4" /> Settings
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium hover:bg-soft"
            >
              <LogOut aria-hidden className="size-4" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Drawer({ onClose, ...sidebar }: Omit<SidebarProps, "onNavigate"> & { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden" onKeyDown={onKeyDown}>
      <div aria-hidden onClick={onClose} className="bp-fade-in absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="glass-strong bp-drawer-in absolute inset-y-3 left-3 flex w-[min(86vw,300px)] flex-col gap-3 overflow-y-auto rounded-[28px] p-3.5"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-3 top-3 z-10 inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft"
        >
          <X aria-hidden className="size-5" />
        </button>
        <Sidebar {...sidebar} onNavigate={onClose} />
      </div>
    </div>
  );
}

export function AppShell({ brand, displayName, firstName, email, businessName, plan, role, features, notices = [], studio = null, inboxUnread = 0, children }: ShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The + Create menu: open with the button's place (the computer menu opens under it), or closed (null).
  const [create, setCreate] = useState<{ anchor: DOMRect | null } | null>(null);
  const [finding, setFinding] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Where focus goes back when the drawer, the Create menu or the search closes: the button that opened it.
  const returnFocus = useRef<HTMLElement | null>(null);

  const actions = useMemo(() => createActions(role, features, studio), [role, features, studio]);
  const entries = useMemo(() => finderEntries(role, features, studio), [role, features, studio]);
  const barItems = useMemo(() => bottomBarItems(role, features), [role, features]);

  const refocus = useCallback(() => {
    (returnFocus.current ?? menuButtonRef.current)?.focus();
    returnFocus.current = null;
  }, []);
  const openDrawer = (button: HTMLElement) => {
    returnFocus.current = button;
    setDrawerOpen(true);
  };
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    refocus();
  }, [refocus]);
  // From the drawer, the menu and the search take its place; focus then goes back to what opened the drawer.
  const openCreate = (button: HTMLButtonElement) => {
    if (!drawerOpen) returnFocus.current = button;
    setDrawerOpen(false);
    setCreate({ anchor: window.matchMedia("(min-width: 64rem)").matches ? button.getBoundingClientRect() : null });
  };
  const closeCreate = useCallback(
    (restore: boolean) => {
      setCreate(null);
      if (restore) refocus();
      else returnFocus.current = null;
    },
    [refocus],
  );
  const openFinder = (button: HTMLButtonElement) => {
    if (!drawerOpen) returnFocus.current = button;
    setDrawerOpen(false);
    setFinding(true);
  };
  const onFinding = useCallback(
    (open: boolean) => {
      setFinding(open);
      if (!open) refocus();
    },
    [refocus],
  );

  const sidebar = { pathname, plan, role, features, studio, businessName, brand, inboxUnread, actions, createOpen: create !== null, onCreate: openCreate, onFind: openFinder };

  return (
    <div
      className="relative flex min-h-dvh w-full flex-wrap items-start gap-5 p-3 max-lg:pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-5 sm:max-lg:pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
      style={
        {
          "--brand-1": brand.colors[0],
          "--brand-2": brand.colors[1],
          "--brand-3": brand.colors[2],
          "--brand-1-text": readableTextColor(brand.colors[0]),
          "--brand-2-text": readableTextColor(brand.colors[1]),
          "--brand-3-text": readableTextColor(brand.colors[2]),
        } as CSSProperties
      }
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        className="glass-strong hidden w-[248px] shrink-0 flex-col rounded-[28px] p-3.5 lg:sticky lg:top-5 lg:flex lg:max-h-[calc(100dvh-2.5rem)] lg:self-start lg:overflow-y-auto"
      >
        <Sidebar {...sidebar} />
      </aside>

      {drawerOpen && <Drawer {...sidebar} onClose={closeDrawer} />}
      {create && <CreateMenu actions={actions} anchor={create.anchor} onClose={closeCreate} />}
      <PageFinder open={finding} onOpenChange={onFinding} entries={entries} />

      <div className="flex min-w-0 flex-1 basis-[min(100%,560px)] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={(e) => openDrawer(e.currentTarget)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="glass inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full lg:hidden"
            >
              <Menu aria-hidden className="size-5" />
            </button>
            <div className="flex min-w-0 items-center gap-2.5">
              <BrandMark name={businessName} brand={brand} size={36} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-semibold">Welcome back, {firstName}</span>
                <span className="truncate text-[13px] text-muted">{businessName}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <NoticesBell notices={notices} />
            <Button href="/dashboard/knowledge/products/new" size="sm" leading={<Plus aria-hidden className="size-[18px]" />}>
              Add product
            </Button>
            <UserMenu displayName={displayName} email={email} />
          </div>
        </div>

        <main id="main" className="flex min-w-0 flex-col gap-5 outline-none">
          {children}
        </main>
      </div>

      <BottomBar
        items={barItems}
        pathname={pathname}
        unread={inboxUnread}
        canCreate={actions.length > 0}
        createOpen={create !== null}
        menuOpen={drawerOpen}
        onCreate={openCreate}
        onMenu={openDrawer}
      />
    </div>
  );
}
