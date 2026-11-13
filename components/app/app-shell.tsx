"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppPath, useHostHref } from "@/components/platform/hosts";
import { ServiceSwitcher, type SwitcherProps } from "@/components/platform/service-switcher";
import { Bell, ChevronDown, ChevronRight, Clapperboard, ExternalLink, LogOut, Menu, Plus, Search, Settings, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme";
import { KitStyles } from "@/components/admin/kit/kit-styles";
import { Avatar, Button, useToast } from "@/components/ui";
import { readableTextColor } from "@/lib/color-contrast";
import { cn } from "@/lib/cn";
import { FEATURES, type FeatureKey } from "@/lib/features";
import { BottomBar, badgeText } from "./bottom-bar";
import { CreateMenu } from "./create-menu";
import { activeGroup, bottomBarItems, createActions, FEATURE_ICONS, finderEntries, FOLDED_GROUP, isActive, navFor, type CreateAction, type NavGroup, type StudioLink } from "./nav";
import { PageFinder } from "./page-finder";
import { RAIL, RAIL_CREATE, RAIL_OFF, RAIL_ON, RAIL_PANEL, RAIL_ROW, RAIL_TITLE } from "./rail";
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
  /** Features that do not exist in the company's region (Creator campaigns outside Rwanda): never offered. */
  notOffered?: FeatureKey[];
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
  /** The service switcher (Marketing, Agency, All services), once Marketing has its own host; null hides it. */
  switcher?: SwitcherProps | null;
  children: ReactNode;
};

export type ShellNotice = { id: string; title: string; text: string; href: string; action: string };

