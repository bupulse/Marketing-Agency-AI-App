"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from "react";
import { BarChart3, Check, Ellipsis, LineChart, Link2, LogOut, MessagesSquare, Server, UserPlus, Users, X } from "lucide-react";
import { canSeeMonitoring } from "@/lib/support/roles";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/cn";
import { agentTopic, STAFF_TOPICS, type AgentMe } from "@/lib/support/contract";
import { DEPARTMENT_NAMES, initials } from "@/lib/support/app-client/lists";
import { signOutAgent } from "@/app/support/(auth)/actions";
import { alertAgent, AlertsButton, InstallApp } from "./alerts";
import { useSupportApp } from "./app-context";
import { useSupportHref } from "./base";
import { SupportBrand } from "./brand";
import { useLiveQuery, usePageVisible } from "./use-live";

// The support app's frame. On a computer: the sidebar (the brand gradient in light mode, a dark tone with gradient
// accents in dark mode, owner 23 Oct) with the sections in groups, the availability chips, alerts and sign out. On a
// phone: a slim top bar, and a tab bar at the bottom (Chats, Visitors, Analytics, Links, More); More opens a sheet with
// Stats, Server and Team (for who may see them), the availability chips, alerts, install, theme and sign out. The tab
// bar steps aside while a chat is open on a phone, so the reply box sits at the bottom.

const AVAILABILITY: { value: AgentMe["availability"]; label: string; dot: string }[] = [
  { value: "online", label: "Online", dot: "bg-[#2fe39a]" },
  { value: "away", label: "Away", dot: "bg-[#ffc24d]" },
  { value: "offline", label: "Offline", dot: "bg-[#a1a1a6]" },
];

const CSS = `
@keyframes shell-pop { 0% { opacity: 0; transform: scale(.86) } 70% { opacity: 1; transform: scale(1.04) } 100% { opacity: 1; transform: none } }
@keyframes shell-bar { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes shell-sheet { from { transform: translateY(100%) } to { transform: none } }
@keyframes shell-fade { from { opacity: 0 } to { opacity: 1 } }
.shell-pop { animation: shell-pop .32s cubic-bezier(.2,.8,.2,1) both }
.shell-bar { animation: shell-bar .3s cubic-bezier(.2,.8,.2,1) both }
.shell-sheet[open] { animation: shell-sheet .32s cubic-bezier(.2,.8,.2,1) both }
.shell-sheet[open]::backdrop { animation: shell-fade .25s ease-out both }
.shell-sheet::backdrop { background: rgba(11, 11, 15, .45); backdrop-filter: blur(2px) }
@media (prefers-reduced-motion: reduce) {
  .shell-pop, .shell-bar, .shell-sheet[open], .shell-sheet[open]::backdrop { animation: none !important }
}
`;

type Item = { href: string; label: string; short: string; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; badge: ReactNode; hint: string; group: "talk" | "grow" | "run" };

