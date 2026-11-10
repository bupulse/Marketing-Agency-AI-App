"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Bot, CalendarDays, CalendarRange, Check, Clock, Hand, HeartHandshake, MessagesSquare, Sparkles, Sun, Timer, UserPlus, Users, Hourglass, ArrowLeftRight, Eye, Scale } from "lucide-react";
import { cn } from "@/lib/cn";
import { STAFF_TOPICS } from "@/lib/support/contract";
import { DEPARTMENT_NAMES, waitingTimer } from "@/lib/support/app-client/lists";
import { useSupportApp } from "./app-context";
import { useSupportHref } from "./base";
import { changePct, pointsChange } from "./charts/chart-math";
import { ChartStyles } from "./charts/chart-styles";
import { Dumbbell } from "./charts/dumbbell";
import { RingGauge } from "./charts/ring-gauge";
import { StatTile, type Delta } from "./charts/stat-tile";
import { useLiveQuery, useNow } from "./use-live";

// Supervisors' stats: a period (tiles to tap), the period's numbers against the same number of days before, how the AI
// and the team share the work, the team right now (filter by status; Reassign and Read live for chats that wait), and
// the knowledge gaps (coming soon). Every number says in one line what it means.

const DAY = 24 * 60 * 60 * 1000;
const PERIODS: { value: string; label: string; hint: string; icon: ReactNode }[] = [
  { value: "1", label: "Today", hint: "The last 24 hours", icon: <Sun className="size-[18px]" /> },
  { value: "7", label: "Last 7 days", hint: "A week back", icon: <Clock className="size-[18px]" /> },
  { value: "30", label: "Last 30 days", hint: "About a month", icon: <CalendarDays className="size-[18px]" /> },
  { value: "90", label: "Last 90 days", hint: "About three months", icon: <CalendarRange className="size-[18px]" /> },
];
const STATUSES = [
  { value: "all", label: "Everyone" },
  { value: "online", label: "Online" },
  { value: "away", label: "Away" },
  { value: "offline", label: "Offline" },
] as const;
type StatusFilter = (typeof STATUSES)[number]["value"];

const STATUS_STYLE: Record<string, { dot: string; pill: string; label: string }> = {
  online: { dot: "bg-[#0f9f6e]", pill: "bg-[#0f9f6e]/10 text-[#0f7a4a] dark:bg-[#5fd9a0]/12 dark:text-[#5fd9a0]", label: "Online" },
  away: { dot: "bg-[#d97706]", pill: "bg-[#d97706]/10 text-[#b45309] dark:bg-[#ffc65c]/12 dark:text-[#ffc65c]", label: "Away" },
  offline: { dot: "bg-[#9ca3af]", pill: "bg-soft text-muted", label: "Offline" },
};

const tile = (on: boolean) =>
  cn(
    "group relative flex items-center gap-2.5 rounded-2xl border-2 p-3 text-left outline-none transition-[transform,border-color,background-color,box-shadow] duration-200",
    "cursor-pointer focus-visible:ring-4 focus-visible:ring-pulse-blue/30 hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none",
    on
      ? "border-pulse-blue bg-pulse-blue/[0.07] shadow-[0_8px_24px_-12px_rgba(47,107,255,0.55)] dark:bg-pulse-blue/15"
      : "border-line bg-surface hover:border-pulse-blue/40 hover:shadow-[0_8px_20px_-14px_rgba(17,24,39,0.35)]",
  );

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

