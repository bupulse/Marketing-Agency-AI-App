"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";
import { Clock, Coffee, Eye, FileStack, Globe2, Hourglass, LayoutDashboard, Link2, MessageCircle, MessagesSquare, Monitor, Repeat, Smartphone, Sparkles, Star, Users } from "lucide-react";
import { Button, Dialog, Field, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { STAFF_TOPICS, SURFACES, type LiveVisitor, type Surface } from "@/lib/support/contract";
import type { VisitorGroup } from "@/lib/support/app-client/api";
import { HOT_LEAD, SURFACE_NAMES, VISITOR_GROUPS, filterVisitors, minutesOnSite, visitorAction, visitorCounts } from "@/lib/support/app-client/lists";
import { useSupportApp } from "./app-context";
import { useSupportHref } from "./base";
import { flagEmoji, placeLabel } from "./chat/helpers";
import { Avatar } from "./chat/message";
import { ChatStyles, LiveDot, TypingDots } from "./chat/styles";
import { useLiveQuery } from "./use-live";

const KIND: Record<LiveVisitor["kind"], string> = { visitor: "Visitor", client: "Client", creator: "Creator" };
const KIND_TONE: Record<LiveVisitor["kind"], string> = {
  visitor: "bg-black/[0.05] text-muted dark:bg-white/[0.08]",
  client: "bg-ok-bg text-ok",
  creator: "bg-new-bg text-new",
};

type GroupKey = "all" | VisitorGroup;
const GROUP_LOOK: Record<GroupKey, { icon: ComponentType<{ className?: string }>; dot: string; short: string; hint: string }> = {
  all: { icon: Users, dot: "bg-pulse-blue", short: "All", hint: "Everyone on BuPulse right now." },
  waiting: { icon: Hourglass, dot: "bg-danger", short: "Waiting", hint: "They asked for a person and nobody has answered yet. Open these first." },
  chatting: { icon: MessagesSquare, dot: "bg-pulse-blue", short: "Chatting", hint: "In a chat now, with the AI or one of the team." },
  browsing: { icon: Eye, dot: "bg-success", short: "Browsing", hint: "Looking around, not chatting. Start a chat to help them." },
  idle: { icon: Coffee, dot: "bg-muted", short: "Idle", hint: "The page is open but they have not moved for a while." },
};

const SURFACE_ICON: Record<"all" | Surface, ComponentType<{ className?: string }>> = { all: Globe2, public: Globe2, dashboard: LayoutDashboard, creator: Sparkles, bio: Link2 };

function Status({ v }: { v: LiveVisitor }) {
  if (v.typing)
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-new">
        <TypingDots className="shrink-0 scale-75" />
        <span className="truncate italic">“{v.typing}”</span>
        <span className="sr-only">is typing</span>
      </span>
    );
  if (v.group === "waiting") return <span className="text-[12.5px] font-semibold text-danger">Waiting for a person</span>;
  if (v.group === "chatting") return <span className="text-[12.5px] text-ok">Chatting</span>;
  if (v.group === "idle") return <span className="text-[12.5px] text-muted">Idle</span>;
  return <span className="text-[12.5px] text-success">Browsing</span>;
}

function Action({ v, onStart }: { v: LiveVisitor; onStart: (v: LiveVisitor) => void }) {
  const href = useSupportHref();
  const action = visitorAction(v);
  const cls = "inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-px active:translate-y-0 motion-reduce:transform-none";
  if (!action) return <span className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-soft text-[12.5px] text-muted">Idle: nothing to do yet</span>;
  if (action === "start")
    return (
      <button type="button" className={cn(cls, "border border-line bg-surface hover:bg-ok-bg")} onClick={() => onStart(v)}>
        <MessageCircle aria-hidden className="size-4" /> Start chat
      </button>
    );
  return (
    <Link
      href={`${href("/")}?c=${v.conversationId}`}
      className={cn(cls, action === "open" ? "bg-[#c81e3a] text-white shadow-[0_10px_22px_-12px_rgba(200,30,58,0.9)]" : "bg-brand-gradient text-white shadow-[0_10px_22px_-12px_rgba(47,107,255,0.9)]")}
    >
      <MessagesSquare aria-hidden className="size-4" /> {action === "open" ? "Open chat" : "Join chat"}
    </Link>
  );
}

