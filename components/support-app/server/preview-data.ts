import type { ServerMonitor } from "@/lib/monitor/dashboard";
import { kigaliMidnight } from "@/lib/monitor/uptime-rules";

// Made-up readings for the support app's dev-only preview (app/support/preview/server): no database, no real machine.
// ?state=down | silent | warn | never shows the other banners.

export type PreviewServerState = "good" | "down" | "silent" | "warn" | "never";
export const parseServerState = (v: unknown): PreviewServerState => (v === "down" || v === "silent" || v === "warn" || v === "never" ? v : "good");

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function previewServerMonitor(state: PreviewServerState = "good", nowDate = new Date()): ServerMonitor {
  const now = nowDate.getTime();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const currentHour = Math.floor(now / HOUR) * HOUR;
  const down = state === "down";
  const silent = state === "silent";

  const hours = Array.from({ length: 24 }, (_, i) => {
    const start = currentHour - (23 - i) * HOUR;
    const trouble = i === 9 ? { failed: 2, uptime: 61.6 } : i === 17 ? { failed: 1, uptime: 96.6 } : null;
    const last = i === 23;
    return {
      start: new Date(start).toISOString(),
      checks: last ? Math.max(1, Math.floor((now - start) / (5 * MIN))) : 12,
      failed: last && down ? 2 : (trouble?.failed ?? 0),
      avgMs: last && down ? null : 560 + ((i * 137) % 420),
      uptime: last && down ? 20 : (trouble?.uptime ?? 100),
    };
  });
  const today = kigaliMidnight(nowDate).getTime();
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = today - (29 - i) * DAY;
    const uptime = i < 3 ? null : i === 11 ? 98.4 : i === 22 ? 99.6 : i === 29 ? (down ? 97.9 : 99.6) : 100;
    return { day: new Date(day).toISOString(), uptime };
  });

  const never = state === "never";
  const base: ServerMonitor = {
    generatedAt: new Date(now).toISOString(),
    issues: [],
    site: { kind: "up", lastCheckAt: at(2 * MIN + 20_000) },
    uptime: { today: down ? 97.9 : 99.6, week: down ? 99.4 : 99.93, month: 99.87, since: at(27 * DAY) },
    timeline: { hours, days },
    outages: [
      { id: "cmpreview0001xx", startedAt: at(6 * HOUR + 12 * MIN), endedAt: at(6 * HOUR + 10 * MIN), minutes: 2, reason: "failed-check" },
      { id: "cmpreview0002xx", startedAt: at(14 * HOUR + 25 * MIN), endedAt: at(14 * HOUR + 2 * MIN), minutes: 23, reason: "failed-check" },
      { id: "cmpreview0003xx", startedAt: at(18 * DAY + 3 * HOUR), endedAt: at(18 * DAY + 2 * HOUR + 37 * MIN), minutes: 23, reason: "pc-silent" },
    ],
    pc: {
      state: "ok",
      lastAt: at(35_000),
      minutesSilent: 0,
      machine: "DESKTOP-EXAMPLE",
      os: "Microsoft Windows 10 Pro 10.0.19045",
      bootAt: at(3 * DAY + 4 * HOUR + 12 * MIN),
      cpuPercent: 23,
      cpuHourAvg: 18,
      memUsedMb: 9120,
      memTotalMb: 16303,
      disks: [
        { name: "C:", roles: ["system"], freeGb: 81.4, totalGb: 237.9 },
        { name: "D:", roles: ["repo"], freeGb: 402.2, totalGb: 931.5 },
      ],
      tasks: [
        { name: "BuPulse server", state: "Running" },
        { name: "BuPulse tunnel", state: "Running" },
        { name: "BuPulse jobs", state: "Running" },
      ],
      serverListening: true,
      nodeVersion: "v24.11.0",
      cloudflaredVersion: "cloudflared version 2025.10.1",
    },
    checks: {
      last: {
        checkedAt: at(2 * MIN + 20_000),
        ok: true,
        statusMs: 210,
        databaseMs: 35,
        version: "1.4.2",
        pages: [
          { path: "/", status: 200, ms: 640 },
          { path: "/pricing", status: 200, ms: 1240 },
          { path: "/login", status: 200, ms: 480 },
        ],
      },
      avg24h: [
        { path: "/", ms: 700, failures: 0 },
        { path: "/pricing", ms: 1100, failures: 1 },
        { path: "/login", ms: 520, failures: 0 },
      ],
    },
    db: { nowMs: 12, sizeBytes: 120_000_000, limitBytes: 500_000_000 },
    errors: { lastHour: 1, last24h: 9, top: [{ source: "publish", count: 5 }, { source: "store-sync", count: 3 }] },
    jobs: { total: 18, ok: 17, problems: [{ label: "Store sync", state: "failed", text: "failed on its last run (1 of 1 in 24 hours)" }] },
  };

  if (down) {
    return {
      ...base,
      issues: [{ level: "down", text: "bupulse.com looks down from outside: no good check for 14 minutes (since 10 Nov, 13:46, Kigali time)." }],
      site: { kind: "down", since: at(14 * MIN), minutes: 14, lastCheckAt: at(MIN) },
      outages: [{ id: "cmpreview0004xx", startedAt: at(14 * MIN), endedAt: null, minutes: 14, reason: "ongoing" }, ...base.outages],
      checks: { ...base.checks, last: { ...base.checks.last!, checkedAt: at(MIN), ok: false, statusMs: null, databaseMs: null, pages: base.checks.last!.pages.map((p) => ({ ...p, status: 502, ms: 90 })) } },
    };
  }
  if (silent) {
    return {
      ...base,
      issues: [{ level: "down", text: 'The server PC has not reported for 7 minutes. Its job loop ("BuPulse jobs") may have stopped, so scheduled posts may not go out.' }],
      pc: { ...base.pc, state: "silent", lastAt: at(7 * MIN), minutesSilent: 7 },
    };
  }
  if (state === "warn") {
    return {
      ...base,
      issues: [{ level: "warn", text: 'The "BuPulse tunnel" task on the PC is stopped, not running.' }],
      pc: { ...base.pc, cpuPercent: 91, memUsedMb: 15100, tasks: base.pc.tasks.map((t) => (t.name === "BuPulse tunnel" ? { ...t, state: "Ready" as const } : t)), disks: [{ ...base.pc.disks[0], freeGb: 18.2 }, base.pc.disks[1]] },
    };
  }
  if (never) {
    return {
      ...base,
      site: { kind: "never" },
      uptime: { today: null, week: null, month: null, since: null },
      timeline: { hours: hours.map((h) => ({ ...h, checks: 0, failed: 0, avgMs: null, uptime: null })), days: days.map((d) => ({ ...d, uptime: null })) },
      outages: [],
      pc: { ...base.pc, state: "never" },
      checks: { last: null, avg24h: base.checks.avg24h.map((a) => ({ ...a, ms: null, failures: 0 })) },
    };
  }
  return base;
}
