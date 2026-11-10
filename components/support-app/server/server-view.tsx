import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Cloud, Cpu, Database, Gauge, Globe, History, ListChecks, Server, ShieldCheck, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ServerMonitor } from "@/lib/monitor/dashboard";
import { durationWords, kigaliMidnight, kigaliTime } from "@/lib/monitor/uptime-rules";
import { AutoRefresh } from "./auto-refresh";
import { Bar, LevelPill, Ring } from "./gauges";
import { RunCheck } from "./run-check";
import { downMinutes, fillLevel, LEVEL_COLOR, seconds, share, speedLevel, uptimeLevel, windowMinutes, type Level } from "./server-math";
import { ServerStyles } from "./styles";
import { UptimeTimeline } from "./uptime-timeline";

// The support app's Server page (docs/SUPPORT_DASHBOARD.md, "Server monitoring"): plain words for a non-technical
// owner, every number with a line saying what it means. Rendered on the server from getServerMonitor
// (lib/monitor/dashboard.ts) and refreshed every minute; the gauges are hand-made SVG (./gauges.tsx).

const AMBER = "text-[#b45309] dark:text-[#ffc65c]";
const DAY = 86_400_000;

const PAGE_NAMES: Record<string, string> = { "/": "Home page", "/pricing": "Pricing page", "/login": "Sign-in page" };
const TASK_NAMES: Record<string, { name: string; hint: string }> = {
  "BuPulse server": { name: "Website (the BuPulse server)", hint: "Shows bupulse.com to visitors" },
  "BuPulse tunnel": { name: "Tunnel (connects the PC to the internet)", hint: "Without it nobody outside can reach the site" },
  "BuPulse jobs": { name: "Scheduled jobs (posts, reminders)", hint: "Sends scheduled posts and reminders every minute" },
};
const TASK_STATES: Record<string, string> = { Running: "Running", Ready: "Stopped", Disabled: "Switched off", Queued: "Waiting to start", Missing: "Not installed", Unknown: "Unknown" };
const REASONS: Record<string, string> = {
  "failed-check": "The outside check could not reach the site",
  "pc-silent": "The server PC stopped reporting too",
  "long-gap": "No check reached the site for a long time",
  ongoing: "Going on now",
};

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  return `${durationWords(m)} ago`;
}

const gb = (mb: number) => `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1)} GB`;
const mbText = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
// Rounded down, so 99.96% never shows as 100%.
const pct = (v: number | null) => (v === null ? "–" : v >= 100 ? "100%" : `${(Math.floor(v * 10) / 10).toFixed(1)}%`);

/** The end of an outage: only the time when it is the same day as the start. */
function endTime(startIso: string, endIso: string): string {
  const [startDay] = kigaliTime(new Date(startIso)).split(", ");
  const [endDay, time] = kigaliTime(new Date(endIso)).split(", ");
  return startDay === endDay ? time : `${endDay}, ${time}`;
}

function Card({ id, title, what, icon, note, children, dashed, className }: { id: string; title: string; what: ReactNode; icon: ReactNode; note?: ReactNode; children: ReactNode; dashed?: boolean; className?: string }) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "relative flex min-w-0 flex-col gap-4 rounded-[22px] border bg-surface p-4 shadow-[0_20px_50px_-38px_rgba(17,24,39,0.45)] sm:p-5",
        dashed ? "border-dashed border-pulse-violet/40" : "border-line",
        className,
      )}
    >
      {!dashed && <span aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-brand-gradient opacity-80" />}
      <header className="flex items-start gap-3">
        <span aria-hidden className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-2xl text-white", dashed ? "bg-soft text-new" : "bg-brand-gradient shadow-[0_10px_22px_-12px_rgba(47,107,255,0.9)]")}>
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 id={id} className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
            {note && <span className="text-[12.5px] text-muted">{note}</span>}
          </div>
          <p className="text-[13px] leading-snug text-muted">{what}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/** A small reading with its plain meaning under it. */
function Stat({ icon, label, value, level, what }: { icon: ReactNode; label: string; value: ReactNode; level: Level; what: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-bg/60 p-3 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
          {icon}
          {label}
        </span>
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: LEVEL_COLOR[level] }} />
      </div>
      <span className="text-[15px] font-bold tabular-nums">{value}</span>
      <span className="text-[12px] leading-snug text-muted">{what}</span>
    </div>
  );
}

type HeroKind = "good" | "down" | "silent" | "warn";