/** Online / Away / Offline as three tappable chips. `tone`: on the brand gradient, or on a plain surface. */
function AvailabilityChips({ tone, className }: { tone: "brand" | "surface"; className?: string }) {
  const { api, me, setMe, fail } = useSupportApp();
  const [error, setError] = useState<string | null>(null);
  const choose = async (availability: AgentMe["availability"]) => {
    if (availability === me.availability) return;
    const before = me;
    setMe({ ...me, availability });
    try {
      setMe(await api.setAvailability(availability));
      setError(null);
    } catch (err) {
      setMe(before);
      setError(fail(err));
    }
  };
  return (
    <div className={className}>
      <div role="radiogroup" aria-label="Your availability" className={cn("grid grid-cols-3 gap-1 rounded-2xl p-1", tone === "brand" ? "bg-black/15 dark:bg-white/[0.05]" : "bg-bg dark:bg-white/[0.05]")}>
        {AVAILABILITY.map((a) => {
          const on = me.availability === a.value;
          return (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(a.value)}
              className={cn(
                "relative flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-1 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2",
                tone === "brand" ? "focus-visible:ring-white/70" : "focus-visible:ring-pulse-blue/50",
                on
                  ? tone === "brand"
                    ? "shell-pop bg-white text-[#1f55d6] shadow-sm dark:bg-[linear-gradient(120deg,#2f6bff,#7b5cff)] dark:text-white"
                    : "shell-pop bg-surface text-text shadow-[0_1px_4px_rgba(0,0,0,0.12)] dark:bg-white/12"
                  : tone === "brand"
                    ? "text-white/88 hover:bg-white/10"
                    : "text-muted hover:text-text",
              )}
            >
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", a.dot)} />
              {a.label}
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="pt-1 text-[12px]">{error}</p>}
    </div>
  );
}

/** Watches the waiting and own lists: a chat that was not there before chimes (and notifies, when allowed). */
function useNewChatAlerts(onCount: (n: number) => void) {
  const { api, me, hub } = useSupportApp();
  const href = useSupportHref();
  const seen = useRef<Set<string> | null>(null);
  const { data } = useLiveQuery(
    async () => {
      const [waiting, mine] = await Promise.all([api.conversations("waiting"), api.conversations("mine")]);
      return [...waiting.items, ...mine.items.filter((m) => !waiting.items.some((w) => w.id === m.id))];
    },
    { topics: [STAFF_TOPICS.inbox, agentTopic(me.id)], key: "alerts" },
  );
  useEffect(() => {
    if (!data) return;
    onCount(data.filter((c) => c.status === "WAITING").length);
    const ids = new Set(data.map((c) => c.id));
    if (seen.current) {
      const fresh = data.filter((c) => !seen.current!.has(c.id) && c.status !== "CLOSED");
      for (const c of fresh.slice(0, 3)) alertAgent(c.status === "WAITING" ? `${c.visitorName} needs a person` : `New chat: ${c.visitorName}`, c.preview, `${href("/")}?c=${c.id}`);
    }
    seen.current = ids;
  }, [data, href, onCount]);
  // Locked from Admin: signed out at once.
  useEffect(
    () =>
      hub.subscribe([agentTopic(me.id)], (e) => {
        if (e.type === "agent.force_logout") window.location.assign(href("/sign-in?error=locked"));
      }),
    [hub, me.id, href],
  );
}

/** Live visitors in the sidebar: re-counted every minute while the tab is visible (the page itself is live). */
function useVisitorCount(): number | null {
  const { api } = useSupportApp();
  const visible = usePageVisible();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!visible) return;
    const load = () =>
      api
        .liveVisitors()
        .then((r) => setCount(r.items.length))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [api, visible]);
  return count;
}

const GROUPS: { key: Item["group"]; label: string }[] = [
  { key: "talk", label: "Talk to people" },
  { key: "grow", label: "Understand and grow" },
  { key: "run", label: "Run the service" },
];

function SignOut({ preview, className, children }: { preview: boolean; className: string; children: ReactNode }) {
  return (
    <form action={preview ? undefined : signOutAgent}>
      <button type="submit" disabled={preview} aria-label="Sign out" title="Sign out" className={className}>
        {children}
      </button>
    </form>
  );
}

/** The phone tab bar: the four main sections and More. Hidden while a chat is open (?c= on Chats). */
function TabBar({ tabs, moreItems, isActive, onMore, readChat }: { tabs: Item[]; moreItems: Item[]; isActive: (h: string) => boolean; onMore: () => void; readChat: boolean }) {
  return readChat ? <TabBarWithChat tabs={tabs} moreItems={moreItems} isActive={isActive} onMore={onMore} /> : <TabBarView tabs={tabs} moreItems={moreItems} isActive={isActive} onMore={onMore} hidden={false} />;
}

function TabBarWithChat(props: { tabs: Item[]; moreItems: Item[]; isActive: (h: string) => boolean; onMore: () => void }) {
  const params = useSearchParams();
  // On Chats (also /preview/chats, which isActive does not match as the root) with a chat open.
  const elsewhere = [...props.tabs.slice(1), ...props.moreItems].some((i) => props.isActive(i.href));
  const hidden = !elsewhere && !!params.get("c");
  return <TabBarView {...props} hidden={hidden} />;
}

