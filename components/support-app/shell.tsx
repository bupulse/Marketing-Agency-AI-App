"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, ChevronDown, LogOut, MessagesSquare, Users } from "lucide-react";
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

// The support app's frame: the sidebar (the brand gradient in light mode, a dark tone with gradient accents in dark
// mode, owner 23 Oct), the availability switch and the alerts. On a phone the sidebar becomes a bar at the top.

const AVAILABILITY: { value: AgentMe["availability"]; label: string; dot: string }[] = [
  { value: "online", label: "Online", dot: "bg-[#7dffc4]" },
  { value: "away", label: "Away", dot: "bg-[#ffd27d]" },
  { value: "offline", label: "Offline", dot: "bg-white/50" },
];

function AvailabilitySwitch({ className }: { className?: string }) {
  const { api, me, setMe, fail } = useSupportApp();
  const [error, setError] = useState<string | null>(null);
  const current = AVAILABILITY.find((a) => a.value === me.availability) ?? AVAILABILITY[2];
  return (
    <div className={className}>
      <label className="relative flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/16 px-3 text-sm font-semibold dark:border-white/10 dark:bg-white/[0.06]">
        <span aria-hidden className={cn("size-[9px] shrink-0 rounded-full", current.dot)} />
        <span className="sr-only">Your availability</span>
        <select
          value={me.availability}
          onChange={async (e) => {
            const availability = e.target.value as AgentMe["availability"];
            const before = me;
            setMe({ ...me, availability });
            try {
              setMe(await api.setAvailability(availability));
              setError(null);
            } catch (err) {
              setMe(before);
              setError(fail(err));
            }
          }}
          className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-6 font-semibold text-inherit outline-none [&>option]:text-graphite"
        >
          {AVAILABILITY.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 size-3.5" />
      </label>
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

export function SupportShell({ children }: { children: ReactNode }) {
  const { me, preview } = useSupportApp();
  const href = useSupportHref();
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);
  useNewChatAlerts(setWaiting);
  const visitors = useVisitorCount();
  const supervisor = me.role === "SUPERVISOR";
  const items = [
    { href: href("/"), label: "Chats", icon: MessagesSquare, badge: waiting ? <span className="rounded-full bg-[#c81e3a] px-2 py-px text-xs font-semibold text-white" aria-label={`${waiting} waiting`}>{waiting}</span> : null },
    { href: href("/visitors"), label: "Live visitors", icon: Users, badge: visitors != null ? <span className="text-xs opacity-90">{visitors}</span> : null },
    ...(supervisor ? [{ href: href("/stats"), label: "Stats", icon: BarChart3, badge: null }] : []),
  ];
  const isActive = (h: string) => {
    const path = pathname.replace(/\/$/, "") || "/";
    const target = h.replace(/\/$/, "") || "/";
    return path === target || (target !== href("/").replace(/\/$/, "") && path.startsWith(`${target}/`));
  };
  const deps = me.departments.map((d) => DEPARTMENT_NAMES[d]).join(", ");

  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:flex-row">
      <nav aria-label="Support app" className="flex shrink-0 flex-col gap-1.5 bg-[linear-gradient(165deg,#2f6bff,#7b5cff)] px-3.5 py-3 text-white lg:sticky lg:top-0 lg:h-dvh lg:w-[232px] lg:py-5 dark:bg-none dark:bg-[#111117] dark:lg:border-r dark:lg:border-white/10">
        <div className="flex items-center justify-between gap-2 px-1.5 lg:pb-4">
          <SupportBrand />
          <ThemeToggle className="size-10 border-white/20 bg-white/15 text-white shadow-none lg:hidden dark:bg-white/[0.06]" />
        </div>
        <AvailabilitySwitch className="lg:mb-2.5" />
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {items.map((i) => {
            const on = isActive(i.href);
            return (
              <li key={i.label} className="shrink-0">
                <Link
                  href={i.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-sm",
                    on ? "bg-white font-semibold text-[#1f55d6] dark:bg-[linear-gradient(120deg,#2f6bff,#7b5cff)] dark:text-white" : "text-white/92 hover:bg-white/12",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <i.icon aria-hidden className="size-4" />
                    {i.label}
                  </span>
                  {i.badge}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto hidden flex-col gap-1 lg:flex">
          <AlertsButton className="text-white" />
          <InstallApp className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-[13px] font-semibold hover:bg-white/15" />
          <div className="flex items-center gap-2.5 border-t border-white/30 px-1.5 pt-3 dark:border-white/10">
            <span aria-hidden className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-white/25 text-[13px] font-bold dark:bg-[linear-gradient(120deg,#2f6bff,#7b5cff)]">{initials(me.name)}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-semibold">{me.name}</span>
              <span className="truncate text-xs text-white/88">{supervisor ? "Supervisor" : "Agent"}{deps ? ` · ${deps}` : ""}</span>
            </span>
            <form action={preview ? undefined : signOutAgent}>
              <button type="submit" disabled={preview} aria-label="Sign out" title="Sign out" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-xl hover:bg-white/15">
                <LogOut aria-hidden className="size-4" />
              </button>
            </form>
          </div>
          <ThemeToggle className="mt-1 size-10 self-start border-white/20 bg-white/15 text-white shadow-none dark:bg-white/[0.06]" />
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {children}
        <details className="border-t border-line bg-surface px-4 py-2 text-sm lg:hidden">
          <summary className="min-h-11 cursor-pointer py-2.5 font-medium">{me.name} · alerts and sign out</summary>
          <div className="flex flex-col gap-1 rounded-2xl bg-[linear-gradient(165deg,#2f6bff,#7b5cff)] p-2 text-white dark:bg-none dark:bg-[#111117]">
            <AlertsButton />
            <InstallApp className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-[13px] font-semibold hover:bg-white/15" />
            <form action={preview ? undefined : signOutAgent}>
              <button type="submit" disabled={preview} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-[13px] font-semibold hover:bg-white/15">
                <LogOut aria-hidden className="size-4" /> Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}