function heroKind(m: ServerMonitor): HeroKind {
  if (m.site.kind === "down") return "down";
  if (m.pc.state === "silent") return "silent";
  if (m.issues.some((i) => i.level === "down")) return "down";
  if (m.issues.length) return "warn";
  return "good";
}

const HERO: Record<HeroKind, { title: (m: ServerMonitor) => string; bg: string; icon: typeof CheckCircle2 }> = {
  good: { title: () => "Everything is working", bg: "bg-[linear-gradient(140deg,#0f9f6e_0%,#1f8f8a_45%,#2f6bff_100%)]", icon: CheckCircle2 },
  down: { title: (m) => (m.site.kind === "down" ? "bupulse.com looks down" : "Something is down"), bg: "bg-[linear-gradient(140deg,#b3122f_0%,#d0343f_55%,#e0574f_100%)]", icon: XCircle },
  silent: { title: () => "The server PC is not reporting", bg: "bg-[linear-gradient(140deg,#b3122f_0%,#c2410c_100%)]", icon: XCircle },
  warn: { title: () => "Something needs a look", bg: "bg-[linear-gradient(140deg,#9a4a06_0%,#b45309_50%,#c2410c_100%)]", icon: AlertTriangle },
};

function Hero({ m, now }: { m: ServerMonitor; now: number }) {
  const kind = heroKind(m);
  const h = HERO[kind];
  const Icon = h.icon;
  const sentence = [
    m.site.kind === "up" ? `bupulse.com answered the outside check ${ago(m.site.lastCheckAt, now)}.` : m.site.kind === "never" ? "The outside check is not set up yet (see below)." : "",
    m.pc.state === "ok" ? `The server PC reported ${ago(m.pc.lastAt, now)}.` : m.pc.state === "never" ? "The server PC has not reported yet (see below)." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const facts: { label: string; value: string; ok: boolean | null }[] = [
    { label: "Website", value: m.site.kind === "up" ? "Up" : m.site.kind === "down" ? "Down" : m.site.kind === "late" ? "Check late" : "Not checked yet", ok: m.site.kind === "up" ? true : m.site.kind === "down" ? false : null },
    { label: "Server PC", value: m.pc.state === "ok" ? "Reporting" : m.pc.state === "silent" ? "Silent" : "Not set up", ok: m.pc.state === "ok" ? true : m.pc.state === "silent" ? false : null },
    { label: "Database", value: m.db.nowMs === null ? "Not answering" : `${m.db.nowMs} ms`, ok: m.db.nowMs !== null },
  ];
  return (
    <div role={kind === "good" ? "status" : "alert"} className={cn("srv-rise relative overflow-hidden rounded-[24px] p-5 text-white shadow-[0_22px_50px_-28px_rgba(17,24,39,0.7)] sm:p-6", h.bg)}>
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/10 blur-2xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 left-1/3 size-48 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-start gap-3.5 sm:items-center sm:gap-5">
        <div className="relative mt-1 inline-flex size-12 shrink-0 items-center justify-center sm:mt-0 sm:size-16">
          <span aria-hidden className="srv-ping absolute inset-0 rounded-full bg-white/40" />
          <span aria-hidden className="srv-ping-late absolute inset-0 rounded-full bg-white/30" />
          <span className="relative inline-flex size-12 items-center justify-center rounded-full bg-white/95 shadow-lg sm:size-16">
            <Icon aria-hidden className="size-6 sm:size-8" style={{ color: kind === "good" ? "#0f7a4a" : kind === "warn" ? "#b45309" : "#c81e3a" }} />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <strong className="text-[21px] font-bold leading-tight tracking-[-0.02em] sm:text-[26px]">{h.title(m)}</strong>
          {m.issues.length === 0 ? (
            <span className="text-[14px] text-white/90">{sentence}</span>
          ) : (
            <ul className="flex flex-col gap-1 text-[14px] text-white/95">
              {m.issues.map((i) => (
                <li key={i.text} className="flex items-start gap-1.5">
                  <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-white" />
                  {i.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ul className="relative mt-4 grid grid-cols-3 gap-2">
        {facts.map((f) => (
          <li key={f.label} className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-white/15 px-2.5 py-2 backdrop-blur-sm sm:px-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-white/75 sm:text-[11.5px]">{f.label}</span>
            <span className="flex items-center gap-1.5 text-[13px] font-bold leading-tight sm:text-[14px]">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", f.ok === true ? "srv-blink bg-[#7dffc4]" : f.ok === false ? "bg-[#ffd0d6]" : "bg-white/60")} />
              {f.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Uptime({ m, now }: { m: ServerMonitor; now: number }) {
  const since = m.uptime.since;
  const tiles = [
    { label: "Today", value: m.uptime.today, minutes: windowMinutes(kigaliMidnight(new Date(now)).getTime(), since, now) },
    { label: "Last 7 days", value: m.uptime.week, minutes: windowMinutes(now - 7 * DAY, since, now) },
    { label: "Last 30 days", value: m.uptime.month, minutes: windowMinutes(now - 30 * DAY, since, now) },
  ];
  const sinceRecent = since && now - new Date(since).getTime() < 30 * DAY;
  return (
    <Card id="uptime" title="Uptime" icon={<ShieldCheck className="size-5" />} what="The share of time bupulse.com answered when checked from outside. 99.9% or more is good: about 43 minutes down in a whole month.">
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {tiles.map((t, i) => {
          const down = downMinutes(t.value, t.minutes);
          const level = uptimeLevel(t.value);
          return (
            <Ring
              key={t.label}
              value={t.value === null ? null : t.value / 100}
              level={level}
              center={pct(t.value)}
              label={t.label}
              ariaLabel={`Uptime ${t.label.toLowerCase()}: ${pct(t.value)}`}
              delay={i * 0.12}
              hint={t.value === null ? "Nothing to count yet" : down ? `About ${durationWords(down)} down` : "No time down"}
            />
          );
        })}
      </div>
      {m.site.kind === "never" ? (
        <p className="text-[13.5px] text-muted">No outside check has arrived yet, so there is nothing to count.</p>
      ) : sinceRecent ? (
        <p className="text-[12.5px] text-muted">Counting since {kigaliTime(new Date(since!))} (Kigali time), when the checks started.</p>
      ) : null}
    </Card>
  );
}

function Timeline({ m }: { m: ServerMonitor }) {
  return (
    <Card id="timeline" title="Uptime timeline" icon={<History className="size-5" />} what="Each bar is one hour (or one day). Green means the site was up the whole time; yellow means some trouble; red means mostly down. Tap a bar to read it.">
      <UptimeTimeline hours={m.timeline.hours} days={m.timeline.days} generatedAt={m.generatedAt} />
    </Card>
  );
}

function Outages({ m }: { m: ServerMonitor }) {
  return (
    <Card id="outages" title="Recent outages" icon={<AlertTriangle className="size-5" />} note="Last 30 days" what="Times bupulse.com could not be reached, newest first, in Kigali time.">
      {m.outages.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl bg-success-bg px-3.5 py-3 text-[13.5px]">
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" /> No outages in the last 30 days.
        </p>
      ) : (
        <ul className="srv-stagger flex flex-col gap-2.5">
          {m.outages.map((o) => (
            <li key={o.startedAt} className={cn("relative flex flex-col gap-1 overflow-hidden rounded-2xl border border-line py-3 pl-4 pr-3.5 text-[13.5px]", !o.endedAt && "border-danger/40 bg-danger-bg")}>
              <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: o.endedAt ? LEVEL_COLOR.warn : LEVEL_COLOR.bad }} />
              <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <strong className={o.endedAt ? "" : "text-danger"}>
                  {kigaliTime(new Date(o.startedAt))} → {o.endedAt ? endTime(o.startedAt, o.endedAt) : "now"}
                </strong>
                <span className="rounded-full bg-soft px-2.5 py-0.5 text-[12px] font-semibold tabular-nums">
                  {durationWords(o.minutes)}
                  {o.endedAt ? "" : " so far"}
                </span>
              </span>
              <span className="text-muted">{REASONS[o.reason] ?? o.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-muted">Measured from the last good check to the next good one, so an outage may have been a little shorter.</p>
    </Card>
  );
}

function Pc({ m, now }: { m: ServerMonitor; now: number }) {
  const pc = m.pc;
  if (pc.state === "never") {
    return (
      <Card id="pc" title="The server PC" icon={<Server className="size-5" />} what="The home PC that runs bupulse.com.">
        <p className="flex items-start gap-2 text-sm text-muted">
          <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0" />
          The home PC that runs bupulse.com has not reported yet. It starts reporting once its job loop runs the new version (see &quot;What is left to set up&quot; below).
        </p>
      </Card>
    );
  }
  const mem = pc.memUsedMb !== null && pc.memTotalMb ? pc.memUsedMb / pc.memTotalMb : null;
  const upMinutes = pc.bootAt ? Math.round((now - new Date(pc.bootAt).getTime()) / 60_000) : null;
  const gauges = [
    {
      key: "cpu",
      label: "Processor (CPU)",
      value: pc.cpuPercent === null ? null : pc.cpuPercent / 100,
      level: fillLevel(pc.cpuPercent === null ? null : pc.cpuPercent / 100),
      center: pc.cpuPercent === null ? "–" : `${pc.cpuPercent}%`,
      unit: pc.cpuHourAvg !== null ? `${pc.cpuHourAvg}% avg / hour` : "now",
      hint: "How hard the PC is working. Short peaks are normal; staying above 90% slows the site.",
    },
    {
      key: "mem",
      label: "Memory",
      value: mem,
      level: fillLevel(mem, 0.85, 0.95),
      center: mem === null ? "–" : `${Math.round(mem * 100)}%`,
      unit: pc.memUsedMb !== null && pc.memTotalMb ? `${gb(pc.memUsedMb)} used of ${gb(pc.memTotalMb)}` : undefined,
      hint: "How much of the PC's memory is in use. Above 90% may slow the site.",
    },
    ...pc.disks.map((d) => {
      const used = d.totalGb && d.freeGb !== null ? 1 - d.freeGb / d.totalGb : null;
      return {
        key: d.name,
        label: `Disk ${d.name}${d.roles.length ? ` (${d.roles.map((r) => (r === "system" ? "Windows" : "BuPulse")).join(" and ")})` : ""}`,
        value: used,
        level: fillLevel(used),
        center: used === null ? "–" : `${Math.round(used * 100)}%`,
        unit: d.totalGb && d.freeGb !== null ? `${d.freeGb} GB free of ${d.totalGb} GB` : undefined,
        hint: "How full the drive is. With less than 10% free, updates and backups can fail.",
      };
    }),
  ];
  return (
    <Card
      id="pc"
      title="The server PC"
      icon={<Server className="size-5" />}
      what="The home PC that runs bupulse.com. It reports every minute."
      note={<span className={pc.state === "silent" ? "font-semibold text-danger" : ""}>{pc.state === "silent" ? `Not reporting for ${durationWords(pc.minutesSilent ?? 0)}` : `Reported ${ago(pc.lastAt, now)}`}</span>}
    >
      <div className="grid grid-cols-2 gap-x-2 gap-y-5 sm:grid-cols-4">
        {gauges.map((g, i) => (
          <Ring key={g.key} value={g.value} level={g.level} center={g.center} unit={g.key === "cpu" ? g.unit : undefined} label={g.label} ariaLabel={`${g.label}: ${g.center} in use`} delay={i * 0.1} hint={<>{g.key !== "cpu" && g.unit ? <span className="block font-medium text-text">{g.unit}</span> : null}{g.hint}</>} />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">Programs on the PC</h3>
        <ul className="flex flex-col gap-2">
          {Object.keys(TASK_NAMES).map((name) => {
            const t = pc.tasks.find((x) => x.name === name);
            const state = t?.state ?? "Unknown";
            const running = state === "Running";
            const unknown = state === "Unknown";
            return (
              <li key={name} className="flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13.5px] font-semibold">{TASK_NAMES[name].name}</span>
                  <span className="text-[12px] text-muted">{TASK_NAMES[name].hint}</span>
                </span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
                    running ? "bg-success-bg text-success" : unknown ? "bg-soft text-muted" : "bg-danger-bg text-danger",
                  )}
                >
                  <span className="relative inline-flex size-2">
                    {running && <span aria-hidden className="srv-ping absolute inset-0 rounded-full bg-current" />}
                    <span aria-hidden className="relative size-2 rounded-full bg-current" />
                  </span>
                  {TASK_STATES[state] ?? state}
                </span>
              </li>
            );
          })}
          {pc.serverListening === false && (
            <li className="flex items-center justify-between gap-3 rounded-2xl border border-danger/40 bg-danger-bg px-3 py-2.5 text-[13.5px]">
              <span className="font-semibold">Website on the PC</span>
              <span className="text-danger">Not answering on port 3002</span>
            </li>
          )}
        </ul>
      </div>

      <Stat
        icon={<Clock aria-hidden className="size-3.5" />}
        label="Last restart"
        level={upMinutes !== null && upMinutes < 60 ? "warn" : "good"}
        value={upMinutes === null ? "–" : `${durationWords(upMinutes)} ago (${kigaliTime(new Date(pc.bootAt!))})`}
        what="When the PC last started. A restart you did not plan can mean a power cut or a Windows update."
      />
      <p className="text-[12px] text-muted">{[pc.machine, pc.os, pc.nodeVersion && `Node ${pc.nodeVersion}`, pc.cloudflaredVersion].filter(Boolean).join(" · ")}</p>
    </Card>
  );
}

function SiteChecks({ m }: { m: ServerMonitor }) {
  const last = m.checks.last;
  const lastByPath = new Map((last?.pages ?? []).map((p) => [p.path, p]));
  const dbPct = m.db.sizeBytes !== null && m.db.limitBytes ? m.db.sizeBytes / m.db.limitBytes : null;
  const MAX = 3000;
  const dbLevel: Level = m.db.nowMs === null ? "bad" : m.db.nowMs < 100 ? "good" : m.db.nowMs < 500 ? "warn" : "bad";
  const errLevel: Level = !m.errors ? "none" : m.errors.lastHour >= 10 ? "bad" : m.errors.lastHour >= 3 ? "warn" : "good";
  const jobLevel: Level = !m.jobs ? "none" : m.jobs.problems.length ? "warn" : "good";
  return (
    <Card id="checks" title="Site checks" icon={<Gauge className="size-5" />} note={last ? `Last outside check ${kigaliTime(new Date(last.checkedAt))}` : undefined} what="How fast each page opens for a visitor outside. Under 1 second is fast; over 3 seconds people start to leave.">
      <div className="flex flex-col gap-3" role="group" aria-label="How fast the pages open from outside, at the last check">
        {m.checks.avg24h.map((a, i) => {
          const p = lastByPath.get(a.path);
          const failed = !!p && (p.status === null || p.status >= 500);
          const level: Level = !p ? "none" : failed ? "bad" : speedLevel(p.ms);
          const word = !p ? "No check" : failed ? `Failed${p.status ? ` (error ${p.status})` : ""}` : level === "good" ? "Fast" : level === "warn" ? "OK" : "Slow";
          return (
            <div key={a.path} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13.5px]">
                <span className="font-semibold">{PAGE_NAMES[a.path] ?? a.path}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {p && !failed ? seconds(p.ms) : null}
                  <LevelPill level={level}>{word}</LevelPill>
                </span>
              </div>
              <div className="relative">
                <Bar value={!p ? null : failed ? 1 : share(p.ms, MAX)} level={level} label={`${PAGE_NAMES[a.path] ?? a.path}: ${!p ? "no check" : failed ? "failed" : seconds(p.ms)}`} delay={i * 0.1} />
                <span aria-hidden className="absolute -top-0.5 h-3.5 w-0.5 rounded-full bg-text/60" style={{ left: `${(1000 / MAX) * 100}%` }} />
              </div>
              <span className="text-[12px] text-muted">
                Average over 24 hours: {a.ms === null ? "–" : seconds(a.ms)}
                {a.failures ? <span className="text-danger"> · failed {a.failures}×</span> : null}
              </span>
            </div>
          );
        })}
        <div aria-hidden className="relative h-4 text-[11px] text-muted">
          <span className="absolute left-0">0 s</span>
          <span className="absolute -translate-x-1/2 font-semibold text-text" style={{ left: `${(1000 / MAX) * 100}%` }}>
            1 s target
          </span>
          <span className="absolute left-2/3 -translate-x-1/2">2 s</span>
          <span className="absolute right-0">3 s+</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Stat
          icon={<Database aria-hidden className="size-3.5" />}
          label="Database answer time"
          level={dbLevel}
          value={
            <>
              {m.db.nowMs === null ? <span className="text-danger">Did not answer</span> : `${m.db.nowMs} ms now`}
              {last?.databaseMs != null ? <span className="block text-[12px] font-medium text-muted">{last.databaseMs} ms at the last outside check</span> : null}
            </>
          }
          what="How long the database takes to answer a tiny question. Under 100 ms is healthy."
        />
        {dbPct !== null ? (
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-bg/60 p-3 dark:bg-white/[0.03]">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
              <Database aria-hidden className="size-3.5" /> Database size
            </span>
            <span className="text-[15px] font-bold tabular-nums">{`${mbText(m.db.sizeBytes!)} of ${mbText(m.db.limitBytes!)} (${Math.round(dbPct * 100)}%)`}</span>
            <Bar value={dbPct} level={fillLevel(dbPct)} label="Database size" />
            <span className="text-[12px] leading-snug text-muted">Space used in the database plan. Near 100%, new data cannot be saved.</span>
          </div>
        ) : null}
        <Stat
          icon={<AlertTriangle aria-hidden className="size-3.5" />}
          label="Errors"
          level={errLevel}
          value={m.errors ? <span className={m.errors.lastHour >= 10 ? "text-danger" : ""}>{`${m.errors.lastHour} in the last hour, ${m.errors.last24h} in 24 hours`}</span> : "–"}
          what={m.errors && m.errors.top.length > 0 ? `Most from: ${m.errors.top.map((t) => `${t.source} (${t.count})`).join(", ")}. A few are normal; 10 in an hour needs a look.` : "Errors the site wrote down. A few are normal; 10 in an hour needs a look."}
        />
        <Stat
          icon={<ListChecks aria-hidden className="size-3.5" />}
          label="Scheduled jobs"
          level={jobLevel}
          value={m.jobs ? <span className={m.jobs.problems.length ? AMBER : "text-success"}>{m.jobs.problems.length ? `${m.jobs.ok} of ${m.jobs.total} fine` : `All ${m.jobs.total} fine`}</span> : "–"}
          what="Background work like sending scheduled posts, reminders and syncing stores."
        />
      </div>
      {m.jobs && m.jobs.problems.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {m.jobs.problems.map((p) => (
            <li key={p.label} className="flex items-start gap-2 rounded-xl bg-[#fff4e0] px-3 py-2 dark:bg-[#3a2a0a]">
              <AlertTriangle aria-hidden className={cn("mt-0.5 size-4 shrink-0", AMBER)} />
              <span>
                <strong>{p.label}</strong> {p.text}.
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-muted">Full details for the owner: Admin → Health and Admin → Errors.</p>
    </Card>
  );
}

function Setup({ m }: { m: ServerMonitor }) {
  if (m.site.kind !== "never" && m.pc.state !== "never") return null;
  return (
    <Card id="setup" title="What is left to set up" icon={<ListChecks className="size-5" />} what="Steps that switch the missing parts of this page on." dashed>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px]">
        {m.site.kind === "never" && (
          <li>
            Outside check: make a long random password, save it as <strong>UPTIME_SECRET</strong> in Admin → Services (custom key) and as a GitHub repository secret with the same name. Add TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and RESEND_API_KEY there too for the
            &quot;site is down&quot; alerts.
          </li>
        )}
        {m.pc.state === "never" && <li>Server PC: after the next update on the PC, restart the &quot;BuPulse jobs&quot; task (update.ps1 does it), and the PC starts reporting every minute.</li>}
      </ol>
    </Card>
  );
}

function Backup() {
  return (
    <Card id="backup" title="Backup servers" icon={<Cloud className="size-5" />} note={<span className="rounded-full bg-new-bg px-2.5 py-0.5 font-semibold text-new">Not set up yet</span>} what="A second computer that takes over if the home PC stops." dashed>
      <p className="flex items-start gap-2 text-sm text-muted">
        <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-new" />
        Today one home PC runs bupulse.com. When a second computer or a cloud server is ready to take over if this PC stops, it will be listed here with its own status, so you can see at a glance which one is serving the site.
      </p>
    </Card>
  );
}

export function ServerView({ m, preview = false }: { m: ServerMonitor; preview?: boolean }) {
  const now = new Date(m.generatedAt).getTime();
  return (
    <main className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <ServerStyles />
      {!preview && <AutoRefresh />}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3">
          <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_24px_-12px_rgba(47,107,255,0.9)]">
            <Cpu className="size-5" />
          </span>
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em]">Server</h1>
            <p className="text-sm text-muted">Is bupulse.com up, and how is the home PC that runs it? This page updates every minute.</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Globe aria-hidden className="size-3.5" /> Read {kigaliTime(new Date(m.generatedAt))} (Kigali time)
        </span>
      </header>

      <Hero m={m} now={now} />

      <section aria-label="Checks" className="srv-rise rounded-[22px] border border-line bg-surface p-4 shadow-[0_20px_50px_-38px_rgba(17,24,39,0.45)] sm:p-5">
        <RunCheck lastCheckAt={m.checks.last?.checkedAt ?? null} generatedAt={m.generatedAt} preview={preview} />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="srv-stagger flex min-w-0 flex-col gap-5">
          <Uptime m={m} now={now} />
          <Timeline m={m} />
          <Outages m={m} />
        </div>
        <div className="srv-stagger flex min-w-0 flex-col gap-5">
          <Pc m={m} now={now} />
          <SiteChecks m={m} />
          <Setup m={m} />
          <Backup />
        </div>
      </div>
    </main>
  );
}