function Section({ id, title, what, icon, children, aside }: { id: string; title: string; what: ReactNode; icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4 rounded-[24px] border border-line bg-surface p-4 shadow-[0_24px_60px_-48px_rgba(17,24,39,0.5)] sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_24px_-12px_rgba(47,107,255,0.9)] [&>svg]:size-5">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 id={id} className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
            <p className="text-[13px] leading-snug text-muted">{what}</p>
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Ring({ value, label, what, color, count }: { value: number | null; label: string; what: string; color: string; count?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-2xl border border-line p-3.5 sm:flex-col sm:items-center sm:p-5 sm:text-center">
      <RingGauge value={value} label={label} color={color} size={112} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[14.5px] font-semibold">{label}</p>
        {count && <p className="text-[12.5px] font-semibold text-text/80">{count}</p>}
        <p className="text-[12.5px] leading-snug text-muted">{what}</p>
      </div>
    </div>
  );
}

export function StatsView({ hoursLabel }: { hoursLabel: string }) {
  const { api } = useSupportApp();
  const href = useSupportHref();
  const now = useNow(5000);
  const [days, setDays] = useState("7");
  const [status, setStatus] = useState<StatusFilter>("all");
  const stats = useLiveQuery(
    () => {
      const to = new Date();
      return api.stats(new Date(to.getTime() - Number(days) * DAY).toISOString(), to.toISOString());
    },
    { topics: [STAFF_TOPICS.presence], key: `stats:${days}` },
  );
  // The same number of days just before, for "up 12% on the 7 days before" (the same API, an earlier range).
  const before = useLiveQuery(
    () => {
      const to = new Date(Date.now() - Number(days) * DAY);
      return api.stats(new Date(to.getTime() - Number(days) * DAY).toISOString(), to.toISOString());
    },
    { topics: [], key: `stats-before:${days}` },
  );
  const waiting = useLiveQuery(() => api.conversations("waiting"), { topics: [STAFF_TOPICS.inbox], key: "stats-waiting" });
  const s = stats.data;
  const b = before.data;
  const n = Number(days);
  const against = n === 1 ? "vs the day before" : `vs the ${n} days before`;
  const periodName = PERIODS.find((p) => p.value === days)?.label.toLowerCase() ?? "";

  const countDelta = (nowV: number | null | undefined, beforeV: number | null | undefined, upIsGood: boolean): Delta | null => {
    const v = changePct(nowV, beforeV);
    return v == null ? null : { value: v, unit: "%", upIsGood, against };
  };
  const rateDelta = (nowV: number | null | undefined, beforeV: number | null | undefined, upIsGood: boolean): Delta | null => {
    const v = pointsChange(nowV, beforeV);
    return v == null ? null : { value: v, unit: "pts", upIsGood, against };
  };
  const about = (pctV: number | null | undefined, of: number | null | undefined) => (pctV == null || !of ? null : `About ${Math.round((pctV / 100) * of).toLocaleString("en-GB")} chats`);

  const agents = s?.agents ?? [];
  const counts = { all: agents.length, online: 0, away: 0, offline: 0 } as Record<StatusFilter, number>;
  for (const a of agents) if (a.availability in counts) counts[a.availability as StatusFilter]++;
  const shownAgents = status === "all" ? agents : agents.filter((a) => a.availability === status);
  const waitingItems = waiting.data?.items ?? [];

  return (
    <main className="bp-viz flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <ChartStyles />
      <header className="flex flex-col gap-1">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">Stats</h1>
        <p className="text-sm text-muted">How the website chat is doing: the AI, the team and the people who wrote in. Times count team hours only ({hoursLabel}).</p>
      </header>

      <div className="relative flex flex-col gap-2 overflow-hidden rounded-[24px] border border-line bg-surface p-4 shadow-[0_24px_60px_-44px_rgba(17,24,39,0.45)] sm:p-5">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <p className="text-[12px] font-bold tracking-[0.06em] text-muted">PERIOD</p>
        <div role="radiogroup" aria-label="Period" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {PERIODS.map((p) => {
            const on = days === p.value;
            return (
              <button key={p.value} type="button" role="radio" aria-checked={on} onClick={() => setDays(p.value)} className={tile(on)}>
                <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors", on ? "bg-brand-gradient text-white" : "bg-soft text-text")}>{p.icon}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14.5px] font-semibold leading-tight">{p.label}</span>
                  <span className="text-[12px] leading-snug text-muted">{p.hint}</span>
                </span>
                {on && (
                  <span aria-hidden className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-pulse-blue text-white shadow">
                    <Check className="size-3" strokeWidth={3.5} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {stats.error && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm text-danger">{stats.error}</p>}

      <div className={cn("grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 xl:grid-cols-3", !s && "opacity-60")} aria-busy={!s}>
        <StatTile
          key={`chats-${days}`}
          index={0}
          label="Chats"
          value={s?.chats ?? null}
          icon={<MessagesSquare />}
          tone="blue"
          delta={countDelta(s?.chats, b?.chats, true)}
          explain={`Conversations started on the website and the dashboard, ${periodName}.`}
        />
        <StatTile
          key={`ai-${days}`}
          index={1}
          label="Solved by AI alone"
          value={s?.aiSolvedPercent ?? null}
          format="pct"
          icon={<Bot />}
          tone="violet"
          delta={rateDelta(s?.aiSolvedPercent, b?.aiSolvedPercent, true)}
          explain="Of the chats the AI answered, the share it finished without needing a person."
        />
        <StatTile
          key={`hand-${days}`}
          index={2}
          label="Handed to a person"
          value={s?.handoverPercent ?? null}
          format="pct"
          icon={<Hand />}
          tone="orange"
          delta={rateDelta(s?.handoverPercent, b?.handoverPercent, false)}
          explain="Of all chats, the share passed to someone on the team. Lower means the AI coped on its own."
        />
        <StatTile
          key={`reply-${days}`}
          index={3}
          label="First human reply"
          value={s?.firstHumanReplySec ?? null}
          format="seconds"
          icon={<Timer />}
          tone="green"
          delta={countDelta(s?.firstHumanReplySec, b?.firstHumanReplySec, false)}
          explain="The usual (middle) wait for a person's first answer after a hand-over, in team hours. Faster is better."
        />
        <StatTile
          key={`good-${days}`}
          index={4}
          label="Rated good"
          value={s?.ratedGoodPercent ?? null}
          format="pct"
          icon={<HeartHandshake />}
          tone="pink"
          delta={rateDelta(s?.ratedGoodPercent, b?.ratedGoodPercent, true)}
          explain="Of the people who rated their chat, the share who tapped thumbs-up."
        />
        <StatTile
          key={`leads-${days}`}
          index={5}
          label="New leads"
          value={s?.newLeads ?? null}
          icon={<UserPlus />}
          tone="blue"
          delta={countDelta(s?.newLeads, b?.newLeads, true)}
          explain="People who left their name and number in the chat, ready to call back."
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Section id="share-h" title="Who handled the chats" icon={<Scale />} what="Three rates in pictures: how much the AI solved, how much needed the team, and how happy people were.">
          <div key={days} className="grid gap-3 sm:grid-cols-3">
            <Ring value={s?.aiSolvedPercent ?? null} label="Solved by AI alone" color="var(--viz-7)" what="Of the chats the AI answered" />
            <Ring value={s?.handoverPercent ?? null} label="Handed to a person" color="var(--viz-2)" count={about(s?.handoverPercent, s?.chats)} what="Of all chats" />
            <Ring value={s?.ratedGoodPercent ?? null} label="Rated good" color="var(--viz-3)" what="Of the chats that were rated" />
          </div>
        </Section>

        <Section id="compare-h" title={`Against ${n === 1 ? "the day" : `the ${n} days`} before`} icon={<ArrowLeftRight />} what="Each rate now (blue) and in the period before (grey ring). A line shows how far it moved.">
          <Dumbbell
            key={days}
            ariaLabel="Rates now and in the period before"
            beforeLabel={n === 1 ? "The day before" : `The ${n} days before`}
            nowLabel={PERIODS.find((p) => p.value === days)?.label ?? "Now"}
            rows={[
              { key: "ai", label: "Solved by AI alone", before: b?.aiSolvedPercent ?? null, now: s?.aiSolvedPercent ?? null, upIsGood: true },
              { key: "hand", label: "Handed to a person", before: b?.handoverPercent ?? null, now: s?.handoverPercent ?? null, upIsGood: false },
              { key: "good", label: "Rated good", before: b?.ratedGoodPercent ?? null, now: s?.ratedGoodPercent ?? null, upIsGood: true },
            ]}
          />
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section
          id="team-now"
          title="Team now"
          icon={<Users />}
          what="Who is on, how many chats each has open against their limit, and how their chats were rated in this period."
        >
          <div role="radiogroup" aria-label="Show people who are" className="flex flex-wrap gap-2">
            {STATUSES.map((st) => {
              const on = status === st.value;
              return (
                <button
                  key={st.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setStatus(st.value)}
                  className={cn(
                    "inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transition-none",
                    on ? "border-transparent bg-graphite text-white dark:bg-white dark:text-graphite" : "border-line bg-surface hover:border-pulse-blue/50 hover:bg-pulse-blue/5",
                  )}
                >
                  {st.value !== "all" && <span aria-hidden className={cn("size-2 rounded-full", STATUS_STYLE[st.value].dot)} />}
                  {on && st.value === "all" && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
                  {st.label}
                  <span className={cn("rounded-full px-1.5 text-[11.5px] tabular-nums", on ? "bg-white/20 dark:bg-graphite/15" : "bg-soft text-muted")}>{counts[st.value]}</span>
                </button>
              );
            })}
          </div>

          {shownAgents.length === 0 ? (
            <p className="rounded-2xl bg-soft px-4 py-5 text-center text-sm text-muted">{s ? "Nobody here right now." : "Loading the team…"}</p>
          ) : (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {shownAgents.map((a) => {
                const st = STATUS_STYLE[a.availability] ?? STATUS_STYLE.offline;
                const load = a.maxChats > 0 ? Math.min(100, (a.openChats / a.maxChats) * 100) : 0;
                const full = a.maxChats > 0 && a.openChats >= a.maxChats;
                return (
                  <li key={a.id} className="flex flex-col gap-3 rounded-2xl border border-line p-3.5 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-20px_rgba(17,24,39,0.45)] motion-reduce:transform-none motion-reduce:transition-none">
                    <div className="flex items-center gap-3">
                      <span className="relative">
                        <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-full bg-brand-gradient text-[13px] font-bold text-white">{initials(a.name)}</span>
                        <span aria-hidden className={cn("absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-[var(--viz-surface)]", st.dot)} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <strong className="truncate text-[14.5px]">{a.name}</strong>
                        <span className={cn("mt-0.5 inline-flex w-max items-center rounded-full px-2 py-0.5 text-[11.5px] font-bold", st.pill)}>{st.label}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-[18px] font-bold leading-none">{a.ratedGoodPercent == null ? "–" : `${Math.round(a.ratedGoodPercent)}%`}</span>
                        <span className="text-[11.5px] text-muted">rated good</span>
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between text-[12.5px]">
                        <span className="text-muted">Open chats</span>
                        <span className="tabular-nums">
                          <strong>{a.openChats}</strong> of {a.maxChats}
                          {full && <span className="ml-1.5 font-semibold text-danger">Full</span>}
                        </span>
                      </div>
                      <span
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={a.maxChats}
                        aria-valuenow={a.openChats}
                        aria-label={`${a.name}: ${a.openChats} of ${a.maxChats} chats open`}
                        className="block h-2 overflow-hidden rounded-full bg-[var(--viz-1)]/15"
                      >
                        <span className={cn("block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", full ? "bg-[var(--viz-8)]" : "bg-[var(--viz-1)]")} style={{ width: `${load}%` }} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          id="waiting-h"
          title="Waiting for a person"
          icon={<Hourglass />}
          what="Chats where someone asked for a person and nobody has answered yet."
          aside={
            waitingItems.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-bg px-3 py-1 text-[12.5px] font-bold text-danger">
                <span aria-hidden className="size-2 rounded-full bg-danger" />
                {waitingItems.length} waiting
              </span>
            ) : null
          }
        >
          {waitingItems.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {waitingItems.slice(0, 5).map((c) => (
                <li key={c.id} className="flex flex-col gap-2.5 rounded-2xl border border-line p-3.5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-soft text-[13px] font-bold">{initials(c.visitorName)}</span>
                    <div className="min-w-0">
                      <p className="truncate text-[14.5px] font-semibold">{c.visitorName}</p>
                      <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                        {c.waitingSince && (
                          <span className="inline-flex items-center gap-1 font-semibold text-danger">
                            <Clock aria-hidden className="size-3.5" />
                            {waitingTimer(c.waitingSince, now)}
                          </span>
                        )}
                        {c.urgency && <span className="rounded-full bg-soft px-2 py-0.5 font-semibold">{c.urgency}</span>}
                        {c.department && <span className="rounded-full bg-soft px-2 py-0.5 font-semibold">{DEPARTMENT_NAMES[c.department]}</span>}
                        {c.assigneeName && <span>for {c.assigneeName}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-2">
                    <Link
                      href={`${href("/")}?c=${c.id}`}
                      aria-label={`Reassign ${c.visitorName}`}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-gradient px-3 text-[13px] font-bold text-white outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30"
                    >
                      <ArrowLeftRight aria-hidden className="size-4" /> Reassign
                    </Link>
                    <Link
                      href={`${href("/")}?c=${c.id}`}
                      aria-label={`Read ${c.visitorName}'s chat live`}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold outline-none hover:bg-pulse-blue/5 focus-visible:ring-4 focus-visible:ring-pulse-blue/30"
                    >
                      <Eye aria-hidden className="size-4" /> Read live
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-2xl bg-[#0f9f6e]/10 px-4 py-5 text-sm font-semibold text-[#0f7a4a] dark:text-[#5fd9a0]">
              <Check aria-hidden className="size-4" strokeWidth={3} /> Nobody is waiting for a person.
            </p>
          )}
        </Section>
      </div>

      <section id="gaps" aria-labelledby="gaps-h" className="flex flex-col gap-3 rounded-[24px] border border-dashed border-[#7b5cff]/40 bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="gaps-h" className="text-[17px] font-bold">Knowledge gaps this week</h2>
          <span className="text-[13px] text-muted">Questions the AI couldn’t answer well</span>
        </div>
        <p className="flex items-start gap-2 text-sm text-muted">
          <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-new" />
          Coming soon: every week, the questions the AI could not answer, each with a suggested addition to the guide you can add, edit or dismiss.
        </p>
      </section>
    </main>
  );
}