function StartChat({ visitor, onClose }: { visitor: LiveVisitor | null; onClose: () => void }) {
  const { api, fail } = useSupportApp();
  const href = useSupportHref();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={!!visitor} onOpenChange={(o) => !o && onClose()} title={visitor ? `Start a chat with ${visitor.name}` : "Start a chat"} description="Your message opens the chat on their screen. Keep it short and friendly.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!visitor) return;
          const text = String(new FormData(e.currentTarget).get("text") ?? "").trim();
          if (!text) return;
          setPending(true);
          try {
            const { conversationId } = await api.inviteVisitor(visitor.visitorId, text);
            onClose();
            router.push(`${href("/")}?c=${conversationId}`);
          } catch (err) {
            toast(fail(err), "error");
          } finally {
            setPending(false);
          }
        }}
      >
        <Field label="Your first message">
          <Textarea name="text" rows={3} maxLength={2000} required defaultValue={visitor?.currentPath?.startsWith("/pricing") ? "Hi! Can I help you choose a plan?" : "Hi! I’m from the BuPulse team. Can I help with anything?"} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Starting…" : "Start chat"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Fact({ icon: Icon, label, value }: { icon: ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl bg-black/[0.035] px-1.5 py-2 text-center dark:bg-white/[0.06]">
      <Icon aria-hidden className="size-3.5 text-muted" />
      <span className="truncate text-[13px] font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
}

