import "server-only";
import { prisma } from "@/lib/db";
import { getSystemHealth } from "@/lib/admin/health";
import type { HeartbeatDisk, HeartbeatTask } from "./heartbeat-input";
import { PC_TASKS } from "./heartbeat-input";
import { CHECKED_PAGES, durationWords, kigaliMidnight, kigaliTime, minutesBetween, PC_SILENT_MS, siteState, uptimePercent, type OutageReason, type PageResult } from "./uptime-rules";

// Everything the support app's Server page shows (app/support/(app)/server), read in one go. Dates are ISO strings so
// the result can go to the browser. Scheduled jobs, errors and the database size come from the Admin -> Health page's
// own reader (getSystemHealth), so both pages always agree.

const DAY = 86_400_000;
const TASK_WORDS: Record<string, string> = { Ready: "stopped", Disabled: "switched off", Queued: "waiting to start", Missing: "not installed" };
// Scheduled jobs that need a look are listed in the Site checks panel, not in the banner: the Health page's rules can
// keep one job amber for days (a job that is not set up), and the banner is for "is the site and the PC fine now".

export type MonitorIssue = { level: "down" | "warn"; text: string };

export type ServerMonitor = {
  generatedAt: string;
  issues: MonitorIssue[];
  site:
    | { kind: "never" }
    | { kind: "up"; lastCheckAt: string }
    | { kind: "late"; lastCheckAt: string; minutes: number }
    | { kind: "down"; since: string | null; minutes: number | null; lastCheckAt: string };
  uptime: { today: number | null; week: number | null; month: number | null; since: string | null };
  outages: { startedAt: string; endedAt: string | null; minutes: number; reason: OutageReason | "ongoing" }[];
  pc: {
    state: "never" | "ok" | "silent";
    lastAt: string | null;
    minutesSilent: number | null;
    machine: string | null;
    os: string | null;
    bootAt: string | null;
    cpuPercent: number | null;
    cpuHourAvg: number | null;
    memUsedMb: number | null;
    memTotalMb: number | null;
    disks: HeartbeatDisk[];
    tasks: HeartbeatTask[];
    serverListening: boolean | null;
    nodeVersion: string | null;
    cloudflaredVersion: string | null;
  };
  checks: {
    last: { checkedAt: string; ok: boolean; statusMs: number | null; databaseMs: number | null; version: string | null; pages: PageResult[] } | null;
    avg24h: { path: string; ms: number | null; failures: number }[];
  };
  db: { nowMs: number | null; sizeBytes: number | null; limitBytes: number | null };
  /** Where errors came from, without their messages (they can name clients; the full list is in Admin -> Errors). */
  errors: { lastHour: number; last24h: number; top: { source: string; count: number }[] } | null;
  jobs: { total: number; ok: number; problems: { label: string; state: string; text: string }[] } | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const pagesOf = (v: unknown): PageResult[] => (Array.isArray(v) ? (v as PageResult[]).filter((p) => p && typeof p.path === "string") : []);

/** The error groups summed by source, biggest first, at most 4. */
function topSources(top: { source: string; count: number }[]): { source: string; count: number }[] {
  const by = new Map<string, number>();
  for (const t of top) by.set(t.source, (by.get(t.source) ?? 0) + t.count);
  return [...by].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 4);
}

async function dbNowMs(): Promise<number | null> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Date.now() - started;
  } catch {
    return null;
  }
}