function TabBarView({ tabs, moreItems, isActive, onMore, hidden }: { tabs: Item[]; moreItems: Item[]; isActive: (h: string) => boolean; onMore: () => void; hidden: boolean }) {
  if (hidden) return null;
  const moreOn = moreItems.some((i) => isActive(i.href));
  return (
    <>
      {/* Keeps the page's end clear of the fixed bar. */}
      <div aria-hidden className="h-[calc(76px+env(safe-area-inset-bottom))] shrink-0 lg:hidden" />
      <TabBarNav tabs={tabs} isActive={isActive} onMore={onMore} moreOn={moreOn} />
    </>
  );
}

function TabBarNav({ tabs, isActive, onMore, moreOn }: { tabs: Item[]; isActive: (h: string) => boolean; onMore: () => void; moreOn: boolean }) {
  const cell = "relative flex min-h-[58px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-blue/50";
  return (
    <nav aria-label="Main sections" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/92 px-1.5 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 shadow-[0_-10px_30px_-20px_rgba(17,24,39,0.35)] backdrop-blur-xl lg:hidden">
      <ul className="mx-auto flex max-w-lg items-stretch gap-1">
        {tabs.map((t) => {
          const on = isActive(t.href);
          return (
            <li key={t.label} className="flex min-w-0 flex-1">
              <Link href={t.href} aria-current={on ? "page" : undefined} className={cn(cell, on ? "text-pulse-blue dark:text-[#8db0ff]" : "text-muted")}>
                <span className={cn("relative inline-flex h-8 w-14 items-center justify-center rounded-full", on && "shell-pop bg-pulse-blue/12 dark:bg-pulse-blue/25")}>
                  <t.icon aria-hidden className="size-[21px]" />
                  {t.badge && <span className="absolute -right-0.5 -top-1">{t.badge}</span>}
                </span>
                <span className="max-w-full truncate">{t.short}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex min-w-0 flex-1">
          <button type="button" onClick={onMore} aria-haspopup="dialog" className={cn(cell, "cursor-pointer", moreOn ? "text-pulse-blue dark:text-[#8db0ff]" : "text-muted")}>
            <span className={cn("relative inline-flex h-8 w-14 items-center justify-center rounded-full", moreOn && "shell-pop bg-pulse-blue/12 dark:bg-pulse-blue/25")}>
              <Ellipsis aria-hidden className="size-[21px]" />
            </span>
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** The phone's More sheet: the other sections, availability, alerts, install, theme and sign out. */
function MoreSheet({ dialog, moreItems, isActive, preview, roleText }: { dialog: RefObject<HTMLDialogElement | null>; moreItems: Item[]; isActive: (h: string) => boolean; preview: boolean; roleText: string }) {
  const { me } = useSupportApp();
  const close = () => dialog.current?.close();
  return (
    <dialog
      ref={dialog}
      aria-label="More"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="shell-sheet m-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-[26px] border-0 bg-surface p-0 text-text shadow-2xl backdrop:bg-transparent lg:hidden"
    >
      <div className="flex flex-col gap-4 p-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        <span aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <div className="flex items-center gap-3">
          <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[14px] font-bold text-white">{initials(me.name)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-bold">{me.name}</span>
            <span className="truncate text-[12.5px] text-muted">{roleText}</span>
          </span>
          <button type="button" onClick={close} aria-label="Close" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full bg-bg hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-blue/50 dark:bg-white/[0.06]">
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Your status</p>
          <AvailabilityChips tone="surface" />
        </div>

        {moreItems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">More pages</p>
            <ul className="grid grid-cols-1 gap-2">
              {moreItems.map((i) => {
                const on = isActive(i.href);
                return (
                  <li key={i.label}>
                    <Link
                      href={i.href}
                      onClick={close}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "relative flex min-h-14 items-center gap-3 rounded-2xl border-2 p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30",
                        on ? "border-pulse-blue bg-pulse-blue/[0.07] dark:bg-pulse-blue/15" : "border-line hover:border-pulse-blue/40",
                      )}
                    >
                      <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", on ? "bg-brand-gradient text-white" : "bg-soft text-text")}>
                        <i.icon aria-hidden className="size-5" />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[15px] font-semibold">{i.label}</span>
                        <span className="text-[12.5px] text-muted">{i.hint}</span>
                      </span>
                      {on && (
                        <span aria-hidden className="ml-auto inline-flex size-6 items-center justify-center rounded-full bg-pulse-blue text-white">
                          <Check className="size-3.5" strokeWidth={3} />
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-1 rounded-2xl bg-[linear-gradient(140deg,#2f6bff,#7b5cff)] p-2 text-white dark:bg-none dark:bg-[#17171f]">
          <AlertsButton className="px-1" />
          <InstallApp className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-[13px] font-semibold hover:bg-white/15" />
          <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-1 text-[13px] font-semibold">
            Light or dark look
            <ThemeToggle className="size-10 border-white/20 bg-white/15 text-white shadow-none dark:bg-white/[0.06]" />
          </div>
          <SignOut preview={preview} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-[13px] font-semibold hover:bg-white/15 disabled:cursor-default disabled:opacity-70">
            <LogOut aria-hidden className="size-4" /> Sign out
          </SignOut>
        </div>
      </div>
    </dialog>
  );
}

export function SupportShell({ children }: { children: ReactNode }) {
  const { me, preview } = useSupportApp();
  const href = useSupportHref();
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);
  const sheet = useRef<HTMLDialogElement>(null);
  useNewChatAlerts(setWaiting);
  const visitors = useVisitorCount();
  const supervisor = me.role === "SUPERVISOR";
  const waitingBadge = waiting ? (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#c81e3a] px-1.5 py-px text-[11px] font-bold text-white shadow-sm" aria-label={`${waiting} waiting`}>
      {waiting}
    </span>
  ) : null;
  const visitorBadge = (tone: "brand" | "tab") =>
    visitors != null ? (
      <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-px text-[11px] font-semibold", tone === "brand" ? "bg-white/20" : "bg-[#0ca30c] text-white shadow-sm")} aria-label={`${visitors} live now`}>
        {visitors}
      </span>
    ) : null;
  // Who sees what is unchanged: Stats for supervisors, Server for technical staff and supervisors, Team for the owner.
  const items: Item[] = [
    { href: href("/"), label: "Chats", short: "Chats", icon: MessagesSquare, badge: waitingBadge, hint: "Answer people", group: "talk" },
    { href: href("/visitors"), label: "Live visitors", short: "Visitors", icon: Users, badge: visitorBadge("brand"), hint: "Who is on the site now", group: "talk" },
    { href: href("/analytics"), label: "Analytics", short: "Analytics", icon: LineChart, badge: null, hint: "Visitors over time", group: "grow" },
    { href: href("/links"), label: "Links", short: "Links", icon: Link2, badge: null, hint: "Tracked links and what they bring", group: "grow" },
    ...(supervisor ? [{ href: href("/stats"), label: "Stats", short: "Stats", icon: BarChart3, badge: null, hint: "How the team answers chats", group: "grow" as const }] : []),
    ...(canSeeMonitoring(me.role) ? [{ href: href("/server"), label: "Server", short: "Server", icon: Server, badge: null, hint: "Is the site up, and the PC", group: "run" as const }] : []),
    ...(me.owner ? [{ href: href("/team"), label: "Team", short: "Team", icon: UserPlus, badge: null, hint: "Join requests and the team", group: "run" as const }] : []),
  ];
  const tabs = items.slice(0, 4).map((t) => (t.label === "Live visitors" ? { ...t, badge: visitorBadge("tab") } : t));
  const moreItems = items.slice(4);
  const isActive = (h: string) => {
    const path = pathname.replace(/\/$/, "") || "/";
    const target = h.replace(/\/$/, "") || "/";
    return path === target || (target !== href("/").replace(/\/$/, "") && path.startsWith(`${target}/`));
  };
  const deps = me.departments.map((d) => DEPARTMENT_NAMES[d]).join(", ");
  const roleText = `${supervisor ? "Supervisor" : me.role === "TECH" ? "Technical support" : "Agent"}${deps ? ` · ${deps}` : ""}`;
  const current = AVAILABILITY.find((a) => a.value === me.availability) ?? AVAILABILITY[2];

  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:flex-row">
      <style href="bp-support-shell" precedence="default">{CSS}</style>

      {/* Phone: a slim top bar. */}
      <header className="flex items-center justify-between gap-2 bg-[linear-gradient(165deg,#2f6bff,#7b5cff)] px-3.5 py-2.5 text-white lg:hidden dark:bg-none dark:bg-[#111117] dark:border-b dark:border-white/10">
        <SupportBrand />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => sheet.current?.showModal()}
            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full bg-white/16 px-3 text-[12.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 dark:bg-white/[0.06]"
            aria-label={`Your availability: ${current.label}. Change it`}
          >
            <span aria-hidden className={cn("size-2 rounded-full", current.dot)} />
            {current.label}
          </button>
          <ThemeToggle className="size-10 border-white/20 bg-white/15 text-white shadow-none dark:bg-white/[0.06]" />
        </div>
      </header>

      {/* Computer: the sidebar. */}
      {/* The gradient fills the whole page height (however long the page); the contents stay put while it scrolls. */}
      <nav aria-label="Support app" className="hidden shrink-0 self-stretch bg-[linear-gradient(165deg,#2f6bff,#7b5cff)] text-white lg:block lg:w-[240px] dark:bg-none dark:bg-[#111117] dark:lg:border-r dark:lg:border-white/10">
      <div className="flex flex-col gap-1.5 px-3.5 py-5 lg:sticky lg:top-0 lg:h-dvh">
        <div className="flex items-center justify-between gap-2 px-1.5 pb-4">
          <SupportBrand />
        </div>
        <p className="px-1.5 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white/70">Your status</p>
        <AvailabilityChips tone="brand" className="mb-3" />
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {GROUPS.map((g) => {
            const list = items.filter((i) => i.group === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className="flex flex-col gap-1">
                <p className="px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-white/70">{g.label}</p>
                <ul className="flex flex-col gap-0.5">
                  {list.map((i) => {
                    const on = isActive(i.href);
                    return (
                      <li key={i.label}>
                        <Link
                          href={i.href}
                          aria-current={on ? "page" : undefined}
                          className={cn(
                            "group relative flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                            on ? "shell-pop bg-white font-semibold text-[#1f55d6] shadow-[0_8px_20px_-12px_rgba(0,0,0,0.45)] dark:bg-[linear-gradient(120deg,#2f6bff,#7b5cff)] dark:text-white" : "text-white/92 hover:bg-white/12",
                          )}
                        >
                          {on && <span aria-hidden className="shell-bar absolute -left-3.5 top-2 bottom-2 w-1 rounded-r-full bg-white" />}
                          <span className="flex items-center gap-2.5">
                            <i.icon aria-hidden className="size-[18px] transition-transform duration-200 group-hover:scale-110 motion-reduce:transform-none" />
                            {i.label}
                          </span>
                          {i.badge}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-col gap-1">
          <AlertsButton className="text-white" />
          <InstallApp className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-[13px] font-semibold hover:bg-white/15" />
          <div className="flex items-center gap-2.5 border-t border-white/30 px-1.5 pt-3 dark:border-white/10">
            <span aria-hidden className="relative inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-white/25 text-[13px] font-bold dark:bg-[linear-gradient(120deg,#2f6bff,#7b5cff)]">
              {initials(me.name)}
              <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[#5a63ff] dark:border-[#111117]", current.dot)} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-semibold">{me.name}</span>
              <span className="truncate text-xs text-white/88">{roleText}</span>
            </span>
            <SignOut preview={preview} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-xl hover:bg-white/15 disabled:cursor-default">
              <LogOut aria-hidden className="size-4" />
            </SignOut>
          </div>
          <ThemeToggle className="mt-1 size-10 self-start border-white/20 bg-white/15 text-white shadow-none dark:bg-white/[0.06]" />
        </div>
      </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>

      <Suspense fallback={<TabBar tabs={tabs} moreItems={moreItems} isActive={isActive} onMore={() => sheet.current?.showModal()} readChat={false} />}>
        <TabBar tabs={tabs} moreItems={moreItems} isActive={isActive} onMore={() => sheet.current?.showModal()} readChat />
      </Suspense>
      <MoreSheet dialog={sheet} moreItems={moreItems} isActive={isActive} preview={preview} roleText={roleText} />
    </div>
  );
}