function VisitorCard({ v, onStart }: { v: LiveVisitor; onStart: (v: LiveVisitor) => void }) {
  const place = placeLabel(v.city, v.country);
  const phone = /android|iphone|phone/i.test(v.device ?? "");
  const hot = v.kind === "visitor" && v.leadScore != null && v.leadScore >= HOT_LEAD;
  return (
    <li
      className={cn(
        "relative flex flex-col gap-3 overflow-hidden rounded-[22px] border bg-surface p-4 shadow-[0_14px_36px_-30px_rgba(17,24,39,0.6)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-26px_rgba(17,24,39,0.55)] motion-reduce:transform-none",
        v.group === "waiting" ? "border-danger/40 ring-4 ring-danger/10" : "border-line",
        v.group === "idle" && "opacity-75",
      )}
    >
      <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-1", v.group === "waiting" ? "bg-danger" : v.group === "chatting" ? "bg-brand-gradient" : v.group === "browsing" ? "bg-success/70" : "bg-line")} />
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          <Avatar name={v.name} className="size-11 text-[14px]" />
          <span aria-hidden className="absolute -bottom-1 -right-1.5 text-[18px] leading-none drop-shadow-sm" title={place ?? undefined}>{flagEmoji(v.country)}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <strong className="truncate text-[15px]">{v.name}</strong>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", KIND_TONE[v.kind])}>{KIND[v.kind]}</span>
          </span>
          <Status v={v} />
          <span className="truncate text-[12px] text-muted">{place ? `${place} (about)` : "Somewhere"}</span>
        </span>
        {hot ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-new-bg px-2 py-1 text-[11.5px] font-bold text-new" title="Lead score: how likely they are to buy">
            <Star aria-hidden className="size-3.5 fill-current" /> {v.leadScore} hot
          </span>
        ) : v.kind === "visitor" && v.leadScore != null ? (
          <span className="shrink-0 rounded-full bg-soft px-2 py-1 text-[11.5px] font-semibold tabular-nums text-muted" title="Lead score: how likely they are to buy">Score {v.leadScore}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 rounded-2xl border border-line bg-black/[0.02] px-3 py-2 dark:bg-white/[0.04]">
        <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.05em] text-muted">
          {v.group === "idle" ? <span aria-hidden className="size-2 rounded-full bg-muted" /> : <LiveDot className={v.group === "waiting" ? "bg-danger" : "bg-success"} />}
          NOW ON
        </span>
        <span className="truncate font-mono text-[13px] font-medium" title={v.currentPath ?? undefined}>{v.currentPath ?? "–"}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Fact icon={Clock} label="on site" value={minutesOnSite(v.secondsOnSite)} />
        <Fact icon={FileStack} label={v.pageCount === 1 ? "page" : "pages"} value={String(v.pageCount)} />
        <Fact icon={Repeat} label={v.visitCount === 1 ? "visit" : "visits"} value={String(v.visitCount)} />
      </div>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1">
          <Globe2 aria-hidden className="size-3.5" /> from {v.referrer ?? "direct"}
        </span>
        {(v.device || v.browser) && (
          <span className="inline-flex items-center gap-1">
            {phone ? <Smartphone aria-hidden className="size-3.5" /> : <Monitor aria-hidden className="size-3.5" />}
            {[v.device, v.browser].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <Action v={v} onStart={onStart} />
    </li>
  );
}

/**
 * Live visitors: who is on BuPulse now, as cards (flag, where they are now, time on site), with chip filters by group
 * and by part of the site, and Start chat / Open chat / Join chat. The feed is live while the tab is visible and is
 * dropped while it is hidden (no socket, no polling).
 */
export function VisitorsView() {
  const { api } = useSupportApp();
  const [group, setGroup] = useState<GroupKey>("all");
  const [surface, setSurface] = useState<"all" | Surface>("all");
  const [start, setStart] = useState<LiveVisitor | null>(null);
  const { data, error } = useLiveQuery(() => api.liveVisitors(), { topics: [STAFF_TOPICS.visitors], key: "visitors", pauseWhenHidden: true });
  const items = data?.items ?? [];
  const counts = visitorCounts(items, surface);
  const rows = filterVisitors(items, group, surface);
  const surfaces: ("all" | Surface)[] = ["all", ...SURFACES];

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <ChatStyles />
      <header className="relative overflow-hidden rounded-[24px] border border-line bg-surface p-4 shadow-[0_24px_60px_-40px_rgba(17,24,39,0.45)] sm:p-5">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_24px_-12px_rgba(47,107,255,0.9)]">
            <Users aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-bold tracking-[-0.02em]">Live visitors</h1>
            <p className="text-sm text-muted">
              {data ? (
                <>
                  <span className="mr-1.5 inline-flex align-middle">
                    <LiveDot />
                  </span>
                  <strong className="text-text">{items.length}</strong> {items.length === 1 ? "person" : "people"} on BuPulse right now · updates live
                </>
              ) : (
                (error ?? "Loading…")
              )}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-[12px] font-bold tracking-[0.05em] text-muted">WHERE ON BUPULSE</span>
          <div role="radiogroup" aria-label="Where on BuPulse" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 pt-0.5">
            {surfaces.map((s) => {
              const on = surface === s;
              const Icon = SURFACE_ICON[s];
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSurface(s)}
                  className={cn(
                    "inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                    on ? "border-pulse-blue bg-pulse-blue/[0.08] text-ok dark:bg-pulse-blue/15" : "border-line bg-surface hover:bg-soft",
                  )}
                >
                  <Icon className="size-4" />
                  {s === "all" ? "Everywhere" : SURFACE_NAMES[s]}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <section aria-label="Groups" className="flex flex-col gap-2">
        <div role="tablist" aria-label="Visitor groups" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-1 md:grid md:grid-cols-5 md:overflow-visible">
          {VISITOR_GROUPS.map((g) => {
            const on = group === g.value;
            const look = GROUP_LOOK[g.value];
            const alarm = g.value === "waiting" && counts.waiting > 0;
            return (
              <button
                key={g.value}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={`${g.label}: ${counts[g.value]}`}
                onClick={() => setGroup(g.value)}
                className={cn(
                  "relative flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 motion-reduce:transform-none md:flex-col md:items-start md:gap-1 md:p-3.5",
                  on
                    ? "border-pulse-blue bg-pulse-blue/[0.07] shadow-[0_8px_24px_-12px_rgba(47,107,255,0.55)] dark:bg-pulse-blue/15"
                    : alarm
                      ? "border-danger/40 bg-danger-bg"
                      : "border-line bg-surface hover:border-pulse-blue/40",
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  {alarm ? <LiveDot className="bg-danger" /> : <span aria-hidden className={cn("size-2 rounded-full", look.dot)} />}
                  <span className="md:hidden">{look.short}</span>
                  <span className="hidden md:inline">{g.label}</span>
                </span>
                <span key={counts[g.value]} className={cn("sc-pop text-[15px] font-bold tabular-nums md:text-[26px] md:leading-none", alarm && "text-danger")}>{counts[g.value]}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[13px] text-muted">{GROUP_LOOK[group].hint}</p>
      </section>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[22px] border border-dashed border-line bg-surface px-4 py-10 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-soft text-ok">
            {data ? <Users aria-hidden className="size-5" /> : <TypingDots />}
          </span>
          <p className="text-sm text-muted">{data ? "Nobody in this group right now." : "Loading…"}</p>
        </div>
      ) : (
        <ul key={`${group}:${surface}`} className="sc-stagger grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((v) => (
            <VisitorCard key={v.visitId} v={v} onStart={setStart} />
          ))}
        </ul>
      )}
      <p className="text-[12.5px] text-muted">Locations are approximate. IP addresses are kept 30 days, then only the country.</p>
      <StartChat visitor={start} onClose={() => setStart(null)} />
    </main>
  );
}