export async function getServerMonitor(now = new Date()): Promise<ServerMonitor> {
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const dayAgo = new Date(now.getTime() - DAY);
  const [lastCheck, lastOk, first, incidents, recent, beat, cpuHour, health, nowMs] = await Promise.all([
    prisma.uptimeCheck.findFirst({ orderBy: { checkedAt: "desc" } }),
    prisma.uptimeCheck.findFirst({ where: { ok: true }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } }),
    prisma.uptimeCheck.aggregate({ _min: { checkedAt: true } }),
    prisma.uptimeIncident.findMany({ where: { endedAt: { gte: monthAgo } }, orderBy: { startedAt: "desc" }, take: 200 }),
    prisma.uptimeCheck.findMany({ where: { checkedAt: { gte: dayAgo } }, select: { ok: true, pages: true }, take: 2_000 }),
    prisma.monitorHeartbeat.findFirst({ orderBy: { receivedAt: "desc" } }),
    prisma.monitorHeartbeat.aggregate({ where: { receivedAt: { gte: new Date(now.getTime() - 3_600_000) } }, _avg: { cpuPercent: true } }),
    getSystemHealth(now).catch(() => null),
    dbNowMs(),
  ]);

  // The server PC.
  const silentMs = beat ? now.getTime() - beat.receivedAt.getTime() : null;
  const pcState: ServerMonitor["pc"]["state"] = !beat ? "never" : silentMs! > PC_SILENT_MS ? "silent" : "ok";
  const tasks = (Array.isArray(beat?.tasks) ? (beat.tasks as HeartbeatTask[]) : []).filter((t) => t && typeof t.name === "string");

  // The site from outside.
  const state = siteState({ lastCheck, lastOkAt: lastOk?.checkedAt ?? null, pcSilent: pcState === "silent" }, now);
  const site: ServerMonitor["site"] =
    state.kind === "never" ? state
    : state.kind === "up" ? { kind: "up", lastCheckAt: state.lastCheckAt.toISOString() }
    : state.kind === "late" ? { kind: "late", lastCheckAt: state.lastCheckAt.toISOString(), minutes: state.minutes }
    : { kind: "down", since: iso(state.since), minutes: state.minutes, lastCheckAt: state.lastCheckAt.toISOString() };

  const spans: { startedAt: Date; endedAt: Date | null }[] = incidents.map((i) => ({ startedAt: i.startedAt, endedAt: i.endedAt }));
  const ongoing = state.kind === "down" && state.since ? { startedAt: state.since, endedAt: null } : null;
  if (ongoing) spans.push(ongoing);
  const since = first._min.checkedAt ?? null;
  const pct = (from: Date) => uptimePercent(spans, { from, to: now }, since);

  // Response times over the last day.
  const avg24h = CHECKED_PAGES.map((path) => {
    let total = 0;
    let n = 0;
    let failures = 0;
    for (const c of recent) {
      const p = pagesOf(c.pages).find((x) => x.path === path);
      if (!p) continue;
      if (p.status === null || p.status >= 500) failures++;
      else if (p.ms !== null) {
        total += p.ms;
        n++;
      }
    }
    return { path, ms: n ? Math.round(total / n) : null, failures };
  });

  const jobs = health
    ? {
        total: health.crons.length,
        ok: health.crons.filter((c) => c.state === "ok").length,
        problems: health.crons
          .filter((c) => c.state === "failed" || c.state === "overdue")
          .map((c) => ({ label: c.label, state: c.state, text: c.state === "overdue" ? `has not run for ${c.overdueByMinutes ?? "?"} minutes past its time` : `failed on its last run (${c.failures24h} of ${c.runs24h} in 24 hours)` })),
      }
    : null;

  const issues: MonitorIssue[] = [];
  if (site.kind === "down") issues.push({ level: "down", text: state.kind === "down" && state.since ? `bupulse.com looks down from outside: no good check for ${durationWords(state.minutes ?? 0)} (since ${kigaliTime(state.since)}, Kigali time).` : "The last outside check of bupulse.com failed." });
  if (pcState === "silent") issues.push({ level: "down", text: `The server PC has not reported for ${minutesBetween(beat!.receivedAt, now)} minutes. Its job loop ("BuPulse jobs") may have stopped, so scheduled posts may not go out.` });
  if (site.kind === "late") issues.push({ level: "warn", text: `No outside check for ${site.minutes} minutes. GitHub sometimes runs late; it is only a problem if this keeps growing.` });
  if (beat && pcState === "ok") {
    for (const name of PC_TASKS) {
      const t = tasks.find((x) => x.name === name);
      // "Unknown": Windows did not say (no permission to read the task); not worth a warning.
      if (t && t.state !== "Running" && t.state !== "Unknown") issues.push({ level: "warn", text: `The "${name}" task on the PC is ${TASK_WORDS[t.state]}, not running.` });
    }
    for (const d of (Array.isArray(beat.disks) ? (beat.disks as HeartbeatDisk[]) : [])) {
      if (d.totalGb && d.freeGb !== null && d.freeGb / d.totalGb < 0.1) issues.push({ level: "warn", text: `Disk ${d.name} is almost full (${d.freeGb} GB free).` });
    }
  }
  if (nowMs === null) issues.push({ level: "down", text: "The database did not answer just now." });

  return {
    generatedAt: now.toISOString(),
    issues,
    site,
    uptime: { today: pct(kigaliMidnight(now)), week: pct(new Date(now.getTime() - 7 * DAY)), month: pct(monthAgo), since: iso(since) },
    outages: [
      ...(ongoing ? [{ startedAt: ongoing.startedAt.toISOString(), endedAt: null, minutes: minutesBetween(ongoing.startedAt, now), reason: "ongoing" as const }] : []),
      ...incidents.slice(0, 10).map((i) => ({ startedAt: i.startedAt.toISOString(), endedAt: i.endedAt.toISOString(), minutes: i.minutes, reason: i.reason as OutageReason })),
    ],
    pc: {
      state: pcState,
      lastAt: iso(beat?.receivedAt),
      minutesSilent: beat ? minutesBetween(beat.receivedAt, now) : null,
      machine: beat?.machine ?? null,
      os: beat?.os ?? null,
      bootAt: iso(beat?.bootAt),
      cpuPercent: beat?.cpuPercent ?? null,
      cpuHourAvg: cpuHour._avg.cpuPercent === null ? null : Math.round(cpuHour._avg.cpuPercent),
      memUsedMb: beat?.memUsedMb ?? null,
      memTotalMb: beat?.memTotalMb ?? null,
      disks: Array.isArray(beat?.disks) ? (beat.disks as HeartbeatDisk[]) : [],
      tasks,
      serverListening: beat?.serverListening ?? null,
      nodeVersion: beat?.nodeVersion ?? null,
      cloudflaredVersion: beat?.cloudflaredVersion ?? null,
    },
    checks: {
      last: lastCheck ? { checkedAt: lastCheck.checkedAt.toISOString(), ok: lastCheck.ok, statusMs: lastCheck.statusMs, databaseMs: lastCheck.databaseMs, version: lastCheck.version, pages: pagesOf(lastCheck.pages) } : null,
      avg24h,
    },
    db: { nowMs, sizeBytes: health?.db?.sizeBytes ?? null, limitBytes: health?.db?.limitBytes ?? null },
    errors: health ? { lastHour: health.errors.lastHour, last24h: health.errors.last24h, top: topSources(health.errors.top) } : null,
    jobs,
  };
}
