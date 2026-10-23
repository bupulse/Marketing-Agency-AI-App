"use client";

import Link from "next/link";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { STAFF_TOPICS } from "@/lib/support/contract";
import { DEPARTMENT_NAMES, duration, waitingTimer } from "@/lib/support/app-client/lists";
import { useSupportApp } from "./app-context";
import { useSupportHref } from "./base";
import { useLiveQuery, useNow } from "./use-live";

const DAY = 24 * 60 * 60 * 1000;
const PERIODS = [
  { value: "7", label: "This week" },
  { value: "30", label: "Last 30 days" },
];
const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v)}%`);
const STATUS_TONE: Record<string, string> = { online: "text-success", away: "text-[#b45309] dark:text-[#ffc65c]", offline: "text-muted" };

/**
 * Supervisors' stats: the period's tiles, the team right now (with Reassign and Read live for chats that wait), and
 * the knowledge gaps (coming soon).
 */
export function StatsView({ hoursLabel }: { hoursLabel: string }) {
  const { api } = useSupportApp();
  const href = useSupportHref();
  const now = useNow(5000);
  const [days, setDays] = useState("7");
  const stats = useLiveQuery(
    () => {
      const to = new Date();
      return api.stats(new Date(to.getTime() - Number(days) * DAY).toISOString(), to.toISOString());
    },
    { topics: [STAFF_TOPICS.presence], key: `stats:${days}` },
  );
  const waiting = useLiveQuery(() => api.conversations("waiting"), { topics: [STAFF_TOPICS.inbox], key: "stats-waiting" });
  const s = stats.data;
  const tiles = [
    { label: "Chats", value: s ? String(s.chats) : "–" },
    { label: "Solved by AI alone", value: pct(s?.aiSolvedPercent ?? null) },
    { label: "Handed to a person", value: pct(s?.handoverPercent ?? null) },
    { label: "First human reply", value: duration(s?.firstHumanReplySec ?? null) },
    { label: "Rated good", value: pct(s?.ratedGoodPercent ?? null) },
    { label: "New leads", value: s ? String(s.newLeads) : "–" },
  ];

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">Stats</h1>
          <p className="text-sm text-muted">Times count team hours only ({hoursLabel})</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Period</span>
          <select value={days} onChange={(e) => setDays(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm">
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </header>
      {stats.error && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm text-danger">{stats.error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-1 rounded-[18px] border border-line bg-surface p-4">
            <span className="text-[13px] text-muted">{t.label}</span>
            <span className="text-[26px] font-bold tabular-nums tracking-[-0.02em]">{t.value}</span>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-labelledby="team-now" className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 sm:p-5">
          <h2 id="team-now" className="text-[17px] font-bold">Team now</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[13.5px]">
              <thead>
                <tr className="text-left text-xs tracking-[0.03em] text-muted">
                  {["AGENT", "STATUS", "CHATS", "RATED GOOD"].map((h) => <th key={h} scope="col" className="border-b border-line py-2.5 pr-3 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {s?.agents.map((a) => (
                  <tr key={a.id}>
                    <td className="border-b border-line/60 py-2.5 pr-3"><strong>{a.name}</strong></td>
                    <td className={cn("border-b border-line/60 py-2.5 pr-3 capitalize", STATUS_TONE[a.availability])}>{a.availability}</td>
                    <td className="border-b border-line/60 py-2.5 pr-3 tabular-nums">{a.openChats} / {a.maxChats}</td>
                    <td className="border-b border-line/60 py-2.5 pr-3">{pct(a.ratedGoodPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {waiting.data && waiting.data.items.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-[13.5px]">
              {waiting.data.items.slice(0, 5).map((c) => (
                <li key={c.id}>
                  {c.visitorName}
                  {c.urgency ? ` (${c.urgency}${c.department ? `, ${DEPARTMENT_NAMES[c.department]}` : ""})` : c.department ? ` (${DEPARTMENT_NAMES[c.department]})` : ""} is waiting
                  {c.assigneeName ? ` for ${c.assigneeName}` : ""}
                  {c.waitingSince ? ` · ${waitingTimer(c.waitingSince, now)}` : ""}:{" "}
                  <Link href={`${href("/")}?c=${c.id}`} className="font-semibold text-ok underline-offset-2 hover:underline">Reassign</Link> ·{" "}
                  <Link href={`${href("/")}?c=${c.id}`} className="font-semibold text-ok underline-offset-2 hover:underline">Read live</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted">Nobody is waiting for a person.</p>
          )}
        </section>
        <section id="gaps" aria-labelledby="gaps-h" className="flex flex-col gap-3 rounded-[20px] border border-dashed border-[#7b5cff]/40 bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="gaps-h" className="text-[17px] font-bold">Knowledge gaps this week</h2>
            <span className="text-[13px] text-muted">Questions the AI couldn’t answer well</span>
          </div>
          <p className="flex items-start gap-2 text-sm text-muted">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-new" />
            Coming soon: every week, the questions the AI could not answer, each with a suggested addition to the guide you can add, edit or dismiss.
          </p>
        </section>
      </div>
    </main>
  );
}