/** The bell: a short list of notices, or "all caught up". Esc and a click outside close it. */
function NoticesBell({ notices }: { notices: ShellNotice[] }) {
  const { toast } = useToast();
  const toHref = useHostHref();
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
            <Link key={n.id} href={toHref(n.href)} onClick={() => setOpen(false)} className="flex flex-col gap-0.5 rounded-2xl p-3 hover:bg-soft">
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
function addable(features: FeatureKey[], notOffered: FeatureKey[]) {
  return FEATURES.filter((f) => f.status === "built" && f.kind === "app" && !features.includes(f.key) && !notOffered.includes(f.key));
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
  const toHref = useHostHref();
  return (
    <Link
      href={toHref(href)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(RAIL_ROW, active ? RAIL_ON : RAIL_OFF)}
    >
      {active && <span aria-hidden className="bp-rail-bar absolute -left-3 top-2 bottom-2 w-1 rounded-r-full bg-white" />}
      <Icon aria-hidden className="size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110 motion-reduce:transform-none" />
      {label}
      {badge ? (
        <span className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-full bg-[#c81e3a] px-1.5 text-[12px] leading-[22px] font-bold text-white shadow-sm">
          {badgeText(badge)}
          <span className="sr-only"> unread</span>
        </span>
      ) : null}
    </Link>
  );
}

/** A menu page whose feature is "Coming soon" (lib/features.ts): listed, not a link. */
function SoonItem({ label, icon: Icon }: { label: string; icon: NavGroup["items"][number]["icon"] }) {
  return (
    <div aria-disabled="true" className={cn(RAIL_ROW, "font-medium text-white/85 dark:text-white/60")}>
      <Icon aria-hidden className="size-[18px] shrink-0" />
      <span className="flex min-w-0 flex-col py-1 leading-tight">
        {label}
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white/85 dark:text-[#b7a6ff]">Coming soon</span>
      </span>
    </div>
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
  notOffered: FeatureKey[];
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
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${uid}-items`}
        className={cn(RAIL_TITLE, "flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-xl pb-0 hover:bg-white/12 hover:text-white dark:hover:bg-white/[0.07]")}
      >
        {group.title}
        <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      <div id={`${uid}-items`} hidden={!open} className="flex flex-col gap-0.5">
        {children}
      </div>
    </div>
  );
}

/**
 * BuPulse Marketing's logo on the rail: the real logo (public/brand/marketing-logo*.png), drawn all white on the light
 * rail's gradient (a CSS filter on the dark-text logo keeps its exact shape), and the white logo with the gradient
 * "MARKETING" on the dark rail. Both are in the DOM; `dark:` shows the right one, so the theme never flashes.
 */
function RailLogo({ height = 34 }: { height?: number }) {
  const width = Math.round((height * 2000) / 640);
  return (
    <span className="inline-flex items-center">
      <Image src="/brand/marketing-logo.png" alt="BuPulse Marketing" width={width} height={height} loading="eager" className="block brightness-0 invert dark:hidden" style={{ width, height }} />
      <Image src="/brand/marketing-logo-white.png" alt="BuPulse Marketing" width={width} height={height} loading="eager" className="hidden dark:block" style={{ width, height }} />
    </span>
  );
}

/** The plan box's usage bar on the rail: white on the gradient (the shared Meter's gradient fill would vanish there). */
function RailMeter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className="h-1.5 overflow-hidden rounded-full bg-white/25 dark:bg-white/10">
      <span className={cn("bp-meter-fill block h-full rounded-full", pct >= 90 ? "bg-[#ffb3c0] dark:bg-danger" : "bg-white dark:bg-[linear-gradient(90deg,#2f6bff,#7b5cff)]")} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Sidebar({ pathname, plan, businessName, brand, role, features, notOffered, studio, inboxUnread, actions, createOpen, onCreate, onFind, onNavigate }: SidebarProps) {
  // Members get no purchase prompts; Admins see what could be added so they can ask the owner (lib/team/roles.ts).
  const missing = can(role, "upgrade") ? addable(features, notOffered) : [];
  const groups = useMemo(() => navFor(role, features), [role, features]);
  const hint = useSyncExternalStore(noSubscribe, shortcutHint, () => null);
  const uid = useId();
  const toHref = useHostHref();
  const brandRow = (
    <>
      <BrandMark name={businessName} brand={brand} size={34} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{businessName}</span>
    </>
  );
  const quiet = cn(RAIL_ROW, RAIL_OFF);
  const studioLink =
    studio === "open" ? (
      // A plain link, not next/link: it must never be prefetched (each visit writes a sign-in ticket).
      <a href={toHref("/dashboard/video/open")} target="_blank" rel="noopener" onClick={onNavigate} className={quiet}>
        <Clapperboard aria-hidden className="size-[18px] shrink-0" />
        Video Studio
        <ExternalLink aria-hidden className="ml-auto size-4 shrink-0 opacity-80" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    ) : studio === "upgrade" ? (
      <Link href={toHref("/dashboard/video?studio=plan")} onClick={onNavigate} className={quiet}>
        <Clapperboard aria-hidden className="size-[18px] shrink-0" />
        Video Studio
      </Link>
    ) : null;
  const links = (g: NavGroup) =>
    g.items.map((i) =>
      i.soon ? (
        <SoonItem key={i.href} label={i.label} icon={i.icon} />
      ) : (
        <NavLink key={i.href} href={i.href} label={i.label} icon={i.icon} pathname={pathname} badge={i.href === "/dashboard/inbox" ? inboxUnread : undefined} onNavigate={onNavigate} />
      ),
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="px-1.5 pt-1">
        <Link href={toHref("/dashboard")} onClick={onNavigate} aria-label="BuPulse Marketing home" className="inline-flex min-h-11 items-center rounded-lg">
          <RailLogo height={38} />
        </Link>
      </div>
      {/* At the top, so any page is one search away (owner's request). */}
      <button
        type="button"
        onClick={(e) => onFind(e.currentTarget)}
        aria-haspopup="dialog"
        className={cn(RAIL_PANEL, "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left text-[14px] text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/18 dark:text-white/80 dark:ring-white/10 dark:hover:bg-white/[0.08]")}
      >
        <Search aria-hidden className="size-[18px] shrink-0" />
        <span className="flex-1">Find a page</span>
        {hint && (
          <kbd aria-hidden className="hidden rounded-md border border-white/30 px-1.5 py-0.5 font-sans text-[11px] lg:inline dark:border-white/15">
            {hint}
          </kbd>
        )}
      </button>
      {can(role, "settings") ? (
        <Link
          href={toHref("/dashboard/brand")}
          onClick={onNavigate}
          className={cn(RAIL_PANEL, "flex min-h-14 items-center gap-2.5 rounded-2xl px-2.5 py-2 text-white no-underline transition-colors hover:bg-white/18 dark:hover:bg-white/[0.08]")}
        >
          {brandRow}
          <ChevronRight aria-hidden className="size-4 shrink-0 opacity-80" />
        </Link>
      ) : (
        <div className={cn(RAIL_PANEL, "flex min-h-14 items-center gap-2.5 rounded-2xl px-2.5 py-2 text-white")}>{brandRow}</div>
      )}
      {actions.length > 0 && (
        <button
          type="button"
          onClick={(e) => onCreate(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={createOpen}
          className={cn(RAIL_CREATE, "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-[background-color,filter]")}
        >
          <Plus aria-hidden className="size-5" />
          Create
        </button>
      )}
      <nav aria-label="App" className="flex flex-col gap-4 pt-1">
        {groups.map((g) =>
          g.id === FOLDED_GROUP ? (
            <FoldedGroup key={g.id} group={g} pathname={pathname}>
              {links(g)}
            </FoldedGroup>
          ) : (
            <div key={g.id} role={g.title ? "group" : undefined} aria-labelledby={g.title ? `${uid}-${g.id}` : undefined} className="flex flex-col gap-0.5">
              {g.title && (
                <p id={`${uid}-${g.id}`} className={RAIL_TITLE}>
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
        <nav aria-label="Add to your plan" className="flex flex-col gap-0.5">
          <p className={RAIL_TITLE}>Add to your plan</p>
          {missing.map(({ key, label }) => {
            const Icon = FEATURE_ICONS[key];
            const href = toHref(`/dashboard/upgrade?feature=${key}`);
            return (
              <Link key={key} href={href} onClick={onNavigate} className={quiet}>
                <Icon aria-hidden className="size-[18px] shrink-0" />
                {label}
                <Plus aria-hidden className="ml-auto size-4 shrink-0 opacity-80" />
              </Link>
            );
          })}
        </nav>
      )}
      <div className="mt-auto flex flex-col gap-3 pt-2">
        <div className={cn(RAIL_PANEL, "flex flex-col gap-2.5 rounded-2xl p-3.5 text-white")}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px]">
            <strong className="font-semibold">{plan.name}</strong>
            {plan.trialLabel && <span className="text-white/85 dark:text-white/60">{plan.trialLabel}</span>}
          </div>
          <RailMeter value={plan.used} max={plan.max} label="Text generations used" />
          <span className="text-xs text-white/85 dark:text-white/60">
            {plan.used.toLocaleString("en-US")} of {plan.max.toLocaleString("en-US")} generations used
          </span>
        </div>
      </div>
    </div>
  );
}

function UserMenu({ displayName, email }: { displayName: string; email: string }) {
  const [open, setOpen] = useState(false);
  const toHref = useHostHref();
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
        className="glass inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full py-1 pl-1 pr-1 sm:pr-2.5"
      >
        <Avatar name={displayName} size={36} />
        <ChevronDown aria-hidden className={cn("size-4 text-muted transition-transform max-sm:hidden", open && "rotate-180")} />
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
            href={toHref("/dashboard/settings")}
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
      <div aria-hidden onClick={onClose} className="bp-fade-in absolute inset-0 bg-[rgba(11,11,15,0.45)] backdrop-blur-[2px]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={cn(
          RAIL,
          "bp-drawer-in absolute inset-y-0 left-0 flex w-[min(86vw,300px)] flex-col overflow-y-auto rounded-r-[28px] px-3 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),12px)] shadow-2xl dark:border-r dark:border-white/10",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-3 top-[max(env(safe-area-inset-top),12px)] z-10 inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/12 dark:hover:bg-white/[0.07]"
        >
          <X aria-hidden className="size-5" />
        </button>
        <Sidebar {...sidebar} onNavigate={onClose} />
      </div>
    </div>
  );
}

export function AppShell({ brand, displayName, firstName, email, businessName, plan, role, features, notOffered = [], notices = [], studio = null, inboxUnread = 0, switcher = null, children }: ShellProps) {
  // The app path (/dashboard/...) behind the address shown: on the Marketing host "/posts" is /dashboard/posts.
  const pathname = useAppPath(usePathname());
  const toHref = useHostHref();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The + Create menu: open with the button's place (the computer menu opens under it), or closed (null).
  const [create, setCreate] = useState<{ anchor: DOMRect | null } | null>(null);
  const [finding, setFinding] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Where focus goes back when the drawer, the Create menu or the search closes: the button that opened it.
  const returnFocus = useRef<HTMLElement | null>(null);

  const actions = useMemo(() => createActions(role, features, studio).map((a) => ({ ...a, href: toHref(a.href) })), [role, features, studio, toHref]);
  const entries = useMemo(() => finderEntries(role, features, studio).map((e) => ({ ...e, href: toHref(e.href) })), [role, features, studio, toHref]);
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

  const sidebar = { pathname, plan, role, features, notOffered, studio, businessName, brand, inboxUnread, actions, createOpen: create !== null, onCreate: openCreate, onFind: openFinder };

  return (
    <div
      className="bp-app relative flex min-h-dvh w-full items-start"
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
      {/* The kit's gentle animations (rise-in cards, the tick's pop), shared with the admin console; off under reduced motion. */}
      <KitStyles />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      {/* The rail fills the page's whole height on the left edge (however long the page); its contents stay put. */}
      <aside aria-label="Sidebar" className={cn(RAIL, "hidden w-[264px] shrink-0 self-stretch lg:block dark:border-r dark:border-white/10")}>
        <div className="sticky top-0 flex h-dvh flex-col overflow-y-auto px-3 py-5">
          <Sidebar {...sidebar} />
        </div>
      </aside>

      {drawerOpen && <Drawer {...sidebar} onClose={closeDrawer} />}
      {create && <CreateMenu actions={actions} anchor={create.anchor} onClose={closeCreate} />}
      <PageFinder open={finding} onOpenChange={onFinding} entries={entries} />

      <div className="mx-auto flex w-full min-w-0 max-w-[1320px] flex-1 flex-col gap-6 px-4 pt-3 pb-10 max-lg:pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-5 sm:max-lg:pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-10 lg:pt-6">
        {/* One row on a 390 px phone too: smaller gaps and no chevrons below sm (the switcher and the account menu are
            icon buttons there), or the actions dropped onto a second row. */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={(e) => openDrawer(e.currentTarget)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="glass inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text lg:hidden"
            >
              <Menu aria-hidden className="size-5" />
            </button>
            <div className="flex min-w-0 items-center gap-2.5">
              <BrandMark name={businessName} brand={brand} size={36} />
              {/* On a phone the bar keeps to one row: the greeting shows from the small breakpoint up. */}
              <div className="hidden min-w-0 flex-col sm:flex">
                <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">Welcome back, {firstName}</span>
                <span className="truncate text-[13px] text-muted">{businessName}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {switcher && <ServiceSwitcher {...switcher} />}
            <ThemeToggle />
            <NoticesBell notices={notices} />
            <Button
              href={toHref("/dashboard/knowledge/products/new")}
              size="sm"
              className="max-sm:size-11 max-sm:px-0"
              leading={<Plus aria-hidden className="size-[18px]" />}
            >
              <span className="max-sm:sr-only">Add product</span>
            </Button>
            <UserMenu displayName={displayName} email={email} />
          </div>
        </div>

        <main id="main" className="flex min-w-0 flex-col gap-6 outline-none">
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
